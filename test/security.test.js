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
    async events(delta = false) {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/events${delta ? '?v=2' : ''}`, {
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
  fs.cpSync(path.join(__dirname, '..', 'lib'), path.join(temp, 'lib'), {recursive: true});
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

  streams = await Promise.all([alice.events(true), bob.events(true), carol.events(true), guest.events(true)]);
  streams.push(await guest.events());
  await waitFor(() => streams.every(stream => stream.received.some(event => event.type === 'messages')));
  // Friend notifications are delivered only to the recipient, with public profile fields.
  assert.equal((await carol.request('/api/friends/requests','POST',{username:'@bob'})).status,201);
  await waitFor(() => streams[1].received.some(event => event.type === 'friend-request'));
  const friendNotice = streams[1].received.find(event => event.type === 'friend-request');
  assert.deepEqual(Object.keys(friendNotice.data.from).sort(),['avatarData','displayName','username']);
  assert.equal(friendNotice.data.from.username,'@carol');
  for (const index of [0,2,3,4]) assert.equal(streams[index].received.some(event => event.type === 'friend-request'),false);
  const newGroupMessage = await alice.request('/api/messages', 'POST', { author: 'fake', text: 'solo el cambio' });
  assert.equal(newGroupMessage.status, 201);
  await waitFor(() => streams.every(stream => stream.received.some(event => event.type === 'message-created' || event.type === 'messages' && event.data.some(item => item.id === newGroupMessage.data.id))));
  assert.equal(streams[0].received.find(event => event.type === 'message-created').data.canEdit, true);
  assert.equal(streams[1].received.find(event => event.type === 'message-created').data.canEdit, false);
  assert.equal(streams[0].received.find(event => event.type === 'message-created').data.text, 'solo el cambio');
  assert.equal(streams[4].received.at(-1).type, 'messages');
  assert.equal((await alice.request(`/api/messages/${newGroupMessage.data.id}`, 'PATCH', { text: 'corregido' })).status, 200);
  await waitFor(() => streams[0].received.some(event => event.type === 'message-updated'));
  assert.equal(streams[1].received.find(event => event.type === 'message-updated').data.text, 'corregido');
  assert.equal((await alice.request(`/api/messages/${newGroupMessage.data.id}`, 'DELETE')).status, 200);
  await waitFor(() => streams[0].received.some(event => event.type === 'message-deleted'));
  assert.deepEqual(streams[0].received.find(event => event.type === 'message-deleted').data, { id: newGroupMessage.data.id });

  const privateMessage = await alice.request('/api/private/messages', 'POST', { recipientUsername: '@bob', text: 'solo para Bob' });
  assert.equal(privateMessage.status, 201);
  await waitFor(() => streams[0].received.some(event => event.type === 'private-created') && streams[1].received.some(event => event.type === 'private-created'));
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(streams[0].received.find(event => event.type === 'private-created').data.friendUsername, '@bob');
  assert.equal(streams[1].received.find(event => event.type === 'private-created').data.friendUsername, '@alice');
  assert.equal(streams[0].received.find(event => event.type === 'private-created').data.isOwn,true);
  assert.equal(streams[1].received.find(event => event.type === 'private-created').data.isOwn,false);
  assert.equal(streams[2].received.some(event => event.type === 'private-created'), false);
  assert.equal(streams[3].received.some(event => event.type === 'private-created'), false);
  assert.equal(streams[4].received.some(event => event.type === 'private'), false);

  const privateMedia = await alice.request('/api/private/messages', 'POST', {
    recipientUsername: '@bob', text: '',
    images: ['data:image/png;base64,aGVsbG8='],
    audioData: 'data:audio/mp4;base64,aGVsbG8=',
    gifUrl: 'https://media.giphy.com/media/test/giphy.gif'
  });
  assert.equal(privateMedia.status, 201);
  assert.equal(privateMedia.data.images.length, 1);
  assert.match(privateMedia.data.audioData, /^data:audio\/mp4/);
  assert.match(privateMedia.data.gifUrl, /^https:\/\//);

  assert.equal((await alice.request('/api/auth/logout', 'POST')).status, 200);
  assert.equal((await alice.request(`/api/messages/${accountMessage.data.id}`, 'DELETE')).status, 403);
  const beforeLogout = streams[0].received.filter(event => event.type === 'private-created').length;
  assert.equal((await bob.request('/api/private/messages', 'POST', { recipientUsername: '@alice', text: 'después de salir' })).status, 201);
  await waitFor(() => streams[1].received.filter(event => event.type === 'private-created').length === 2);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(streams[0].received.filter(event => event.type === 'private-created').length, beforeLogout);
  const reconnected = await bob.events(true);
  streams.push(reconnected);
  await waitFor(() => reconnected.received.some(event => event.type === 'private' && event.data.messages.some(message => message.text === 'después de salir')));

});
