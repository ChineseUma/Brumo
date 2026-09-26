const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || '';
// Cambia este valor para modificar el máximo de imágenes por mensaje.
const MAX_IMAGES_PER_MESSAGE = Number(process.env.MAX_IMAGES_PER_MESSAGE) || 10;
const MAX_REQUEST_BYTES = 30_000_000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STORAGE_DIR = path.join(__dirname, 'storage');
const STORAGE_FILE = path.join(STORAGE_DIR, 'messages.json');
const ACCOUNTS_FILE = path.join(STORAGE_DIR, 'accounts.json');
const FRIENDS_FILE = path.join(STORAGE_DIR, 'friends.json');
const PRIVATE_MESSAGES_FILE = path.join(STORAGE_DIR, 'private-messages.json');
const scrypt = promisify(crypto.scrypt);
const clients = new Set();
const messages = [];
const accounts = [];
const friendRequests = [];
const privateMessages = {};
const sessions = new Map();
let lastDailyCleanupDate = '';

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function saveMessages() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const temporaryFile = `${STORAGE_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(messages), 'utf8');
  fs.renameSync(temporaryFile, STORAGE_FILE);
}

function deleteSavedMessages() {
  try { fs.unlinkSync(STORAGE_FILE); } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudo borrar el archivo de mensajes:', error.message);
  }
}

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

function savePrivateMessages() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  const temporaryFile = `${PRIVATE_MESSAGES_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(privateMessages), 'utf8');
  fs.renameSync(temporaryFile, PRIVATE_MESSAGES_FILE);
}

function loadAccounts() {
  try {
    const savedAccounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    if (Array.isArray(savedAccounts)) accounts.push(...savedAccounts);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudieron cargar las cuentas:', error.message);
  }
}

function loadFriendData() {
  try {
    const saved = JSON.parse(fs.readFileSync(FRIENDS_FILE, 'utf8'));
    if (Array.isArray(saved)) friendRequests.push(...saved);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudieron cargar las amistades:', error.message);
  }
  try {
    const saved = JSON.parse(fs.readFileSync(PRIVATE_MESSAGES_FILE, 'utf8'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) Object.assign(privateMessages, saved);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudieron cargar los mensajes privados:', error.message);
  }
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derivedKey = await scrypt(password, salt, 64);
  return { salt, hash: derivedKey.toString('hex') };
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  const cookie = cookies.find(item => item.trim().startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : '';
}

function currentAccount(req) {
  const sessionId = getCookie(req, 'bruma-session');
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

function visibleMessages(guestId, accountId) {
  return messages.map(({ senderId, ownerGuestId, ownerAccountId, ...message }) => ({
    ...message,
    canEdit: ownsMessage({ ownerGuestId, ownerAccountId }, guestId, accountId)
  }));
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
  return { username: account.username, displayName: account.displayName || '', avatarData: account.avatarData || '' };
}

function conversationKey(firstId, secondId) {
  return [firstId, secondId].sort().join(':');
}

function acceptedFriendship(firstId, secondId) {
  return friendRequests.some(request => request.status === 'accepted'
    && ((request.fromId === firstId && request.toId === secondId) || (request.fromId === secondId && request.toId === firstId)));
}

function cleanPrivateMessages() {
  const expiration = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(privateMessages)) {
    const remaining = (privateMessages[key] || []).filter(message => now - message.createdAt < expiration);
    if (remaining.length !== (privateMessages[key] || []).length) changed = true;
    if (remaining.length) privateMessages[key] = remaining;
    else delete privateMessages[key];
  }
  if (changed) savePrivateMessages();
}

function legacyUsername(account) {
  const base = String(account.displayName || account.email.split('@')[0] || 'usuario')
    .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'usuario';
  let username = `@${base}`;
  let suffix = 2;
  while (usernameTaken(username, account.id)) username = `@${base.slice(0, 18 - String(suffix).length)}${suffix++}`;
  return username;
}

function loadMessages() {
  try {
    const fileDate = localDateKey(fs.statSync(STORAGE_FILE).mtime);
    if (fileDate !== localDateKey()) {
      deleteSavedMessages();
      return;
    }
    const savedMessages = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
    if (Array.isArray(savedMessages)) messages.push(...savedMessages);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('No se pudieron cargar los mensajes guardados:', error.message);
  }
}

loadMessages();
loadAccounts();
let accountsChanged = false;
for (const account of accounts) {
  if (!validUsername(account.username) || usernameTaken(account.username, account.id)) {
    account.username = legacyUsername(account);
    accountsChanged = true;
  }
}
if (accountsChanged) saveAccounts();
loadFriendData();
cleanPrivateMessages();

function sendJson(res, status, data, headers = {}) {
  const existingCookie = res.getHeader('Set-Cookie');
  if (existingCookie && headers['Set-Cookie']) {
    headers = { ...headers, 'Set-Cookie': [existingCookie, headers['Set-Cookie']].flat() };
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.response.write(payload);
}

function broadcastMessages() {
  for (const client of clients) {
    const accountId = sessions.get(client.sessionId) || '';
    client.response.write(`event: messages\ndata: ${JSON.stringify(visibleMessages(client.guestId, accountId))}\n\n`);
  }
}

function broadcastPrivate(first, second, conversation) {
  for (const client of clients) {
    const accountId = sessions.get(client.sessionId);
    if (accountId !== first.id && accountId !== second.id) continue;
    const friendUsername = accountId === first.id ? second.username : first.username;
    client.response.write(`event: private\ndata: ${JSON.stringify({ friendUsername, messages: conversation })}\n\n`);
  }
}

function removeExpiredMessages() {
  const now = Date.now();
  const before = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (now - messages[i].createdAt >= 12 * 60 * 60 * 1000) messages.splice(i, 1);
  }
  if (messages.length !== before) {
    if (messages.length) saveMessages();
    else deleteSavedMessages();
    broadcastMessages();
  }
}

function runDailyCleanup() {
  const now = new Date();
  const dateKey = localDateKey(now);
  if (now.getHours() !== 0 || now.getMinutes() !== 0 || lastDailyCleanupDate === dateKey) return;
  lastDailyCleanupDate = dateKey;
  messages.length = 0;
  deleteSavedMessages();
  broadcastMessages();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_REQUEST_BYTES) tooLarge = true;
    });
    req.on('end', () => tooLarge ? reject(new Error('Payload demasiado grande')) : resolve(body));
    req.on('error', reject);
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const guestId = guestIdentity(req, res);
  runDailyCleanup();
  removeExpiredMessages();

  if (req.method === 'GET' && url.pathname === '/api/messages') {
    return sendJson(res, 200, visibleMessages(guestId, currentAccount(req)?.id || ''));
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, { giphyApiKey: GIPHY_API_KEY, maxImages: MAX_IMAGES_PER_MESSAGE });
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
        friendRequests.push({ id: crypto.randomUUID(), fromId: account.id, toId: target.id, status: 'pending', createdAt: Date.now() });
        saveFriendRequests();
        broadcast('friends', { accountIds: [account.id, target.id] });
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
      cleanPrivateMessages();
      return sendJson(res, 200, privateMessages[conversationKey(account.id, target.id)] || []);
    }

    if (req.method === 'POST' && url.pathname === '/api/private/messages') {
      try {
        const data = JSON.parse(await readBody(req));
        const username = normalizeUsername(data.recipientUsername);
        const target = accounts.find(item => item.username === username);
        const text = String(data.text || '').trim().slice(0, 500);
        if (!target || !acceptedFriendship(account.id, target.id)) return sendJson(res, 403, { error: 'Solo puedes escribir a tus amigos.' });
        if (!text) return sendJson(res, 400, { error: 'El mensaje privado no puede estar vacío.' });
        const key = conversationKey(account.id, target.id);
        if (!privateMessages[key]) privateMessages[key] = [];
        const message = { id: crypto.randomUUID(), author: account.displayName, username: account.username, avatarData: account.avatarData || '', text, isAccount: true, createdAt: Date.now() };
        privateMessages[key].push(message);
        savePrivateMessages();
        broadcastPrivate(account, target, privateMessages[key]);
        return sendJson(res, 201, message);
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
      const account = { id: crypto.randomUUID(), email, username, displayName: email.split('@')[0].slice(0, 30), avatarData: '', ...credentials, createdAt: Date.now() };
      accounts.push(account);
      saveAccounts();
      const sessionId = crypto.randomBytes(32).toString('hex');
      sessions.set(sessionId, account.id);
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
      const sessionId = crypto.randomBytes(32).toString('hex');
      sessions.set(sessionId, account.id);
      return sendJson(res, 200, { account: publicAccount(account) }, { 'Set-Cookie': `bruma-session=${sessionId}; Max-Age=2592000; HttpOnly; SameSite=Lax; Path=/` });
    } catch {
      return sendJson(res, 400, { error: 'Solicitud inválida.' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const sessionId = getCookie(req, 'bruma-session');
    sessions.delete(sessionId);
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
      const validAvatar = !avatarData || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatarData) && avatarData.length <= 400_000;
      if (!displayName) return sendJson(res, 400, { error: 'El nombre no puede estar vacío.' });
      if (!validUsername(username)) return sendJson(res, 400, { error: 'El usuario debe tener entre 3 y 20 caracteres: letras, números o _. Siempre empieza con @.' });
      if (usernameTaken(username, account.id)) return sendJson(res, 409, { error: 'Ese nombre de usuario ya está ocupado.' });
      if (!validAvatar) return sendJson(res, 400, { error: 'La foto de perfil no es válida.' });
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
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    const client = { response: res, guestId, sessionId: getCookie(req, 'bruma-session') };
    res.write(`event: messages\ndata: ${JSON.stringify(visibleMessages(guestId, currentAccount(req)?.id || ''))}\n\n`);
    clients.add(client);
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
        .filter(item => /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(item) && item.length <= 5_500_000);
      const validImage = images.length === requestedImages.length && images.length > 0;
      if (requestedImages.length > 0 && !validImage) return sendJson(res, 400, { error: 'Una imagen no es válida o supera el límite de tamaño.' });
      const validAudio = /^data:audio\/(webm|ogg|mpeg|mp4|wav)(?:;[^,]+)?;base64,[A-Za-z0-9+/=]+$/.test(audioData) && audioData.length <= 8_500_000;
      const validAvatar = !avatarData || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatarData) && avatarData.length <= 400_000;
      let validGif = false;
      try {
        const parsedGif = new URL(gifUrl);
        validGif = parsedGif.protocol === 'https:' && (parsedGif.hostname === 'giphy.com' || parsedGif.hostname.endsWith('.giphy.com'));
      } catch {}
      if (!author || (!text && !validImage && !validAudio && !validGif)) return sendJson(res, 400, { error: 'Escribe un mensaje, selecciona una imagen, un GIF o graba un audio.' });
      if (!validAvatar) return sendJson(res, 400, { error: 'La foto de perfil no es válida.' });
      const effectiveAuthor = account ? account.displayName : author;
      const effectiveAvatar = account ? (account.avatarData || '') : avatarData;
      const message = { id: crypto.randomUUID(), author: effectiveAuthor, text, isAccount: Boolean(account), createdAt: Date.now() };
      if (account) message.ownerAccountId = account.id;
      else message.ownerGuestId = guestId;
      if (account) message.username = account.username;
      if (validImage) message.images = images;
      if (validAudio) message.audioData = audioData;
      if (validGif) message.gifUrl = gifUrl;
      if (effectiveAvatar) message.avatarData = effectiveAvatar;
      if (replyToId) {
        const repliedMessage = messages.find(item => item.id === replyToId);
        if (!repliedMessage) return sendJson(res, 404, { error: 'El mensaje al que intentas responder ya no existe.' });
        message.replyTo = {
          id: repliedMessage.id,
          author: repliedMessage.author,
          text: repliedMessage.text || (repliedMessage.images ? 'Imagen' : repliedMessage.gifUrl ? 'GIF' : repliedMessage.audioData ? 'Mensaje de voz' : 'Mensaje'),
          avatarData: repliedMessage.avatarData || ''
        };
      }
      messages.push(message);
      saveMessages();
      broadcastMessages();
      return sendJson(res, 201, visibleMessages(guestId, account?.id || '').at(-1));
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
      messages.splice(index, 1);
      if (messages.length) saveMessages();
      else deleteSavedMessages();
      broadcastMessages();
      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'Solicitud inválida.' });
    }
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/messages/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/messages/'.length));
    try {
      const data = JSON.parse(await readBody(req));
      const text = String(data.text || '').trim().slice(0, 500);
      const message = messages.find(item => item.id === id);
      if (!message) return sendJson(res, 404, { error: 'Mensaje no encontrado.' });
      if (!ownsMessage(message, guestId, currentAccount(req)?.id || '')) return sendJson(res, 403, { error: 'Solo puedes editar tus propios mensajes.' });
      if (!text) return sendJson(res, 400, { error: 'El mensaje no puede quedar vacío.' });
      message.text = text;
      message.edited = true;
      saveMessages();
      broadcastMessages();
      return sendJson(res, 200, visibleMessages(guestId, currentAccount(req)?.id || '').find(item => item.id === id));
    } catch {
      return sendJson(res, 400, { error: 'Solicitud inválida.' });
    }
  }

  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  return sendJson(res, 405, { error: 'Método no permitido' });
});

setInterval(() => {
  runDailyCleanup();
  removeExpiredMessages();
  cleanPrivateMessages();
}, 30_000);
server.listen(PORT, HOST, () => console.log(`Chat efímero disponible en http://localhost:${PORT}`));
