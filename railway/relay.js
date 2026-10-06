const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const wire = require('./wire');
const {TunnelSender, priority} = require('./sender');

const PORT = Number(process.env.PORT) || 3000;
const TOKEN = process.env.TUNNEL_TOKEN || '';
const MAX_REQUEST_BYTES = 30_000_000;
const TUNNEL_PATH = '/_bruma/tunnel';
const blockedHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

if (TOKEN.length < 32) {
  console.error('Configura TUNNEL_TOKEN con al menos 32 caracteres aleatorios.');
  process.exit(1);
}

const pending = new Map();
const wss = new WebSocketServer({ noServer: true, maxPayload: 50_000_000, perMessageDeflate: false });
let tunnel = null;

function send(ws, message, bytes, done) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount > 64_000_000) {
    ws.terminate();
    return false;
  }
  ws.sender ||= new TunnelSender(ws, 'body');
  const importance = message.type === 'request' ? priority(message) : pending.get(message.id)?.importance ?? 1;
  return ws.sender.send(message, bytes, done, importance);
}

function finishWithError(id, status, text) {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  if (request.response.headersSent) return request.response.destroy();
  request.response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  request.response.end(text);
}

function responseHeaders(headers = {}) {
  const filtered = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (blockedHeaders.has(lower) || value == null) continue;
    if (lower === 'set-cookie') {
      const cookies = Array.isArray(value) ? value : [value];
      filtered[name] = cookies.map(cookie => /(?:^|;)\s*Secure(?:;|$)/i.test(cookie) ? cookie : `${cookie}; Secure`);
    } else filtered[name] = value;
  }
  return filtered;
}

function handleTunnelMessage(ws, raw, binary) {
  let message;
  try { message = wire.decode(raw, binary); } catch { ws.close(1003, 'Mensaje inválido'); return; }
  if (message.type === 'hello' && message.binary === 1) { ws.binary = true; return; }
  const request = pending.get(message.id);
  if (!request || request.tunnel !== ws) return;
  const response = request.response;
  try {
    if (message.type === 'upload-pause') { request.uploadPaused = true; request.input?.pause(); return; }
    if (message.type === 'upload-resume') { request.uploadPaused = false; request.input?.resume(); return; }
    if (message.type === 'response') {
      if (response.headersSent) return;
      const status = Number(message.status);
      response.writeHead(status >= 100 && status <= 599 ? status : 502, responseHeaders(message.headers));
      response.flushHeaders();
    } else if (message.type === 'chunk') {
      if (!response.headersSent) return finishWithError(message.id, 502, 'Respuesta incompleta del servidor local.');
      const chunk = message.bytes || Buffer.from(message.data || '', 'base64');
      if (response.writableLength + chunk.length > 4_000_000) { send(ws, {type: 'cancel', id: message.id}); pending.delete(message.id); response.destroy(); return; }
      if (!response.write(chunk) && !request.paused) {
        request.paused = true;
        send(ws, {type: 'pause', id: message.id});
        response.once('drain', () => { request.paused = false; send(ws, {type: 'resume', id: message.id}); });
      }
    } else if (message.type === 'end') {
      pending.delete(message.id);
      response.end();
    } else if (message.type === 'error') {
      finishWithError(message.id, 502, 'No se pudo conectar con el servidor local.');
    }
  } catch {
    pending.delete(message.id);
    response.destroy();
  }
}

function authorized(req) {
  const authorization = String(req.headers.authorization || '');
  if (!/^Bearer /i.test(authorization)) return false;
  const provided = authorization.slice(7);
  const a = Buffer.from(provided);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ connected: tunnel?.readyState === WebSocket.OPEN, protocol: tunnel?.binary ? 2 : 1 }));
  }
  if (req.url.startsWith('/_bruma/')) {
    res.writeHead(404);
    return res.end();
  }
  const currentTunnel = tunnel;
  if (!currentTunnel || currentTunnel.readyState !== WebSocket.OPEN) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5' });
    return res.end('El servidor de Bruma está desconectado. Intenta de nuevo en unos segundos.');
  }

  if (pending.size >= 128) { res.writeHead(503, {'Retry-After':'1'}); return res.end('Servidor ocupado. Reintenta el envío.'); }
  const streamBody = req.headers['content-length'] === undefined
    ? !['GET', 'HEAD'].includes(req.method) : Number(req.headers['content-length']) > 8192;
  if (currentTunnel.binary && streamBody) {
    const id = crypto.randomUUID();
    const request = {response: res, tunnel: currentTunnel, input: req, uploadPaused: false, importance: 0};
    pending.set(id, request);
    res.on('close', () => {
      if (!pending.has(id)) return;
      pending.delete(id); send(currentTunnel, {type:'cancel', id});
    });
    if (!send(currentTunnel, {type:'request', id, method:req.method, path:req.url, headers:req.headers, streaming:true})) {
      finishWithError(id, 503, 'Servidor desconectado.'); return;
    }
    let size = 0;
    req.on('data', chunk => {
      if (!pending.has(id)) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        send(currentTunnel, {type:'cancel',id}); finishWithError(id,413,'Petición demasiado grande.'); return;
      }
      req.pause();
      if (!send(currentTunnel, {type:'body',id}, chunk, error => {
        if (!error && !request.uploadPaused) req.resume();
      })) { finishWithError(id,503,'Servidor desconectado.'); req.resume(); }
    });
    req.on('end', () => { if (pending.has(id)) send(currentTunnel,{type:'body-end',id}); });
    req.on('error', () => res.destroy());
    req.on('aborted', () => res.destroy());
    return;
  }

  let size = 0;
  let tooLarge = false;
  const chunks = [];
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) tooLarge = true;
    else if (!tooLarge) chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooLarge) {
      res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Petición demasiado grande.');
    }
    if (res.destroyed) return;
    const id = crypto.randomUUID();
    pending.set(id, { response: res, tunnel: currentTunnel, importance: priority({path: req.url, headers: req.headers}) });
    res.on('close', () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      send(currentTunnel, { type: 'cancel', id });
    });
    if (!send(currentTunnel, {
      type: 'request', id, method: req.method, path: req.url,
      headers: req.headers
    }, Buffer.concat(chunks))) finishWithError(id, 503, 'El servidor de Bruma está desconectado.');
  });
  req.on('error', () => { if (!res.destroyed) res.destroy(); });
});

server.on('upgrade', (req, socket, head) => {
  if (req.url !== TUNNEL_PATH || !authorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});

wss.on('connection', ws => {
  if (tunnel) tunnel.terminate();
  tunnel = ws;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw, binary) => handleTunnelMessage(ws, raw, binary));
  send(ws, {type: 'hello', binary: 1});
  ws.on('error', error => console.error('Error del túnel:', error.message));
  ws.on('close', () => {
    for (const [id, request] of pending) {
      if (request.tunnel === ws) finishWithError(id, 503, 'El servidor de Bruma está desconectado.');
    }
    if (tunnel === ws) tunnel = null;
  });
  console.log('Laptop conectada al túnel.');
});

setInterval(() => {
  if (!tunnel) return;
  if (!tunnel.isAlive) return tunnel.terminate();
  tunnel.isAlive = false;
  tunnel.ping();
}, 30_000);

server.listen(PORT, '0.0.0.0', () => console.log(`Puente Railway escuchando en el puerto ${PORT}`));
