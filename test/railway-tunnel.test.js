const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}

async function waitFor(predicate, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await predicate()) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail('La conexión del túnel no llegó a estar lista');
}

test('Railway reenvía la app y los eventos, mientras los datos quedan en la laptop', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bruma-tunnel-'));
  fs.mkdirSync(path.join(temp, 'public'));
  fs.copyFileSync(path.join(__dirname, '..', 'server.js'), path.join(temp, 'server.js'));
  fs.cpSync(path.join(__dirname, '..', 'lib'), path.join(temp, 'lib'), {recursive: true});
  fs.writeFileSync(path.join(temp, 'public', 'index.html'), '<h1>Bruma local</h1>');
  const localPort = await freePort();
  const relayPort = await freePort();
  const token = 'test-' + 'a'.repeat(60);
  const local = spawn(process.execPath, [path.join(temp, 'server.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(localPort) }, stdio: 'ignore'
  });
  const relay = spawn(process.execPath, [path.join(__dirname, '..', 'railway', 'relay.js')], {
    env: { ...process.env, PORT: String(relayPort), TUNNEL_TOKEN: token }, stdio: 'ignore'
  });
  let client;
  t.after(() => {
    client?.kill();
    relay.kill();
    local.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const url = `http://127.0.0.1:${relayPort}`;
  await waitFor(async () => (await fetch(`${url}/health`)).ok);
  assert.equal((await (await fetch(`${url}/health`)).json()).connected, false);
  assert.equal((await fetch(url)).status, 503);
  const rejected = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${relayPort}/_bruma/tunnel`);
    ws.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode); });
    ws.once('error', reject);
  });
  assert.equal(rejected, 401);

  client = spawn(process.execPath, [path.join(__dirname, '..', 'railway', 'client.js')], {
    env: { ...process.env, RAILWAY_URL: url, TUNNEL_TOKEN: token, LOCAL_PORT: String(localPort) }, stdio: 'ignore'
  });
  await waitFor(async () => (await (await fetch(`${url}/health`)).json()).protocol === 2);

  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Bruma local/);
  const cookieHeader = page.headers.get('set-cookie');
  assert.match(cookieHeader, /bruma-guest=/);
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Secure/);
  const cookie = cookieHeader.split(';', 1)[0];

  const sent = await fetch(`${url}/api/messages`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: 'Desde Railway', text: 'Guardado en laptop' })
  });
  assert.equal(sent.status, 201);
  const saved = await sent.json();
  assert.equal(saved.canEdit, true);
  const list = await fetch(`${url}/api/messages`, { headers: { Cookie: cookie } });
  assert.equal((await list.json())[0].text, 'Guardado en laptop');
  const {DatabaseSync} = require('node:sqlite');
  const db = new DatabaseSync(path.join(temp, 'storage', 'chat.sqlite'), {readOnly: true});
  assert.equal(JSON.parse(db.prepare('SELECT body FROM messages').get().body).text, 'Guardado en laptop');
  db.close();

  const uploadStart = await fetch(`${url}/api/uploads/start`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'prueba.txt', type: 'text/plain', size: 13 })
  });
  assert.equal(uploadStart.status, 201);
  const uploadId = (await uploadStart.json()).id;
  const uploadChunk = await fetch(`${url}/api/uploads/${uploadId}/chunk`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream' }, body: 'archivo bruma'
  });
  assert.equal(uploadChunk.status, 200);
  const uploadFinish = await fetch(`${url}/api/uploads/${uploadId}/finish`, { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(uploadFinish.status, 201);
  const uploaded = await uploadFinish.json();
  const fileMessage = await fetch(`${url}/api/messages`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: 'Desde Railway', files: [uploaded] })
  });
  assert.equal(fileMessage.status, 201);
  const downloaded = await fetch(`${url}${uploaded.url}`);
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), 'archivo bruma');
  const register = await fetch(`${url}/api/auth/register`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'railway-test@example.com', username: '@railway_test', password: 'password123' })
  });
  assert.equal(register.status, 201);
  assert.match(register.headers.get('set-cookie'), /bruma-session=/);
  assert.match(register.headers.get('set-cookie'), /Secure/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'storage', 'accounts.json'), 'utf8')).length, 1);

  const controller = new AbortController();
  const events = await fetch(`${url}/api/events?v=2`, { headers: { Cookie: cookie }, signal: controller.signal });
  assert.equal(events.status, 200);
  assert.match(events.headers.get('content-type'), /text\/event-stream/);
  const reader = events.body.getReader();
  const firstEvent = await reader.read();
  assert.match(new TextDecoder().decode(firstEvent.value), /Guardado en laptop/);
  const second = await fetch(`${url}/api/messages`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: 'Desde Railway', text: 'Solo el mensaje nuevo' })
  });
  assert.equal(second.status, 201);
  let update = '';
  while (!update.includes('\n\n')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    update += new TextDecoder().decode(chunk.value);
  }
  assert.match(update, /event: message-created/);
  assert.match(update, /Solo el mensaje nuevo/);
  assert.doesNotMatch(update, /Guardado en laptop/);
  controller.abort();
  await reader.cancel().catch(() => {});

  // More than one wire frame, gzip in flight, then compact media retrieval.
  const crypto = require('node:crypto');
  const {gzipSync} = require('node:zlib');
  const bytes = crypto.randomBytes(250000);
  const compactPost = await fetch(`${url}/api/messages`, {
    method:'POST', headers:{Cookie:cookie,'Content-Type':'application/json','Content-Encoding':'gzip','X-Bruma-Version':'3'},
    body:gzipSync(JSON.stringify({author:'Prueba',text:'comprimido',clientId:crypto.randomUUID(),images:['data:image/png;base64,'+bytes.toString('base64')]}))
  });
  assert.equal(compactPost.status,201);
  const compactBody = await compactPost.json();
  assert.match(compactBody.images[0], /^\/api\/media\//);
  assert.deepEqual(Buffer.from(await(await fetch(url+compactBody.images[0])).arrayBuffer()),bytes);

  client.kill();
  await waitFor(async () => !(await (await fetch(`${url}/health`)).json()).connected);
  assert.equal((await fetch(url)).status, 503);
});
