const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

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

async function waitFor(check, timeout = 5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await check()) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('El túnel no alcanzó el estado esperado');
}

test('el controlador inicia, muestra el estado y detiene solo sus procesos', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bruma-control-'));
  fs.mkdirSync(path.join(temp, 'public'));
  fs.copyFileSync(path.join(__dirname, '..', 'bruma.js'), path.join(temp, 'bruma.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'server.js'), path.join(temp, 'server.js'));
  fs.cpSync(path.join(__dirname, '..', 'lib'), path.join(temp, 'lib'), {recursive: true});
  fs.writeFileSync(path.join(temp, 'public', 'index.html'), '<h1>Bruma prueba</h1>');
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), RAILWAY_URL: '', TUNNEL_TOKEN: '' };
  const run = command => spawnSync(process.execPath, [path.join(temp, 'bruma.js'), command], {
    cwd: temp, env, encoding: 'utf8', timeout: 10000
  });
  t.after(() => {
    run('detener');
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const started = run('iniciar');
  assert.equal(started.status, 0, started.stderr);
  assert.match(started.stdout, /Servidor iniciado/);
  assert.match((await (await fetch(`http://127.0.0.1:${port}/`)).text()), /Bruma prueba/);
  const state = run('estado');
  assert.equal(state.status, 0, state.stderr);
  assert.match(state.stdout, /Servidor: activo/);
  assert.match(state.stdout, /Túnel: detenido/);
  assert.match(run('iniciar').stdout, /Servidor ya activo/);

  const stopped = run('detener');
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.match(stopped.stdout, /Servidor detenido/);
  assert.match(run('estado').stdout, /Servidor: detenido/);

  const external = net.createServer();
  await new Promise(resolve => external.listen(port, '127.0.0.1', resolve));
  try {
    const blocked = run('iniciar');
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /ocupado por un proceso que no inició este controlador/);
    assert.equal(external.listening, true);
  } finally {
    await new Promise(resolve => external.close(resolve));
  }
});

test('el controlador conecta y detiene también el túnel', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bruma-control-tunnel-'));
  fs.mkdirSync(path.join(temp, 'public'));
  fs.mkdirSync(path.join(temp, 'railway'));
  for (const file of ['bruma.js', 'server.js']) {
    fs.copyFileSync(path.join(__dirname, '..', file), path.join(temp, file));
  }
  fs.cpSync(path.join(__dirname, '..', 'lib'), path.join(temp, 'lib'), {recursive: true});
  fs.copyFileSync(path.join(__dirname, '..', 'railway', 'wire.js'), path.join(temp, 'railway', 'wire.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'railway', 'sender.js'), path.join(temp, 'railway', 'sender.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'railway', 'client.js'), path.join(temp, 'railway', 'client.js'));
  fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(temp, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(temp, 'public', 'index.html'), '<h1>Bruma prueba</h1>');
  const localPort = await freePort();
  const relayPort = await freePort();
  const token = 'test-' + 'b'.repeat(60);
  const url = `http://127.0.0.1:${relayPort}`;
  fs.writeFileSync(path.join(temp, '.env.local'), `PORT=${localPort}\nRAILWAY_URL=${url}\nTUNNEL_TOKEN=${token}\n`, { mode: 0o600 });
  const env = { ...process.env, PORT: '', RAILWAY_URL: '', TUNNEL_TOKEN: '' };
  const run = command => spawnSync(process.execPath, [path.join(temp, 'bruma.js'), command], {
    cwd: temp, env, encoding: 'utf8', timeout: 10000
  });
  const relay = spawn(process.execPath, [path.join(__dirname, '..', 'railway', 'relay.js')], {
    env: { ...process.env, PORT: String(relayPort), TUNNEL_TOKEN: token }, stdio: 'ignore'
  });
  t.after(() => {
    run('detener');
    relay.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  await waitFor(async () => (await fetch(`${url}/health`)).ok);
  const started = run('iniciar');
  assert.equal(started.status, 0, started.stderr);
  assert.match(started.stdout, /Túnel iniciado/);
  await waitFor(async () => (await (await fetch(`${url}/health`)).json()).connected);
  assert.match(run('estado').stdout, /Túnel: activo .*conectado a Railway/);
  assert.equal(run('detener').status, 0);
  await waitFor(async () => !(await (await fetch(`${url}/health`)).json()).connected);
  assert.match(run('estado').stdout, /Túnel: detenido/);
});
