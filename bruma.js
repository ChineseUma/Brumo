#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const STATE_DIR = path.join(ROOT, 'storage', '.bruma-control');
const CONFIG_FILE = path.join(ROOT, '.env.local');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function config() {
  const file = {};
  if (fs.existsSync(CONFIG_FILE)) {
    for (const line of fs.readFileSync(CONFIG_FILE, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      file[match[1]] = value;
    }
  }
  const value = key => process.env[key] || file[key] || '';
  const port = Number(value('PORT') || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un número entre 1 y 65535.');
  const railwayUrl = value('RAILWAY_URL');
  const token = value('TUNNEL_TOKEN');
  if (railwayUrl || token) {
    let url;
    try { url = new URL(railwayUrl); } catch { throw new Error('RAILWAY_URL debe ser una dirección completa, por ejemplo https://brumo-production.up.railway.app'); }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
      throw new Error('RAILWAY_URL debe usar HTTPS (HTTP solo para localhost).');
    }
    if (token.length < 32) throw new Error('TUNNEL_TOKEN debe tener al menos 32 caracteres.');
  }
  return { port, railwayUrl, token, giphyKey: value('GIPHY_API_KEY'), imageLimit: value('MAX_IMAGES_PER_MESSAGE') };
}

function stateFile(name) { return path.join(STATE_DIR, `${name}.json`); }

function readState(name) {
  try { return JSON.parse(fs.readFileSync(stateFile(name), 'utf8')); } catch { return null; }
}

function processInfo(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    if (fields[0] === 'Z') return null;
    return {
      startTime: fields[19],
      args: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean),
      cwd: fs.readlinkSync(`/proc/${pid}/cwd`)
    };
  } catch { return null; }
}

function ownedProcess(name) {
  const state = readState(name);
  if (!state || !Number.isInteger(state.pid)) return null;
  const info = processInfo(state.pid);
  const expected = path.join(ROOT, name === 'server' ? 'server.js' : 'railway/client.js');
  if (!info || info.startTime !== state.startTime || info.cwd !== ROOT || !info.args.includes(expected)) return null;
  return state;
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function waitFor(check, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return true;
    await pause(100);
  }
  return false;
}

function launch(name, script, env, extra = {}) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const log = path.join(STATE_DIR, `${name}.log`);
  const fd = fs.openSync(log, 'a', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [path.join(ROOT, script)], {
      cwd: ROOT, env, detached: true, stdio: ['ignore', fd, fd]
    });
  } finally { fs.closeSync(fd); }
  child.unref();
  const info = processInfo(child.pid);
  if (!info) throw new Error(`No se pudo iniciar ${name}; revisa ${log}.`);
  fs.writeFileSync(stateFile(name), JSON.stringify({ pid: child.pid, startTime: info.startTime, ...extra }), { mode: 0o600 });
  return child.pid;
}

async function start(settings) {
  const server = ownedProcess('server');
  if (server && server.port !== settings.port) throw new Error(`El servidor ya usa el puerto ${server.port}. Ejecuta detener antes de cambiar PORT.`);
  if (!server) {
    if (await portOpen(settings.port)) throw new Error(`El puerto ${settings.port} ya está ocupado por un proceso que no inició este controlador. Ciérralo primero; no lo detendré automáticamente.`);
    const env = { ...process.env, HOST: '127.0.0.1', PORT: String(settings.port) };
    delete env.TUNNEL_TOKEN;
    if (settings.giphyKey) env.GIPHY_API_KEY = settings.giphyKey;
    if (settings.imageLimit) env.MAX_IMAGES_PER_MESSAGE = settings.imageLimit;
    const pid = launch('server', 'server.js', env, { port: settings.port });
    const ready = await waitFor(async () => ownedProcess('server') && await portOpen(settings.port));
    if (!ready) {
      fs.rmSync(stateFile('server'), { force: true });
      throw new Error(`El servidor no arrancó. Revisa storage/.bruma-control/server.log (PID ${pid}).`);
    }
    console.log(`Servidor iniciado en http://127.0.0.1:${settings.port} (PID ${pid}).`);
  } else console.log(`Servidor ya activo (PID ${server.pid}).`);

  if (!settings.railwayUrl) {
    console.log('Túnel sin configurar: Bruma solo está disponible en esta laptop.');
    return;
  }
  const tunnel = ownedProcess('tunnel');
  if (tunnel) {
    console.log(`Túnel ya activo (PID ${tunnel.pid}).`);
    return;
  }
  const env = { ...process.env, RAILWAY_URL: settings.railwayUrl, TUNNEL_TOKEN: settings.token, LOCAL_PORT: String(settings.port) };
  const pid = launch('tunnel', 'railway/client.js', env);
  await pause(300);
  if (!ownedProcess('tunnel')) {
    fs.rmSync(stateFile('tunnel'), { force: true });
    throw new Error('El túnel no arrancó. Revisa storage/.bruma-control/tunnel.log.');
  }
  console.log(`Túnel iniciado (PID ${pid}); puede tardar unos segundos en conectarse.`);
}

async function stopOne(name) {
  const state = ownedProcess(name);
  if (!state) {
    console.log(`${name === 'server' ? 'Servidor' : 'Túnel'}: no iniciado por este controlador.`);
    fs.rmSync(stateFile(name), { force: true });
    return;
  }
  process.kill(state.pid, 'SIGTERM');
  if (!await waitFor(() => !ownedProcess(name), 5000) && ownedProcess(name)) {
    process.kill(state.pid, 'SIGKILL');
    await waitFor(() => !ownedProcess(name), 2000);
  }
  if (ownedProcess(name)) throw new Error(`No se pudo detener ${name} (PID ${state.pid}).`);
  fs.rmSync(stateFile(name), { force: true });
  console.log(`${name === 'server' ? 'Servidor' : 'Túnel'} detenido.`);
}

async function status(settings) {
  const server = ownedProcess('server');
  if (server) {
    console.log(`Servidor: activo (PID ${server.pid}, puerto ${server.port}${await portOpen(server.port) ? ', responde' : ', aún no responde'}).`);
  } else if (await portOpen(settings.port)) {
    console.log(`Servidor: el puerto ${settings.port} está ocupado por un proceso externo al controlador.`);
  } else console.log('Servidor: detenido.');

  const tunnel = ownedProcess('tunnel');
  if (!tunnel) return console.log('Túnel: detenido.');
  let connection = 'conexión sin verificar';
  if (settings.railwayUrl) {
    try {
      const response = await fetch(new URL('/health', settings.railwayUrl), { signal: AbortSignal.timeout(3000) });
      const health = await response.json();
      connection = response.ok && health.connected === true ? 'conectado a Railway' : 'sin conexión con Railway';
    } catch { connection = 'no se pudo consultar Railway'; }
  }
  console.log(`Túnel: activo (PID ${tunnel.pid}, ${connection}).`);
}

async function main() {
  const command = process.argv[2];
  if (!['iniciar', 'start', 'detener', 'stop', 'estado', 'status'].includes(command)) {
    console.log('Uso: npm run bruma -- iniciar | detener | estado');
    process.exitCode = 1;
    return;
  }
  if (command === 'detener' || command === 'stop') {
    await stopOne('tunnel');
    await stopOne('server');
    return;
  }
  const settings = config();
  if (command === 'iniciar' || command === 'start') await start(settings);
  else await status(settings);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
