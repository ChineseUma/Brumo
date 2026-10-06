'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
fs.mkdirSync(workerData.directory, { recursive: true });
const db = new DatabaseSync(path.join(workerData.directory, 'chat.sqlite'), { timeout: 5000 });
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, room TEXT NOT NULL, owner TEXT NOT NULL,
    client_id TEXT, created INTEGER NOT NULL, expires INTEGER NOT NULL, body TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS retry_key ON messages(owner,client_id) WHERE client_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS expiration ON messages(expires);
  CREATE TABLE IF NOT EXISTS media_refs (message TEXT REFERENCES messages(id) ON DELETE CASCADE,
    media TEXT REFERENCES media(id), PRIMARY KEY(message,media));
  CREATE INDEX IF NOT EXISTS media_reference ON media_refs(media);`);
const setting = db.prepare('SELECT value FROM settings WHERE key=?');
let secret = setting.get('media-key')?.value;
if (!secret) { secret = crypto.randomBytes(32).toString('hex'); db.prepare('INSERT INTO settings VALUES (?,?)').run('media-key', secret); }
const insertMedia = db.prepare('INSERT OR IGNORE INTO media VALUES (?,?,?)');
const readMedia = db.prepare('SELECT mime,data FROM media WHERE id=?');
const hasMedia = db.prepare('SELECT 1 FROM media WHERE id=?');
const insertRef = db.prepare('INSERT OR IGNORE INTO media_refs VALUES (?,?)');
const insert = db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?)');
const byId = db.prepare('SELECT room,body FROM messages WHERE id=?');
const duplicate = db.prepare('SELECT room,body FROM messages WHERE owner=? AND client_id=?');
const assetPattern = /^\/api\/media\/([a-f0-9]{64})$/;
function mapMedia(message, convert) {
  if (Array.isArray(message)) return message.map(item => mapMedia(item, convert));
  if (!message || typeof message !== 'object') return message;
  const result = {...message};
  for (const field of ['avatarData', 'audioData', 'imageData']) if (typeof result[field] === 'string') result[field] = convert(result[field]);
  if (Array.isArray(result.images)) result.images = result.images.map(convert);
  for (const field of ['message', 'messages', 'replyTo']) if (result[field]) result[field] = mapMedia(result[field], convert);
  return result;
}
function compact(message, refs) {
  return mapMedia(message, value => {
    const existing = assetPattern.exec(value);
    if (existing) { if (hasMedia.get(existing[1])) refs.add(existing[1]); return value; }
    const match = /^data:((?:image|audio)\/[^;,]+(?:;[^,]+)?);base64,([A-Za-z0-9+/=]+)$/.exec(value);
    if (!match) return value;
    const bytes = Buffer.from(match[2], 'base64'), mime = match[1];
    const id = crypto.createHmac('sha256', secret).update(mime).update(bytes).digest('hex');
    insertMedia.run(id, mime, bytes); refs.add(id);
    return `/api/media/${id}`;
  });
}
function expand(message) {
  const cache = new Map();
  return mapMedia(message, value => {
    const match = assetPattern.exec(value);
    if (!match) return value;
    if (!cache.has(value)) {
      const media = readMedia.get(match[1]);
      cache.set(value, media ? `data:${media.mime};base64,${Buffer.from(media.data).toString('base64')}` : '');
    }
    return cache.get(value);
  });
}
function expires(message, room) {
  const ttl = message.createdAt + (room ? 24 : 12) * 3600000;
  if (room) return ttl;
  const midnight = new Date(message.createdAt); midnight.setHours(24,0,0,0);
  return Math.min(ttl, midnight.getTime());
}
function create({ room = '', owner = '', message }) {
  if (!message || typeof message.id !== 'string' || !message.id || !Number.isFinite(message.createdAt)) throw new Error('Mensaje inválido.');
  if (message.clientId) {
    const previous = duplicate.get(owner, message.clientId);
    if (previous) {
      if (previous.room !== room) throw new Error('Este envío ya pertenece a otra conversación.');
      return { created: false, message: JSON.parse(previous.body) };
    }
  }
  const refs = new Set();
  const stored = compact(message, refs);
  insert.run(stored.id, room, owner, stored.clientId || null, stored.createdAt, expires(stored, room), JSON.stringify(stored));
  for (const id of refs) insertRef.run(stored.id, id);
  return { created: true, message: stored };
}
function transaction(action) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function prune(now) {
  const removed = db.prepare('SELECT id,room FROM messages WHERE expires<=?').all(now);
  db.prepare('DELETE FROM messages WHERE expires<=?').run(now);
  db.exec('DELETE FROM media WHERE NOT EXISTS(SELECT 1 FROM media_refs WHERE media_refs.media=media.id)');
  return removed;
}
const operations = {
  init({ group, privateRooms }) {
    const legacy = (name, fallback) => {
      try { return JSON.parse(fs.readFileSync(path.join(workerData.directory, name), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
    };
    transaction(() => {
      if (!setting.get('imported')) {
        group ??= legacy('messages.json', []);
        privateRooms ??= legacy('private-messages.json', {});
        if (!Array.isArray(group) || !privateRooms || typeof privateRooms !== 'object' || Array.isArray(privateRooms)) throw new Error('Historial antiguo inválido.');
        for (const message of group) if (expires(message, '') > Date.now()) create({message});
        for (const [room, list] of Object.entries(privateRooms)) for (const message of list) {
          if (expires(message, room) > Date.now()) create({room, message});
        }
        db.prepare('INSERT INTO settings VALUES (?,?)').run('imported', '1');
      }
      prune(Date.now());
    });
    return db.prepare('SELECT room,body FROM messages ORDER BY created,rowid').all().map(row => ({room: row.room, message: JSON.parse(row.body)}));
  },
  create: data => transaction(() => create(data)),
  update({id, text}) {
    return transaction(() => {
      const row = byId.get(id);
      if (!row || row.room) throw new Error('Mensaje no encontrado.');
      const message = JSON.parse(row.body);
      message.text = text; message.edited = true;
      db.prepare('UPDATE messages SET body=? WHERE id=?').run(JSON.stringify(message), id);
      return message;
    });
  },
  delete({id}) { return transaction(() => db.prepare('DELETE FROM messages WHERE id=?').run(id).changes); },
  prune: ({now}) => transaction(() => prune(now)),
  expand: value => expand(value),
  media({id, range}) {
    const meta = db.prepare('SELECT mime,length(data) AS total FROM media WHERE id=?').get(id);
    if (!meta) return null;
    if (range) {
      const start = Number(range.start), end = Math.min(Number(range.end ?? meta.total - 1), meta.total - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= meta.total) return {...meta, invalid: true};
      return {...meta, start, end, data: db.prepare('SELECT substr(data,?,?) AS data FROM media WHERE id=?').get(start+1,end-start+1,id).data};
    }
    return {...meta, data: readMedia.get(id).data};
  },
  close() { db.close(); return true; }
};
parentPort.on('message', ({id, method, data}) => {
  if (method === 'createBatch') {
    let replies;
    try {
      replies = transaction(() => data.map(request => {
        // An invalid send must not roll back its valid neighbours or leave media behind.
        db.exec('SAVEPOINT send');
        try {
          const result = create(request.data);
          db.exec('RELEASE send');
          return {id: request.id, result};
        } catch (error) {
          db.exec('ROLLBACK TO send; RELEASE send');
          return {id: request.id, error: error.message};
        }
      }));
    } catch (error) {
      replies = data.map(request => ({id: request.id, error: error.message}));
    }
    // FULL synchronous WAL is committed before any sender receives confirmation.
    for (const reply of replies) parentPort.postMessage(reply);
    return;
  }
  try {
    if (!Object.hasOwn(operations, method)) throw new Error('Operación desconocida');
    const result = operations[method](data);
    parentPort.postMessage({id, result}, method === 'media' && result?.data ? [result.data.buffer] : []);
  } catch (error) { parentPort.postMessage({id, error: error.message}); }
});
