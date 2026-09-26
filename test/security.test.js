const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

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

function browser(base) {
  const cookies = new Map();
  return {
    async request(route, method = 'GET', body) {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: {
          Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      for (const item of response.headers.getSetCookie()) {
        const [name, value] = item.split(';', 1)[0].split('=');
        if (value) cookies.set(name, value);
        else cookies.delete(name);
      }
      return { status: response.status, data: await response.json() };
    },
    async visit() {
      const response = await fetch(base, { headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') } });
      for (const item of response.headers.getSetCookie()) {
        const [name, value] = item.split(';', 1)[0].split('=');
        cookies.set(name, value);
      }
      assert.equal(response.status, 200);
    },
    async events() {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/events`, {
        headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
        signal: controller.signal
      });
      assert.equal(response.status, 200);
      const received = [];
      const reader = response.body.getReader();
      let pending = '';
      const done = (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += new TextDecoder().decode(value);
            while (pending.includes('\n\n')) {
              const index = pending.indexOf('\n\n');
              const block = pending.slice(0, index);
              pending = pending.slice(index + 2);
              const type = block.match(/^event: (.*)$/m)?.[1];
              const data = block.match(/^data: (.*)$/m)?.[1];
              if (type && data) received.push({ type, data: JSON.parse(data) });
            }
          }
        } catch (error) {
          if (error.name !== 'AbortError') throw error;
        }
      })();
      return { received, close: async () => { controller.abort(); await done; } };
    }
  };
}

async function waitFor(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('No llegó el evento esperado');
}

test('propiedad de mensajes y privacidad de eventos', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bruma-security-'));
  fs.copyFileSync(path.join(__dirname, '..', 'server.js'), path.join(temp, 'server.js'));
  fs.mkdirSync(path.join(temp, 'public'));
  fs.writeFileSync(path.join(temp, 'public', 'index.html'), 'ok');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.join(temp, 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  let streams = [];
  t.after(async () => {
    await Promise.all(streams.map(stream => stream.close()));
    server.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await waitFor(async () => {
    try { return (await fetch(`${base}/api/auth/me`)).ok; } catch { return false; }
  });

  const alice = browser(base);
  const bob = browser(base);
  const carol = browser(base);
  const guest = browser(base);
  await Promise.all([alice.visit(), bob.visit(), carol.visit(), guest.visit()]);

  const sent = await alice.request('/api/messages', 'POST', { author: 'Alice', text: 'hola', senderId: 'publico' });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.canEdit, true);
  assert.equal(sent.data.senderId, undefined);
  assert.equal(sent.data.ownerGuestId, undefined);
  const seenByBob = await bob.request('/api/messages');
  assert.equal(seenByBob.data[0].canEdit, false);
  assert.equal(seenByBob.data[0].ownerGuestId, undefined);
  assert.equal((await bob.request(`/api/messages/${sent.data.id}`, 'PATCH', { text: 'hack', senderId: 'publico' })).status, 403);
  assert.equal((await bob.request(`/api/messages/${sent.data.id}?senderId=publico`, 'DELETE')).status, 403);
  assert.equal((await alice.request(`/api/messages/${sent.data.id}`, 'PATCH', { text: 'editado' })).status, 200);
  assert.equal((await alice.request(`/api/messages/${sent.data.id}`, 'DELETE')).status, 200);

  for (const [client, username] of [[alice, 'alice'], [bob, 'bob'], [carol, 'carol']]) {
    const result = await client.request('/api/auth/register', 'POST', { email: `${username}@example.com`, username, password: 'password123' });
    assert.equal(result.status, 201);
  }
  const accountMessage = await alice.request('/api/messages', 'POST', { author: 'fake', text: 'de cuenta' });
  assert.equal(accountMessage.status, 201);
  assert.equal((await bob.request(`/api/messages/${accountMessage.data.id}`, 'DELETE')).status, 403);
  assert.equal((await alice.request(`/api/messages/${accountMessage.data.id}`, 'PATCH', { text: 'propio' })).status, 200);

  assert.equal((await alice.request('/api/friends/requests', 'POST', { username: '@bob' })).status, 201);
  const requests = await bob.request('/api/friends');
  assert.equal((await bob.request(`/api/friends/requests/${requests.data.incoming[0].id}`, 'PATCH', { action: 'accept' })).status, 200);

  streams = await Promise.all([alice.events(), bob.events(), carol.events(), guest.events()]);
  const privateMessage = await alice.request('/api/private/messages', 'POST', { recipientUsername: '@bob', text: 'solo para Bob' });
  assert.equal(privateMessage.status, 201);
  await waitFor(() => streams[0].received.some(event => event.type === 'private') && streams[1].received.some(event => event.type === 'private'));
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(streams[0].received.find(event => event.type === 'private').data.friendUsername, '@bob');
  assert.equal(streams[1].received.find(event => event.type === 'private').data.friendUsername, '@alice');
  assert.equal(streams[2].received.some(event => event.type === 'private'), false);
  assert.equal(streams[3].received.some(event => event.type === 'private'), false);

  assert.equal((await alice.request('/api/auth/logout', 'POST')).status, 200);
  assert.equal((await alice.request(`/api/messages/${accountMessage.data.id}`, 'DELETE')).status, 403);
  const beforeLogout = streams[0].received.filter(event => event.type === 'private').length;
  assert.equal((await bob.request('/api/private/messages', 'POST', { recipientUsername: '@alice', text: 'después de salir' })).status, 201);
  await waitFor(() => streams[1].received.filter(event => event.type === 'private').length === 2);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(streams[0].received.filter(event => event.type === 'private').length, beforeLogout);
});
