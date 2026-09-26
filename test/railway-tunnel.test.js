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
  await waitFor(async () => (await (await fetch(`${url}/health`)).json()).connected);

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
  const disk = JSON.parse(fs.readFileSync(path.join(temp, 'storage', 'messages.json'), 'utf8'));
  assert.equal(disk[0].text, 'Guardado en laptop');
  const register = await fetch(`${url}/api/auth/register`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'railway-test@example.com', username: '@railway_test', password: 'password123' })
  });
  assert.equal(register.status, 201);
  assert.match(register.headers.get('set-cookie'), /bruma-session=/);
  assert.match(register.headers.get('set-cookie'), /Secure/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'storage', 'accounts.json'), 'utf8')).length, 1);

  const controller = new AbortController();
  const events = await fetch(`${url}/api/events`, { headers: { Cookie: cookie }, signal: controller.signal });
  assert.equal(events.status, 200);
  assert.match(events.headers.get('content-type'), /text\/event-stream/);
  const reader = events.body.getReader();
  const firstEvent = await reader.read();
  assert.match(new TextDecoder().decode(firstEvent.value), /Guardado en laptop/);
  controller.abort();
  await reader.cancel().catch(() => {});

  client.kill();
  await waitFor(async () => !(await (await fetch(`${url}/health`)).json()).connected);
  assert.equal((await fetch(url)).status, 503);
});
