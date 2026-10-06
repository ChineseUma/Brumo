const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {MessageStore} = require('../lib/message-store');
async function fixture(t, seed = {group: [], privateRooms: {}}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruma-store-'));
  const store = new MessageStore(directory);
  t.after(async () => { await store.close().catch(() => {}); fs.rmSync(directory, {recursive: true, force: true}); });
  const initial = await store.call('init', seed);
  return {store, directory, initial};
}
function message(extra = {}) { return {id: crypto.randomUUID(), author: 'Prueba', text: 'hola 日本', createdAt: Date.now(), ...extra}; }
function rowCount(directory, table) {
  const db = new DatabaseSync(path.join(directory, 'chat.sqlite'), {readOnly: true});
  try { return db.prepare(`SELECT count(*) AS total FROM ${table}`).get().total; } finally { db.close(); }
}
test('un reintento concurrente tiene una sola confirmación persistida, aislada por autor', async t => {
  const {store, directory} = await fixture(t);
  const clientId = crypto.randomUUID();
  const results = await Promise.all(Array.from({length: 12}, () => store.call('create', {owner:'alice', room:'', message:message({clientId})})));
  assert.equal(results.filter(result => result.created).length, 1);
  assert.equal(new Set(results.map(result => result.message.id)).size, 1);
  assert.equal(rowCount(directory, 'messages'), 1);
  await store.call('create', {owner:'bob', room:'', message:message({clientId})});
  assert.equal(rowCount(directory, 'messages'), 2);
  await assert.rejects(store.call('create', {owner:'alice', room:'private', message:message({clientId})}), /otra conversación/);
});
test('medios deduplicados, metadatos compactos y representación antigua compatible', async t => {
  const {store, directory} = await fixture(t);
  const image = 'data:image/png;base64,' + crypto.randomBytes(128000).toString('base64');
  const audio = 'data:audio/mp4;base64,' + Buffer.from('sound fixture').toString('base64');
  const original = message({images:[image,image], avatarData:image, audioData:audio});
  const first = await store.call('create', {owner:'alice', message:original});
  await store.call('create', {owner:'bob', room:'alice:bob', message:message({images:[image]})});
  assert.equal(rowCount(directory, 'media'), 2);
  assert.ok(Buffer.byteLength(JSON.stringify(first.message)) < 1000);
  assert.equal(first.message.images[0], first.message.avatarData);
  const restored = await store.call('expand', first.message);
  assert.deepEqual(restored, original);
  const media = await store.call('media', {id:first.message.images[0].split('/').pop()});
  assert.equal(media.mime, 'image/png');
  assert.equal(media.data.length, 128000);
});
test('el texto del usuario no se interpreta como un adjunto', async t => {
  const {store, directory} = await fixture(t);
  const text = 'data:image/png;base64,aGVsbG8=';
  const saved = await store.call('create', {owner:'alice', message:message({text})});
  assert.equal(saved.message.text, text);
  assert.equal(rowCount(directory, 'media'), 0);
});
test('importación única, edición y borrado sobreviven a la reapertura', async t => {
  const seed = message();
  const {store, directory, initial} = await fixture(t, {group:[seed],privateRooms:{}});
  assert.equal(initial.length, 1);
  const added = await store.call('create', {owner:'alice', message:message({clientId:crypto.randomUUID()})});
  await store.call('update', {id:added.message.id, text:'actualizado'});
  await store.call('delete', {id:seed.id});
  // Terminate without a graceful checkpoint: the committed WAL must recover.
  await store.worker.terminate();
  const reopened = new MessageStore(directory);
  try {
    const rows = await reopened.call('init', {group:[seed],privateRooms:{}});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message.text, 'actualizado');
    assert.equal(rows[0].message.edited, true);
    const retry = await reopened.call('create', {owner:'alice', message:added.message});
    assert.equal(retry.created, false);
    assert.equal(retry.message.text, 'actualizado');
  } finally { await reopened.close(); }
});
test('fallo de importación revierte también los medios y permite reintentar', async t => {
  const {store, directory} = await fixture(t);
  const malformed = message({id:undefined, images:['data:image/png;base64,aGVsbG8=']});
  // SQLite TEXT PRIMARY KEY permits null unless explicitly constrained: validation
  // belongs to the store too, so a malformed mutation must fail atomically.
  await assert.rejects(store.call('create', {owner:'alice', message:malformed}));
  assert.equal(rowCount(directory, 'messages'), 0);
  assert.equal(rowCount(directory, 'media'), 0);
});
test('caducidad grupal a medianoche, privados a 24 h y recogida de medios sin referencias', async t => {
  const {store, directory} = await fixture(t);
  const start = new Date(); start.setHours(23,59,0,0);
  const image = 'data:image/png;base64,aGVsbG8=';
  const group = await store.call('create', {owner:'alice', message:message({createdAt:start.getTime(), images:[image]})});
  const dm = await store.call('create', {owner:'alice', room:'alice:bob', message:message({createdAt:start.getTime(), images:[image]})});
  const removed = await store.call('prune', {now:start.getTime()+120000});
  assert.deepEqual(removed.map(row => row.id), [group.message.id]);
  assert.equal(rowCount(directory, 'media'), 1);
  assert.deepEqual((await store.call('prune', {now:start.getTime()+24*3600000})).map(row => row.id), [dm.message.id]);
  assert.equal(rowCount(directory, 'media'), 0);
});
test('la foto de una respuesta mantiene su referencia al expirar el mensaje original', async t => {
  const {store, directory} = await fixture(t);
  const first = await store.call('create', {owner:'a', room:'a:b', message:message({createdAt:Date.now()-3600000, avatarData:'data:image/png;base64,aGVsbG8='})});
  await store.call('create', {owner:'b', room:'a:b', message:message({replyTo:{id:first.message.id, text:'hola', avatarData:first.message.avatarData}})});
  await store.call('prune', {now:Date.now()+23*3600000+1000});
  assert.equal(rowCount(directory, 'media'), 1);
});

test('una ráfaga conserva orden, aísla fallos y confirma solo mensajes recuperables', async t => {
  const {store, directory} = await fixture(t);
  const first = message({clientId: crypto.randomUUID()});
  const second = message({clientId: crypto.randomUUID()});
  const results = await Promise.allSettled([
    store.call('create', {owner: 'a', message: first}),
    // Fails after compacting the new image: that image must roll back too.
    store.call('create', {owner: 'b', message: {...first, clientId: crypto.randomUUID(), images: ['data:image/png;base64,YmFk']}}),
    store.call('create', {owner: 'a', message: second}),
    store.call('create', {owner: 'a', message: first}),
    store.call('update', {id: second.id, text: 'edición inmediatamente después del envío'})
  ]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
  assert.equal(results[3].value.created, false);
  assert.equal(rowCount(directory, 'messages'), 2);
  assert.equal(rowCount(directory, 'media'), 0);
  await store.worker.terminate();
  const recovered = new MessageStore(directory);
  try {
    const rows = await recovered.call('init', {});
    assert.deepEqual(rows.map(row => row.message.id), [first.id, second.id]);
    assert.equal(rows[1].message.text, 'edición inmediatamente después del envío');
  } finally { await recovered.close(); }
});

test('cerrar justo después de una ráfaga espera todas sus escrituras', async t => {
  const {store, directory} = await fixture(t);
  const sends = Array.from({length: 70}, () => store.call('create', {owner: 'a', message: message()}));
  const closing = store.close();
  assert.equal((await Promise.all(sends)).filter(result => result.created).length, 70);
  await closing;
  assert.equal(rowCount(directory, 'messages'), 70);
});
