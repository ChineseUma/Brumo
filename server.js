const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { URL } = require('url');
const { createGunzip } = require('node:zlib');
const { MessageStore } = require('./lib/message-store');
const { validAvatar } = require('./lib/avatar');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || '';
// Cambia este valor para modificar el máximo de imágenes por mensaje.
const MAX_IMAGES_PER_MESSAGE = Number(process.env.MAX_IMAGES_PER_MESSAGE) || 10;
const MAX_REQUEST_BYTES = 30_000_000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STORAGE_DIR = path.join(__dirname, 'storage');
const ACCOUNTS_FILE = path.join(STORAGE_DIR, 'accounts.json');
const FRIENDS_FILE = path.join(STORAGE_DIR, 'friends.json');
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
const UPLOADS_FILE = path.join(STORAGE_DIR, 'uploads.json');
const SESSIONS_FILE = path.join(STORAGE_DIR, 'sessions.json');
const scrypt = promisify(crypto.scrypt);
const clients = new Set();
const messages = [];
const accounts = [];
const friendRequests = [];
const privateMessages = {};
const uploads = {};
const sessions = new Map();
const sessionExpirations = new Map();
const store = new MessageStore(STORAGE_DIR);
let nextCleanup = 0;
let cleanupTask;
const groupById = new Map();

function saveAccounts() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const temporaryFile = `${ACCOUNTS_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(accounts), 'utf8');
  fs.renameSync(temporaryFile, ACCOUNTS_FILE);
}

function saveFriendRequests() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const temporaryFile = `${FRIENDS_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(friendRequests), 'utf8');
  fs.renameSync(temporaryFile, FRIENDS_FILE);
}

function saveUploads() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const temporaryFile = `${UPLOADS_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(uploads), 'utf8');
  fs.renameSync(temporaryFile, UPLOADS_FILE);
}

function saveSessions() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const temporaryFile = `${SESSIONS_FILE}.tmp`;
  const saved = [...sessions].map(([id, accountId]) => ({ id, accountId, expiresAt: sessionExpirations.get(id) || 0 }));
  fs.writeFileSync(temporaryFile, JSON.stringify(saved), 'utf8');
  fs.renameSync(temporaryFile, SESSIONS_FILE);
}

function loadSessions() {
  try {
    const now = Date.now();
    const saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    if (!Array.isArray(saved)) return;
    for (const session of saved) {
      if (!session?.id || !session?.accountId || Number(session.expiresAt) <= now) continue;
      sessions.set(session.id, session.accountId);
      sessionExpirations.set(session.id, Number(session.expiresAt));
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudieron cargar las sesiones:', error.message);
  }
}

function createSession(accountId) {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, accountId);
  sessionExpirations.set(id, Date.now() + 30 * 24 * 60 * 60 * 1000);
  saveSessions();
  return id;
}

function loadAccounts() {
  try {
    const savedAccounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    if (Array.isArray(savedAccounts)) accounts.push(...savedAccounts);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudieron cargar las cuentas:', error.message);
  }
  try {
    const saved = JSON.parse(fs.readFileSync(UPLOADS_FILE, 'utf8'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) Object.assign(uploads, saved);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudieron cargar los archivos:', error.message);
  }
}

function loadFriendData() {
  try {
    const saved = JSON.parse(fs.readFileSync(FRIENDS_FILE, 'utf8'));
    if (Array.isArray(saved)) friendRequests.push(...saved);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudieron cargar las amistades:', error.message);
  }

}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derivedKey = await scrypt(password, salt, 64);
  return { salt, hash: derivedKey.toString('hex') };
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  const cookie = cookies.find(item => item.trim().startsWith(`${name}=`));
  try { return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : ''; } catch { return ''; }
}

function currentAccount(req) {
  const sessionId = getCookie(req, 'bruma-session');
  if (sessionId && (sessionExpirations.get(sessionId) || 0) <= Date.now()) {
    sessions.delete(sessionId);
    sessionExpirations.delete(sessionId);
    saveSessions();
    return null;
  }
  const accountId = sessions.get(sessionId);
  return accounts.find(account => account.id === accountId) || null;
}

function guestIdentity(req, res) {
  const existing = getCookie(req, 'bruma-guest');
  if (/^[a-f0-9]{64}$/.test(existing)) return existing;
  const identity = crypto.randomBytes(32).toString('hex');
  res.setHeader('Set-Cookie', `bruma-guest=${identity}; Max-Age=31536000; HttpOnly; SameSite=Lax; Path=/`);
  return identity;
}

function ownsMessage(message, guestId, accountId) {
  return Boolean((message.ownerAccountId && message.ownerAccountId === accountId)
    || (message.ownerGuestId && message.ownerGuestId === guestId));
}

function visibleMessage({ senderId, ownerGuestId, ownerAccountId, ...message }, guestId, accountId) {
  return {
    ...message,
    canEdit: ownsMessage({ ownerGuestId, ownerAccountId }, guestId, accountId)
  };
}

function visibleMessages(guestId, accountId) {
  return messages.map(message => visibleMessage(message, guestId, accountId));
}

function publicAccount(account) {
  return account ? { email: account.email, username: account.username || '', displayName: account.displayName || '', avatarData: account.avatarData || '' } : null;
}

function normalizeUsername(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^@+/, '');
  return `@${raw}`;
}

function validUsername(username) {
  return /^@[a-z0-9_]{3,20}$/.test(username);
}

function usernameTaken(username, exceptId = '') {
  return accounts.some(account => account.id !== exceptId && account.username === username);
}

function publicFriend(account) {
  return { username: account.username, displayName: account.displayName || 'Usuario', avatarData: account.avatarData || '' };
}

function conversationKey(firstId, secondId) {
  return [firstId, secondId].sort().join(':');
}

function acceptedFriendship(firstId, secondId) {
  return friendRequests.some(request => request.status === 'accepted'
    && ((request.fromId === firstId && request.toId === secondId) || (request.fromId === secondId && request.toId === firstId)));
}

function cleanPrivateMessages() { return cleanupMessages(); }
async function cleanupMessages() {
  if (cleanupTask) return cleanupTask;
  if (Date.now() < nextCleanup) return;
  nextCleanup = Date.now() + 30000;
  cleanupTask = (async () => {
    const removed = await store.call('prune', {now: Date.now()});
    for (const {id, room} of removed) {
      const list = room ? privateMessages[room] : messages;
      if (!list) continue;
      const index = list.findIndex(message => message.id === id);
      if (index >= 0) list.splice(index, 1);
      if (!room) { groupById.delete(id); broadcastMessageChange('message-deleted', {id}); }
      else broadcastPrivateExpiry(room, id);
    }
    cleanupUploads();
  })().finally(() => { cleanupTask = null; });
  return cleanupTask;
}

function cleanupUploads() {
  const referenced = new Set();
  for (const message of messages) for (const file of message.files || []) referenced.add(file.id);
  for (const conversation of Object.values(privateMessages)) {
    for (const message of conversation) for (const file of message.files || []) referenced.add(file.id);
  }
  let changed = false;
  const expiration = 24 * 60 * 60 * 1000;
  for (const [id, upload] of Object.entries(uploads)) {
    if (referenced.has(id) || Date.now() - upload.createdAt < expiration) continue;
    try { fs.unlinkSync(upload.path); } catch (error) { if (error.code !== 'ENOENT') continue; }
    delete uploads[id];
    changed = true;
  }
  if (changed) saveUploads();
}

function legacyUsername(account) {
  const base = String(account.displayName || account.email.split('@')[0] || 'usuario')
    .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'usuario';
  let username = `@${base}`;
  let suffix = 2;
  while (usernameTaken(username, account.id)) username = `@${base.slice(0, 18 - String(suffix).length)}${suffix++}`;
  return username;
}

loadAccounts();
loadSessions();
let accountsChanged = false;
for (const account of accounts) {
  if (!validUsername(account.username) || usernameTaken(account.username, account.id)) {
    account.username = legacyUsername(account);
    accountsChanged = true;
  }
}
if (accountsChanged) saveAccounts();
loadFriendData();

function sendJson(res, status, data, headers = {}) {
  const existingCookie = res.getHeader('Set-Cookie');
  if (existingCookie && headers['Set-Cookie']) {
    headers = { ...headers, 'Set-Cookie': [existingCookie, headers['Set-Cookie']].flat() };
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function sessionAccount(sessionId) {
  return (sessionExpirations.get(sessionId) || 0) > Date.now() ? sessions.get(sessionId) || '' : '';
}
function compactClient(req) { return req.headers['x-bruma-version'] === '3'; }
function representation(value, compact) { return compact ? Promise.resolve(value) : store.call('expand', value); }
function emit(client, event, data) {
  if (client.response.destroyed) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  // A stalled connection must not accumulate the entire room in RAM.
  if (client.response.writableLength + Buffer.byteLength(payload) > 32_000_000) {
    client.response.destroy(); clients.delete(client); return;
  }
  client.response.write(payload);
}
function deliver(client, event, value) {
  // Legacy expansion happens off the HTTP thread; maintain event ordering.
  if (client.queued >= 128) { client.response.destroy(); clients.delete(client); return; }
  client.queued++;
  client.queue = client.queue.then(async () => {
    if (!client.response.destroyed) emit(client, event, await representation(value, client.compact));
  }).catch(() => client.response.destroy()).finally(() => { client.queued--; });
}
function broadcast(event, data) {
  for (const client of clients) deliver(client, event, data);
}
function broadcastMessages() {
  for (const client of clients) deliver(client, 'messages', visibleMessages(client.guestId, sessionAccount(client.sessionId)));
}
function broadcastMessageChange(event, message) {
  for (const client of clients) {
    const accountId = sessionAccount(client.sessionId);
    if (client.delta) deliver(client, event, event === 'message-deleted' ? {id: message.id} : visibleMessage(message, client.guestId, accountId));
    else deliver(client, 'messages', visibleMessages(client.guestId, accountId));
  }
}
function broadcastPrivateCreated(first, second, message, conversation) {
  for (const client of clients) {
    const accountId = sessionAccount(client.sessionId);
    if (accountId !== first.id && accountId !== second.id) continue;
    const friend = accountId === first.id ? second : first;
    const common = {friendUsername: friend.username, friendDisplayName: friend.displayName || 'Usuario', isOwn: accountId === first.id};
    deliver(client, client.delta ? 'private-created' : 'private', client.delta ? {...common, message} : {...common, messages: conversation});
  }
}
function broadcastPrivateExpiry(room, id) {
  const ids = room.split(':');
  for (const client of clients) {
    const own = sessionAccount(client.sessionId);
    if (!ids.includes(own)) continue;
    const friend = accounts.find(account => account.id === ids.find(id => id !== own));
    if (friend) deliver(client, 'private-deleted', {friendUsername: friend.username, id});
  }
}
function clientMessageId(data) {
  if (data.clientId === undefined) return undefined;
  if (typeof data.clientId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.clientId)) throw new Error('Identificador de envío inválido.');
  return data.clientId;
}
async function saveNewMessage(room, message, owner) {
  const result = await store.call('create', {room, message, owner});
  if (result.created) {
    if (room) (privateMessages[room] ||= []).push(result.message);
    else { messages.push(result.message); groupById.set(result.message.id, result.message); }
  }
  return result;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let rejected = false;
    const source = req.headers['content-encoding'] === 'gzip' ? req.pipe(createGunzip()) : req;
    if (source !== req) source.on('error', reject);
    req.on('error', reject);
    source.on('data', chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) { rejected = true; chunks.length = 0; reject(new Error('Payload demasiado grande')); }
      else chunks.push(chunk);
    });
    source.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks, size).toString('utf8')); });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Envío interrumpido')));
  });
}

function inlineDataBytes(value) {
  const match = /^data:[^;]+(?:;[^,]+)?;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return 0;
  return Math.floor(match[1].length * 3 / 4) - (match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0);
}

function validInlineImage(value) {
  return /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && inlineDataBytes(value) <= 10_000_000;
}

function validInlineAudio(value) {
  return /^data:audio\/(webm|ogg|mpeg|mp4|wav|x-wav|aac|m4a|x-m4a|flac)(?:;[^,]+)?;base64,[A-Za-z0-9+/=]+$/.test(value) && inlineDataBytes(value) <= 10_000_000;
}

function fileIsVisible(id, req, guestId) {
  const upload = uploads[id];
  if (!upload) return false;
  const providedToken = new URL(req.url, `http://${req.headers.host}`).searchParams.get('token') || '';
  if (upload.token && providedToken) {
    const expected = Buffer.from(upload.token);
    const provided = Buffer.from(providedToken);
    if (expected.length === provided.length && crypto.timingSafeEqual(expected, provided)) return true;
  }
  const account = currentAccount(req);
  const accountId = account?.id || '';
  if (upload.ownerAccountId && upload.ownerAccountId === accountId) return true;
  if (upload.ownerGuestId && upload.ownerGuestId === guestId) return true;
  if (upload.recipientAccountId) {
    return Boolean(accountId && upload.recipientAccountId === accountId && acceptedFriendship(accountId, upload.ownerAccountId));
  }
  if (!accountId) return messages.some(message => (message.files || []).some(file => file.id === id));
  return messages.some(message => (message.files || []).some(file => file.id === id));
}

function ownsUpload(upload, req, guestId) {
  const accountId = currentAccount(req)?.id || '';
  return Boolean(upload && ((upload.ownerAccountId && upload.ownerAccountId === accountId)
    || (upload.ownerGuestId && upload.ownerGuestId === guestId)));
}

function appendUploadChunk(req, filePath, maximumBytes) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const output = fs.createWriteStream(filePath, { flags: 'a' });
    req.on('data', chunk => {
      received += chunk.length;
      if (received > maximumBytes) output.destroy(new Error('Fragmento demasiado grande.'));
    });
    req.on('error', reject);
    output.on('error', reject);
    output.on('finish', () => resolve(received));
    req.pipe(output);
  });
}

function writeUpload(req, filePath, limit) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let settled = false;
    const output = fs.createWriteStream(filePath, { flags: 'wx' });
    const fail = error => {
      if (settled) return;
      settled = true;
      output.destroy();
      fs.rm(filePath, { force: true }, () => reject(error));
    };
    req.on('data', chunk => {
      received += chunk.length;
      if (received > limit) {
        fail(new Error('El archivo supera el límite permitido.'));
      }
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new Error('Subida interrumpida.')));
    output.on('error', fail);
    output.on('finish', () => {
      if (!settled) { settled = true; resolve(received); }
    });
    req.pipe(output);
  });
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Ruta no permitida' });
  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(res, 404, { error: 'No encontrado' });
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'text/plain'}; charset=utf-8` });
    res.end(content);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const guestId = guestIdentity(req, res);
  await cleanupMessages();

  if (req.method === 'GET' && url.pathname === '/api/messages') {
    return sendJson(res, 200, await representation(visibleMessages(guestId, currentAccount(req)?.id || ''), compactClient(req)));
  }

  const mediaMatch = /^\/api\/media\/([a-f0-9]{64})$/.exec(url.pathname);
  if (req.method === 'GET' && mediaMatch) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const media = await store.call('media', {id: mediaMatch[1], range: range ? {start: range[1], end: range[2] || undefined} : null});
    if (!media) return sendJson(res, 404, {error: 'El contenido caducó.'});
    if (media.invalid) { res.writeHead(416, {'Content-Range': `bytes */${media.total}`}); return res.end(); }
    const bytes = Buffer.from(media.data.buffer, media.data.byteOffset, media.data.byteLength);
    const headers = {'Content-Type': media.mime, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', 'Content-Length': bytes.length};
    if (range) headers['Content-Range'] = `bytes ${media.start}-${media.end}/${media.total}`;
    res.writeHead(range ? 206 : 200, headers); return res.end(bytes);
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, { giphyApiKey: GIPHY_API_KEY, maxImages: MAX_IMAGES_PER_MESSAGE });
  }

  if (req.method === 'POST' && url.pathname === '/api/uploads/start') {
    try {
      const data = JSON.parse(await readBody(req));
      const account = currentAccount(req);
      const recipientInput = String(data.recipientUsername || '').trim();
      const recipientUsername = recipientInput ? normalizeUsername(recipientInput) : '';
      const recipient = recipientUsername ? accounts.find(item => item.username === recipientUsername) : null;
      if (recipientUsername && (!account || !recipient || !acceptedFriendship(account.id, recipient.id))) {
        return sendJson(res, 403, { error: 'Solo puedes adjuntar archivos a tus amigos.' });
      }
      const type = String(data.type || 'application/octet-stream').split(';')[0].toLowerCase();
      const expectedSize = Math.max(0, Number(data.size) || 0);
      const limit = type.startsWith('image/') || type.startsWith('audio/') ? 10_000_000 : 500_000_000;
      if (expectedSize > limit) return sendJson(res, 413, { error: `El archivo supera el límite de ${limit === 10_000_000 ? '10 MB' : '500 MB'}.` });
      const id = crypto.randomUUID();
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      const filePath = path.join(UPLOADS_DIR, id);
      fs.closeSync(fs.openSync(filePath, 'wx'));
      uploads[id] = {
        id, path: filePath, token: crypto.randomBytes(24).toString('hex'),
        name: String(data.name || 'archivo').slice(0, 120).replace(/[^a-zA-Z0-9._-]/g, '_'),
        type, size: 0, expectedSize, limit, complete: false,
        ownerAccountId: account?.id || '', ownerGuestId: account ? '' : guestId,
        recipientAccountId: recipient?.id || '', createdAt: Date.now()
      };
      saveUploads();
      return sendJson(res, 201, { id });
    } catch {
      return sendJson(res, 400, { error: 'No se pudo iniciar la subida.' });
    }
  }

  const uploadChunkMatch = /^\/api\/uploads\/([a-f0-9-]+)\/chunk$/.exec(url.pathname);
  if (req.method === 'POST' && uploadChunkMatch) {
    const upload = uploads[uploadChunkMatch[1]];
    if (!ownsUpload(upload, req, guestId) || upload.complete) return sendJson(res, 404, { error: 'Subida no encontrada.' });
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > 4_000_000 || upload.size + declared > upload.limit) return sendJson(res, 413, { error: 'El fragmento supera el límite permitido.' });
    try {
      const written = await appendUploadChunk(req, upload.path, Math.min(4_000_000, upload.limit - upload.size));
      upload.size += written;
      saveUploads();
      return sendJson(res, 200, { received: upload.size });
    } catch {
      return sendJson(res, 413, { error: 'No se pudo guardar el fragmento.' });
    }
  }

  const uploadFinishMatch = /^\/api\/uploads\/([a-f0-9-]+)\/finish$/.exec(url.pathname);
  if (req.method === 'POST' && uploadFinishMatch) {
    const upload = uploads[uploadFinishMatch[1]];
    if (!ownsUpload(upload, req, guestId) || upload.complete) return sendJson(res, 404, { error: 'Subida no encontrada.' });
    if (upload.expectedSize && upload.size !== upload.expectedSize) return sendJson(res, 409, { error: 'La subida quedó incompleta.' });
    upload.complete = true;
    delete upload.expectedSize;
    delete upload.limit;
    saveUploads();
    return sendJson(res, 201, { id: upload.id, token: upload.token, name: upload.name, type: upload.type, size: upload.size, url: `/api/uploads/${upload.id}?token=${upload.token}` });
  }

  if (url.pathname.startsWith('/api/uploads/')) {
    const id = url.pathname.slice('/api/uploads/'.length);
    const upload = uploads[id];
    if (req.method !== 'GET' || !upload || upload.complete === false || !fileIsVisible(id, req, guestId)) return sendJson(res, 404, { error: 'Archivo no encontrado.' });
    res.writeHead(200, {
      'Content-Type': upload.type || 'application/octet-stream',
      'Content-Length': upload.size,
      'Cache-Control': upload.token && url.searchParams.get('token') === upload.token ? 'private, max-age=86400' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${upload.name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`
    });
    const input = fs.createReadStream(upload.path);
    input.on('error', () => res.destroy());
    res.on('close', () => input.destroy());
    return input.pipe(res);
  }

  if (req.method === 'POST' && url.pathname === '/api/uploads') {
    const account = currentAccount(req);
    const recipientInput = String(req.headers['x-bruma-recipient'] || '').trim();
    const recipientUsername = recipientInput ? normalizeUsername(recipientInput) : '';
    const recipient = recipientUsername ? accounts.find(item => item.username === recipientUsername) : null;
    if (recipientUsername && (!account || !recipient || !acceptedFriendship(account.id, recipient.id))) {
      return sendJson(res, 403, { error: 'Solo puedes adjuntar archivos a tus amigos.' });
    }
    const type = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].toLowerCase();
    const limit = type.startsWith('image/') || type.startsWith('audio/') ? 10_000_000 : 500_000_000;
    const declaredSize = Number(req.headers['content-length'] || 0);
    if (declaredSize > limit) return sendJson(res, 413, { error: `El archivo supera el límite de ${type.startsWith('image/') || type.startsWith('audio/') ? '10 MB' : '500 MB'}.` });
    const id = crypto.randomUUID();
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const filePath = path.join(UPLOADS_DIR, id);
    try {
      const size = await writeUpload(req, filePath, limit);
      uploads[id] = {
        id, token: crypto.randomBytes(24).toString('hex'),
        path: filePath,
        name: decodeURIComponent(String(req.headers['x-bruma-file-name'] || 'archivo')).slice(0, 120).replace(/[^a-zA-Z0-9._-]/g, '_'),
        type,
        size,
        ownerAccountId: account?.id || '',
        ownerGuestId: account ? '' : guestId,
        recipientAccountId: recipient?.id || '',
        createdAt: Date.now()
      };
      saveUploads();
      return sendJson(res, 201, { id, token: uploads[id].token, name: uploads[id].name, type, size, url: `/api/uploads/${id}?token=${uploads[id].token}` });
    } catch (error) {
      return sendJson(res, 413, { error: error.message || 'No se pudo guardar el archivo.' });
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/profiles/')) {
    let username;
    try { username = normalizeUsername(decodeURIComponent(url.pathname.slice('/api/profiles/'.length))); }
    catch { return sendJson(res, 400, {error: 'Perfil inválido.'}); }
    if (!validUsername(username)) return sendJson(res, 400, {error: 'Nombre de usuario inválido.'});
    const profile = accounts.find(item => item.username === username);
    if (!profile) return sendJson(res, 404, {error: 'Perfil no encontrado.'});
    return sendJson(res, 200, {profile: publicFriend(profile)});
  }

  if (url.pathname.startsWith('/api/friends')) {
    const account = currentAccount(req);
    if (!account) return sendJson(res, 401, { error: 'Inicia sesión para usar amistades.' });

    if (req.method === 'GET' && url.pathname === '/api/friends') {
      const accepted = friendRequests.filter(request => request.status === 'accepted'
        && (request.fromId === account.id || request.toId === account.id));
      const friends = accepted.map(request => accounts.find(item => item.id === (request.fromId === account.id ? request.toId : request.fromId)))
        .filter(Boolean).map(publicFriend);
      const incoming = friendRequests.filter(request => request.status === 'pending' && request.toId === account.id)
        .map(request => ({ id: request.id, from: accounts.find(item => item.id === request.fromId) })).filter(item => item.from)
        .map(item => ({ id: item.id, from: publicFriend(item.from) }));
      const outgoing = friendRequests.filter(request => request.status === 'pending' && request.fromId === account.id)
        .map(request => ({ id: request.id, to: accounts.find(item => item.id === request.toId) })).filter(item => item.to)
        .map(item => ({ id: item.id, to: publicFriend(item.to) }));
      return sendJson(res, 200, { friends, incoming, outgoing });
    }

    if (req.method === 'POST' && url.pathname === '/api/friends/requests') {
      try {
        const data = JSON.parse(await readBody(req));
        const username = normalizeUsername(data.username);
        const target = accounts.find(item => item.username === username);
        if (!validUsername(username)) return sendJson(res, 400, { error: 'Escribe un nombre de usuario válido.' });
        if (!target) return sendJson(res, 404, { error: 'No existe una cuenta con ese nombre de usuario.' });
        if (target.id === account.id) return sendJson(res, 400, { error: 'No puedes enviarte una solicitud a ti mismo.' });
        if (acceptedFriendship(account.id, target.id)) return sendJson(res, 409, { error: 'Ya son amigos.' });
        const reverse = friendRequests.find(request => request.status === 'pending' && request.fromId === target.id && request.toId === account.id);
        if (reverse) {
          reverse.status = 'accepted';
          reverse.updatedAt = Date.now();
          saveFriendRequests();
          broadcast('friends', { accountIds: [account.id, target.id] });
          return sendJson(res, 200, { accepted: true });
        }
        if (friendRequests.some(request => request.status === 'pending' && request.fromId === account.id && request.toId === target.id)) {
          return sendJson(res, 409, { error: 'Ya enviaste una solicitud a esa persona.' });
        }
        const request = { id: crypto.randomUUID(), fromId: account.id, toId: target.id, status: 'pending', createdAt: Date.now() };
        friendRequests.push(request);
        saveFriendRequests();
        broadcast('friends', { accountIds: [account.id, target.id] });
        for (const client of clients) if (sessionAccount(client.sessionId) === target.id) {
          deliver(client, 'friend-request', {id: request.id, from: publicFriend(account)});
        }
        return sendJson(res, 201, { ok: true });
      } catch {
        return sendJson(res, 400, { error: 'Solicitud inválida.' });
      }
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/api/friends/requests/')) {
      const requestId = decodeURIComponent(url.pathname.slice('/api/friends/requests/'.length));
      try {
        const data = JSON.parse(await readBody(req));
        const request = friendRequests.find(item => item.id === requestId && item.toId === account.id && item.status === 'pending');
        if (!request) return sendJson(res, 404, { error: 'Solicitud no encontrada.' });
        if (data.action !== 'accept' && data.action !== 'reject') return sendJson(res, 400, { error: 'Acción inválida.' });
        request.status = data.action === 'accept' ? 'accepted' : 'rejected';
        request.updatedAt = Date.now();
        saveFriendRequests();
        broadcast('friends', { accountIds: [account.id, request.fromId] });
        return sendJson(res, 200, { ok: true });
      } catch {
        return sendJson(res, 400, { error: 'Solicitud inválida.' });
      }
    }
  }

  if (url.pathname.startsWith('/api/private/messages')) {
    const account = currentAccount(req);
    if (!account) return sendJson(res, 401, { error: 'Inicia sesión para usar chats privados.' });

    if (req.method === 'GET' && url.pathname.startsWith('/api/private/messages/')) {
      const username = normalizeUsername(decodeURIComponent(url.pathname.slice('/api/private/messages/'.length)));
      const target = accounts.find(item => item.username === username);
      if (!target || !acceptedFriendship(account.id, target.id)) return sendJson(res, 403, { error: 'Solo puedes abrir chats con amigos.' });
      await cleanPrivateMessages();
      return sendJson(res, 200, await representation(privateMessages[conversationKey(account.id, target.id)] || [], compactClient(req)));
    }

    if (req.method === 'POST' && url.pathname === '/api/private/messages') {
      try {
        const data = JSON.parse(await readBody(req));
        const username = normalizeUsername(data.recipientUsername);
        const target = accounts.find(item => item.username === username);
        const text = String(data.text || '').trim().slice(0, 500);
        const requestedImages = Array.isArray(data.images) ? data.images.map(item => String(item || '')) : [];
        const images = requestedImages.filter(validInlineImage);
        const audioData = String(data.audioData || '');
        const gifUrl = String(data.gifUrl || '');
        const requestedFiles = Array.isArray(data.files) ? data.files : [];
        if (!target || !acceptedFriendship(account.id, target.id)) return sendJson(res, 403, { error: 'Solo puedes escribir a tus amigos.' });
        if (requestedImages.length > MAX_IMAGES_PER_MESSAGE || images.length !== requestedImages.length) return sendJson(res, 400, { error: 'Una imagen no es válida, supera 10 MB o excede el máximo permitido.' });
        if (audioData && !validInlineAudio(audioData)) return sendJson(res, 400, { error: 'El audio no es válido o supera 10 MB.' });
        let validGif = false;
        try {
          const parsedGif = new URL(gifUrl);
          validGif = parsedGif.protocol === 'https:' && (parsedGif.hostname === 'giphy.com' || parsedGif.hostname.endsWith('.giphy.com'));
        } catch {}
        const files = requestedFiles.filter(file => file && uploads[file.id] && uploads[file.id].complete !== false && uploads[file.id].recipientAccountId === target.id && uploads[file.id].ownerAccountId === account.id)
          .map(file => ({ id: file.id, token: uploads[file.id].token || '', name: uploads[file.id].name, type: uploads[file.id].type, size: uploads[file.id].size }));
        if (files.length !== requestedFiles.length) return sendJson(res, 400, { error: 'Uno de los archivos ya no está disponible.' });
        if (!text && !images.length && !audioData && !validGif && !files.length) return sendJson(res, 400, { error: 'El mensaje no puede estar vacío.' });
        const key = conversationKey(account.id, target.id);
        if (!privateMessages[key]) privateMessages[key] = [];
        const message = { id: crypto.randomUUID(), clientId: clientMessageId(data), author: account.displayName, username: account.username, avatarData: account.avatarData || '', text, isAccount: true, createdAt: Date.now() };
        if (images.length) message.images = images;
        if (audioData) message.audioData = audioData;
        if (validGif) message.gifUrl = gifUrl;
        if (files.length) message.files = files;
        const saved = await saveNewMessage(key, message, account.id);
        if (saved.created) broadcastPrivateCreated(account, target, saved.message, privateMessages[key]);
        sendJson(res, saved.created ? 201 : 200, await representation(saved.message, compactClient(req)));
        return;
      } catch {
        return sendJson(res, 400, { error: 'Solicitud inválida.' });
      }
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const account = currentAccount(req);
    return sendJson(res, 200, { account: publicAccount(account) });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    try {
      const data = JSON.parse(await readBody(req));
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      const username = normalizeUsername(data.username);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: 'Escribe un correo válido.' });
      if (password.length < 8) return sendJson(res, 400, { error: 'La contraseña debe tener al menos 8 caracteres.' });
      if (!validUsername(username)) return sendJson(res, 400, { error: 'El usuario debe tener entre 3 y 20 caracteres: letras, números o _. Siempre empieza con @.' });
      if (accounts.some(account => account.email === email)) return sendJson(res, 409, { error: 'Ese correo ya está registrado.' });
      if (usernameTaken(username)) return sendJson(res, 409, { error: 'Ese nombre de usuario ya está ocupado.' });
      const credentials = await hashPassword(password);
      if (accounts.some(account => account.email === email) || usernameTaken(username)) return sendJson(res, 409, {error: 'La cuenta ya existe.'});
      const account = { id: crypto.randomUUID(), email, username, displayName: email.split('@')[0].slice(0, 30), avatarData: '', ...credentials, createdAt: Date.now() };
      accounts.push(account);
      saveAccounts();
      const sessionId = createSession(account.id);
      return sendJson(res, 201, { account: publicAccount(account) }, { 'Set-Cookie': `bruma-session=${sessionId}; Max-Age=2592000; HttpOnly; SameSite=Lax; Path=/` });
    } catch {
      return sendJson(res, 400, { error: 'Solicitud inválida.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    try {
      const data = JSON.parse(await readBody(req));
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      const account = accounts.find(item => item.email === email);
      if (!account) return sendJson(res, 401, { error: 'Correo o contraseña incorrectos.' });
      const credentials = await hashPassword(password, account.salt);
      const matches = crypto.timingSafeEqual(Buffer.from(credentials.hash, 'hex'), Buffer.from(account.hash, 'hex'));
      if (!matches) return sendJson(res, 401, { error: 'Correo o contraseña incorrectos.' });
      const sessionId = createSession(account.id);
      return sendJson(res, 200, { account: publicAccount(account) }, { 'Set-Cookie': `bruma-session=${sessionId}; Max-Age=2592000; HttpOnly; SameSite=Lax; Path=/` });
    } catch {
      return sendJson(res, 400, { error: 'Solicitud inválida.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const sessionId = getCookie(req, 'bruma-session');
    sessions.delete(sessionId);
    sessionExpirations.delete(sessionId);
    saveSessions();
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'bruma-session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/' });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/auth/profile') {
    const account = currentAccount(req);
    if (!account) return sendJson(res, 401, { error: 'Inicia sesión para guardar tu perfil.' });
    try {
      const data = JSON.parse(await readBody(req));
      const displayName = String(data.displayName || '').trim().slice(0, 30);
      const username = normalizeUsername(data.username);
      const avatarData = String(data.avatarData || '');
      const avatarIsValid = validAvatar(avatarData);
      if (!displayName) return sendJson(res, 400, { error: 'El nombre no puede estar vacío.' });
      if (!validUsername(username)) return sendJson(res, 400, { error: 'El usuario debe tener entre 3 y 20 caracteres: letras, números o _. Siempre empieza con @.' });
      if (usernameTaken(username, account.id)) return sendJson(res, 409, { error: 'Ese nombre de usuario ya está ocupado.' });
      if (!avatarIsValid) return sendJson(res, 400, { error: 'La foto debe ser PNG, JPEG, WebP o GIF y pesar como máximo 4 MB. Los GIF admiten hasta 1024 × 1024 px.' });
      account.displayName = displayName;
      account.username = username;
      account.avatarData = avatarData;
      saveAccounts();
      return sendJson(res, 200, { account: publicAccount(account) });
    } catch {
      return sendJson(res, 400, { error: 'Solicitud inválida.' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'});
    res.flushHeaders();
    const client = {response: res, guestId, sessionId: getCookie(req, 'bruma-session'), delta: ['2','3'].includes(url.searchParams.get('v')), compact: url.searchParams.get('v') === '3', queue: Promise.resolve(), queued: 0};
    clients.add(client);
    deliver(client, 'messages', visibleMessages(guestId, currentAccount(req)?.id || ''));
    // A reconnect must also recover private messages missed while offline.
    const account = currentAccount(req);
    if (account) for (const friend of accounts) {
      if (!acceptedFriendship(account.id, friend.id)) continue;
      const room = conversationKey(account.id, friend.id);
      deliver(client, 'private', {friendUsername: friend.username, friendDisplayName: friend.displayName || 'Usuario', messages: privateMessages[room] || []});
    }
    req.on('close', () => clients.delete(client));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/messages') {
    try {
      const data = JSON.parse(await readBody(req));
      const author = String(data.author || '').trim().slice(0, 30);
      const text = String(data.text || '').trim().slice(0, 500);
      const imageData = String(data.imageData || '');
      const audioData = String(data.audioData || '');
      const gifUrl = String(data.gifUrl || '');
      const avatarData = String(data.avatarData || '');
      const replyToId = String(data.replyToId || '').trim();
      const account = currentAccount(req);
      const requestedImages = Array.isArray(data.images) ? data.images : (imageData ? [imageData] : []);
      if (requestedImages.length > MAX_IMAGES_PER_MESSAGE) return sendJson(res, 400, { error: `Puedes enviar como máximo ${MAX_IMAGES_PER_MESSAGE} imágenes.` });
      const images = requestedImages
        .map(item => String(item || ''))
        .filter(validInlineImage);
      const validImage = images.length === requestedImages.length && images.length > 0;
      if (requestedImages.length > 0 && !validImage) return sendJson(res, 400, { error: 'Una imagen no es válida o supera el límite de tamaño.' });
      const validAudio = validInlineAudio(audioData);
      const avatarIsValid = validAvatar(avatarData);
      let validGif = false;
      try {
        const parsedGif = new URL(gifUrl);
        validGif = parsedGif.protocol === 'https:' && (parsedGif.hostname === 'giphy.com' || parsedGif.hostname.endsWith('.giphy.com'));
      } catch {}
      const requestedFiles = Array.isArray(data.files) ? data.files : [];
      const files = requestedFiles.filter(file => file && uploads[file.id] && uploads[file.id].complete !== false && !uploads[file.id].recipientAccountId
        && ((uploads[file.id].ownerAccountId && uploads[file.id].ownerAccountId === (account?.id || ''))
          || (uploads[file.id].ownerGuestId && uploads[file.id].ownerGuestId === guestId)))
        .map(file => ({ id: file.id, token: uploads[file.id].token || '', name: uploads[file.id].name, type: uploads[file.id].type, size: uploads[file.id].size }));
      if (files.length !== requestedFiles.length) return sendJson(res, 400, { error: 'Uno de los archivos ya no está disponible.' });
      if (!author || (!text && !validImage && !validAudio && !validGif && !files.length)) return sendJson(res, 400, { error: 'Escribe un mensaje, selecciona una imagen, un GIF, un audio o un archivo.' });
      if (!avatarIsValid) return sendJson(res, 400, { error: 'La foto de perfil no es válida o supera 4 MB.' });
      const effectiveAuthor = account ? account.displayName : author;
      const effectiveAvatar = account ? (account.avatarData || '') : avatarData;
      const message = { id: crypto.randomUUID(), clientId: clientMessageId(data), author: effectiveAuthor, text, isAccount: Boolean(account), createdAt: Date.now() };
      if (account) message.ownerAccountId = account.id;
      else message.ownerGuestId = guestId;
      if (account) message.username = account.username;
      if (validImage) message.images = images;
      if (validAudio) message.audioData = audioData;
      if (validGif) message.gifUrl = gifUrl;
      if (files.length) message.files = files;
      if (effectiveAvatar) message.avatarData = effectiveAvatar;
      if (replyToId) {
        const repliedMessage = groupById.get(replyToId);
        if (!repliedMessage) return sendJson(res, 404, { error: 'El mensaje al que intentas responder ya no existe.' });
        message.replyTo = {
          id: repliedMessage.id,
          author: repliedMessage.author,
          text: repliedMessage.text || (repliedMessage.images ? 'Imagen' : repliedMessage.gifUrl ? 'GIF' : repliedMessage.audioData ? 'Mensaje de voz' : 'Mensaje'),
          avatarData: repliedMessage.avatarData || ''
        };
      }
      const saved = await saveNewMessage('', message, account?.id || guestId);
      if (saved.created) broadcastMessageChange('message-created', saved.message);
      sendJson(res, saved.created ? 201 : 200, await representation(visibleMessage(saved.message, guestId, account?.id || ''), compactClient(req)));
      return;
    } catch {
      return sendJson(res, 400, { error: 'Solicitud inválida.' });
    }
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/messages/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/messages/'.length));
    try {
      const rawBody = await readBody(req);
      const data = rawBody ? JSON.parse(rawBody) : {};
      const index = messages.findIndex(item => item.id === id);
      if (index === -1) return sendJson(res, 404, { error: 'Mensaje no encontrado.' });
      if (!ownsMessage(messages[index], guestId, currentAccount(req)?.id || '')) return sendJson(res, 403, { error: 'Solo puedes borrar tus propios mensajes.' });
      const deleted = messages[index];
      await store.call('delete', {id});
      const currentIndex = messages.findIndex(item => item.id === id);
      if (currentIndex >= 0) messages.splice(currentIndex, 1);
      groupById.delete(id);
      sendJson(res, 200, { ok: true });
      broadcastMessageChange('message-deleted', deleted);
      return;
    } catch {
      return sendJson(res, 400, { error: 'Solicitud inválida.' });
    }
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/messages/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/messages/'.length));
    try {
      const data = JSON.parse(await readBody(req));
      const text = String(data.text || '').trim().slice(0, 500);
      const message = groupById.get(id);
      if (!message) return sendJson(res, 404, { error: 'Mensaje no encontrado.' });
      if (!ownsMessage(message, guestId, currentAccount(req)?.id || '')) return sendJson(res, 403, { error: 'Solo puedes editar tus propios mensajes.' });
      if (!text) return sendJson(res, 400, { error: 'El mensaje no puede quedar vacío.' });
      const updated = await store.call('update', {id, text});
      const index = messages.findIndex(item => item.id === id);
      if (index >= 0) { messages[index] = updated; groupById.set(id, updated); }
      broadcastMessageChange('message-updated', updated);
      sendJson(res, 200, await representation(visibleMessage(updated, guestId, currentAccount(req)?.id || ''), compactClient(req)));
      return;
    } catch {
      return sendJson(res, 400, { error: 'Solicitud inválida.' });
    }
  }

  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  return sendJson(res, 405, { error: 'Método no permitido' });
}
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error('Petición fallida:', error.message);
    if (res.headersSent) res.destroy();
    else sendJson(res, 400, {error: 'No se pudo completar la petición.'});
  });
});
async function start() {
  const rows = await store.call('init', {});
  messages.length = 0;
  for (const room of Object.keys(privateMessages)) delete privateMessages[room];
  for (const {room, message} of rows) {
    if (room) (privateMessages[room] ||= []).push(message);
    else { messages.push(message); groupById.set(message.id, message); }
  }
  nextCleanup = Date.now() + 30000;
  setInterval(() => {
    cleanupMessages().catch(error => console.error('Limpieza pendiente:', error.message));
    for (const client of clients) {
      if (client.response.writableLength > 32_000_000) client.response.destroy();
      else client.response.write(': ping\n\n');
    }
  }, 30000).unref();
  server.listen(PORT, HOST, () => console.log(`Chat efímero disponible en http://localhost:${PORT}`));
}
start().catch(error => { console.error('No se pudo abrir el almacenamiento:', error.message); process.exit(1); });
