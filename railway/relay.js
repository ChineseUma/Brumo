const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

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

function send(ws, message) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount > 64_000_000) {
    ws.terminate();
    return false;
  }
  ws.send(JSON.stringify(message), error => { if (error) ws.terminate(); });
  return true;
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

function handleTunnelMessage(ws, raw) {
  let message;
  try { message = JSON.parse(raw.toString()); } catch { ws.close(1003, 'Mensaje inválido'); return; }
  const request = pending.get(message.id);
  if (!request || request.tunnel !== ws) return;
  const response = request.response;
  try {
    if (message.type === 'response') {
      if (response.headersSent) return;
      const status = Number(message.status);
      response.writeHead(status >= 100 && status <= 599 ? status : 502, responseHeaders(message.headers));
    } else if (message.type === 'chunk') {
      if (!response.headersSent) return finishWithError(message.id, 502, 'Respuesta incompleta del servidor local.');
      response.write(Buffer.from(message.data || '', 'base64'));
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
    return res.end(JSON.stringify({ connected: tunnel?.readyState === WebSocket.OPEN }));
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
    pending.set(id, { response: res, tunnel: currentTunnel });
    res.on('close', () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      send(currentTunnel, { type: 'cancel', id });
    });
    if (!send(currentTunnel, {
      type: 'request', id, method: req.method, path: req.url,
      headers: req.headers, body: Buffer.concat(chunks).toString('base64')
    })) finishWithError(id, 503, 'El servidor de Bruma está desconectado.');
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
  ws.on('message', raw => handleTunnelMessage(ws, raw));
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
