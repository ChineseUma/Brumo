const http = require('node:http');
const { WebSocket } = require('ws');
const wire = require('./wire');
const {TunnelSender, priority} = require('./sender');

const RAILWAY_URL = process.env.RAILWAY_URL || '';
const TOKEN = process.env.TUNNEL_TOKEN || '';
const LOCAL_PORT = Number(process.env.LOCAL_PORT) || 3000;
const blockedHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

if (!RAILWAY_URL || TOKEN.length < 32 || !Number.isInteger(LOCAL_PORT) || LOCAL_PORT < 1 || LOCAL_PORT > 65535) {
  console.error('Configura RAILWAY_URL, TUNNEL_TOKEN (mínimo 32 caracteres) y LOCAL_PORT.');
  process.exit(1);
}

let endpoint;
try {
  endpoint = new URL('/_bruma/tunnel', RAILWAY_URL);
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') throw new Error('Protocolo inválido');
  if (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(endpoint.hostname)) throw new Error('Se requiere HTTPS');
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
} catch {
  console.error('RAILWAY_URL debe usar HTTPS (HTTP solo para pruebas en localhost).');
  process.exit(1);
}

let retries = 0;
let stopping = false;
let socket;
const active = new Map();

function send(message, bytes, done, currentSocket = socket, importance = 1) {
  if (currentSocket?.readyState !== WebSocket.OPEN) return false;
  if (currentSocket.bufferedAmount > 64_000_000) {
    currentSocket.terminate();
    return false;
  }
  currentSocket.sender ||= new TunnelSender(currentSocket, 'data');
  return currentSocket.sender.send(message, bytes, done, importance);
}

function localHeaders(headers = {}, bodyLength = 0) {
  const filtered = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (blockedHeaders.has(lower) || lower === 'host' || lower === 'content-length' || value == null) continue;
    filtered[name] = value;
  }
  filtered.host = `127.0.0.1:${LOCAL_PORT}`;
  if (bodyLength !== null) filtered['content-length'] = bodyLength;
  return filtered;
}

function forward(message, sourceSocket) {
  if (typeof message.id !== 'string' || typeof message.path !== 'string' || !message.path.startsWith('/')) return;
  if (active.has(message.id)) return;
  const body = message.bytes || Buffer.from(message.body || '', 'base64');
  const importance = priority(message);
  // Late HTTP callbacks from a disconnected tunnel must never use its replacement.
  const reply = (metadata, bytes, done) => send(metadata, bytes, done, sourceSocket, importance);
  const localRequest = http.request({
    hostname: '127.0.0.1', port: LOCAL_PORT, method: message.method,
    path: message.path, headers: localHeaders(message.headers, message.streaming ? null : body.length)
  }, response => {
    const current = active.get(message.id);
    if (!current) return response.destroy();
    current.response = response;
    reply({ type: 'response', id: message.id, status: response.statusCode, headers: response.headers });
    response.on('data', chunk => {
      response.pause();
      if (!reply({type: 'chunk', id: message.id}, chunk, error => { if (error) response.destroy(); else if (!current.paused) response.resume(); })) response.destroy();
    });
    response.on('end', () => {
      active.delete(message.id);
      reply({ type: 'end', id: message.id });
    });
    response.on('error', () => {
      active.delete(message.id);
      reply({ type: 'error', id: message.id });
    });
  });
  active.set(message.id, { request: localRequest, response: null });
  localRequest.on('error', () => {
    if (!active.has(message.id)) return;
    active.delete(message.id);
    reply({ type: 'error', id: message.id });
  });
  if (!message.streaming) localRequest.end(body);
}

function connect() {
  socket = new WebSocket(endpoint, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    maxPayload: 50_000_000,
    perMessageDeflate: false
  });
  const connectedSocket = socket;
  socket.on('open', () => {
    retries = 0;
    console.log('Túnel conectado a Railway.');
  });
  socket.on('message', (raw, binary) => {
    let message;
    try { message = wire.decode(raw, binary); } catch { socket.close(1003); return; }
    if (message.type === 'hello' && message.binary === 1) { socket.binary = true; send({type: 'hello', binary: 1}); return; }
    if (message.type === 'pause' || message.type === 'resume') {
      const current = active.get(message.id);
      if (current) { current.paused = message.type === 'pause'; if (current.paused) current.response?.pause(); else current.response?.resume(); }
    }
    if (message.type === 'body' || message.type === 'body-end') {
      const current = active.get(message.id);
      if (current) {
        if (message.type === 'body-end') current.request.end();
        else if (!current.request.write(message.bytes || Buffer.from(message.data || '', 'base64'))) {
          send({type:'upload-pause',id:message.id});
          current.request.once('drain', () => send({type:'upload-resume',id:message.id}));
        }
      }
    }
    if (message.type === 'request') forward(message, connectedSocket);
    if (message.type === 'cancel') {
      const current = active.get(message.id);
      if (!current) return;
      active.delete(message.id);
      current.response?.destroy();
      current.request.destroy();
    }
  });
  socket.on('error', error => console.error('Error del túnel:', error.message));
  socket.on('close', () => {
    for (const current of active.values()) {
      current.response?.destroy();
      current.request.destroy();
    }
    active.clear();
    if (stopping) return;
    const delay = Math.min(1000 * 2 ** retries++, 30_000);
    console.log(`Túnel desconectado. Reintentando en ${Math.ceil(delay / 1000)} s.`);
    setTimeout(connect, delay);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    socket?.terminate();
    process.exit(0);
  });
}

connect();
