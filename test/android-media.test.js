const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const vm = require('node:vm');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruma-android-media-'));
  for (const file of ['server.js', 'lib']) fs.cpSync(path.join(__dirname, '..', file), path.join(dir, file), {recursive: true});
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, [path.join(dir, 'server.js')], {
    env: {...process.env, PORT: String(port), HOST: '127.0.0.1'}, stdio: 'ignore'
  });
  t.after(async () => {
    if (child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    fs.rmSync(dir, {recursive: true, force: true});
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + '/api/auth/me')).ok) return base; } catch {}
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('No inició el servidor de prueba');
}
function browser(base) {
  const cookies = new Map();
  return async (route, method = 'GET', body, headers = {}) => {
    const response = await fetch(base + route, {
      method, headers: {Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        'X-Bruma-Version': '3', ...(body && !Buffer.isBuffer(body) ? {'Content-Type': 'application/json'} : {}), ...headers},
      ...(body === undefined ? {} : {body: Buffer.isBuffer(body) ? body : JSON.stringify(body)})
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('='); cookies.set(key, value);
    }
    return response;
  };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=', 'base64');

test('GIF profile bytes survive updates, messages and public profiles without exposing account secrets', async t => {
  const base = await fixture(t), alice = browser(base), visitor = browser(base);
  await alice('/api/auth/register','POST',{email:'alice@example.com',username:'alice',password:'password123'});
  const original = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  const comments = Array.from({length:1200},()=>Buffer.concat([Buffer.from([255]),Buffer.alloc(255,65)]));
  const bytes = Buffer.concat([original.subarray(0,-1),Buffer.from([0x21,0xfe]),...comments,Buffer.from([0,0x3b]),Buffer.alloc(8)]);
  assert.ok(bytes.length > 280000);
  const gif = 'data:image/gif;base64,'+bytes.toString('base64');
  const saved = await alice('/api/auth/profile','PATCH',{displayName:'Alicia',username:'@alice',avatarData:gif});
  assert.equal(saved.status,200); assert.equal((await saved.json()).account.avatarData,gif);
  const profile = await visitor('/api/profiles/%40alice'); assert.equal(profile.status,200);
  const publicProfile = (await profile.json()).profile;
  assert.deepEqual(publicProfile,{username:'@alice',displayName:'Alicia',avatarData:gif});
  const sent = await alice('/api/messages','POST',{author:'Alicia',text:'GIF de perfil',clientId:crypto.randomUUID()});
  assert.equal(sent.status,201); const message = await sent.json();
  const image = await visitor(message.avatarData);
  assert.equal(image.headers.get('content-type'),'image/gif');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),Buffer.from(gif.split(',')[1],'base64'));
  assert.equal((await visitor('/api/auth/profile','PATCH',{displayName:'Hack',username:'@alice',avatarData:gif})).status,401);
  assert.equal((await visitor('/api/profiles/%40missing')).status,404);
  const invalid = ['data:image/gif;base64,aGVsbG8=', 'data:image/svg+xml;base64,aGVsbG8=', 'data:image/gif;base64,'+Buffer.alloc(4000001).toString('base64')];
  for (const avatarData of invalid) assert.equal((await alice('/api/auth/profile','PATCH',{displayName:'Alicia',username:'@alice',avatarData})).status,400);
  assert.deepEqual((await (await visitor('/api/profiles/%40alice')).json()).profile,publicProfile);
});

test('Android binary photos use tiny references and preserve idempotent confirmations', async t => {
  const base = await fixture(t), alice = browser(base), bob = browser(base);
  await alice('/api/auth/me'); await bob('/api/auth/me');
  // Trailing random bytes test transport bounds; this does not benchmark photo compression.
  const bytes = Buffer.concat([png, crypto.randomBytes(1024 * 1024)]);
  const upload = await alice('/api/uploads', 'POST', bytes, {'Content-Type': 'image/png', 'X-Bruma-File-Name': 'imagen%20uno.png'});
  assert.equal(upload.status, 201);
  const file = await upload.json(); assert.equal(file.size, bytes.length);
  assert.equal(file.name, 'imagen_uno.png');
  assert.equal((await bob('/api/messages', 'POST', {author: 'Bob', files: [{id: file.id}]})).status, 400);
  const body = {author: 'Alice', clientId: crypto.randomUUID(), files: [{id: file.id}]};
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < 200);
  const sent = await alice('/api/messages', 'POST', body); assert.equal(sent.status, 201);
  const message = await sent.json(); assert.equal(message.images, undefined);
  const retry = await alice('/api/messages', 'POST', body); assert.equal(retry.status, 200);
  assert.equal((await retry.json()).id, message.id);
  const history = await (await bob('/api/messages')).text();
  assert.ok(Buffer.byteLength(history) < 1024); assert.equal(JSON.parse(history).length, 1);
  const download = await bob(file.url);
  assert.match(download.headers.get('cache-control'), /^private, max-age=86400$/);
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.equal((await bob('/api/uploads/' + file.id)).headers.get('cache-control'), 'no-store');
});

test('private binary GIFs remain isolated while token downloads keep their exact bytes', async t => {
  const base = await fixture(t), alice = browser(base), bob = browser(base), outsider = browser(base);
  for (const [client, name] of [[alice, 'alice'], [bob, 'bob']]) {
    assert.equal((await client('/api/auth/register', 'POST', {email: `${name}@example.com`, username: name, password: 'password123'})).status, 201);
  }
  await outsider('/api/auth/me');
  await alice('/api/friends/requests', 'POST', {username: '@bob'});
  const request = (await (await bob('/api/friends')).json()).incoming[0];
  assert.equal((await bob(`/api/friends/requests/${request.id}`, 'PATCH', {action: 'accept'})).status, 200);
  const bytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const uploaded = await alice('/api/uploads', 'POST', bytes, {'Content-Type': 'image/gif', 'X-Bruma-Recipient': '@bob'});
  assert.equal(uploaded.status, 201); const file = await uploaded.json();
  const sent = await alice('/api/private/messages', 'POST', {recipientUsername: '@bob', files: [{id: file.id}], clientId: crypto.randomUUID()});
  assert.equal(sent.status, 201);
  assert.equal((await outsider('/api/uploads/' + file.id)).status, 404);
  assert.equal((await bob('/api/uploads/' + file.id)).status, 200);
  const history = await (await bob('/api/private/messages/@alice')).json();
  assert.equal(history[0].files[0].type, 'image/gif'); assert.equal(history[0].images, undefined);
  assert.deepEqual(Buffer.from(await (await bob(file.url)).arrayBuffer()), bytes);
  assert.deepEqual(await (await outsider('/api/messages')).json(), []);
});

test('web shows Android image references and keeps active content as a download', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const names = ['renderFiles', 'formatBytes', 'renderMedia', 'escapeHtml'];
  const code = names.map(name => {
    const start = source.indexOf('function ' + name + '(');
    const end = source.indexOf('\nfunction ', start + 1);
    return source.slice(start, end < 0 ? source.length : end);
  }).join('\n');
  const context = {}; vm.createContext(context); vm.runInContext(code, context);
  const image = context.renderFiles({files: [{id: 'fixture', token: 'private', type: 'image/webp', name: 'imagen.webp'}]});
  assert.match(image, /<img /); assert.match(image, /\/api\/uploads\/fixture\?token=private/);
  assert.match(image, /loading="lazy"/);
  const html = context.renderFiles({files: [{id: 'fixture', type: 'text/html', name: '<script>.html', size: 20}]});
  assert.doesNotMatch(html, /<img |<script>/); assert.match(html, /&lt;script&gt;/);
});
