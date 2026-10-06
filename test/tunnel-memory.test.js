'use strict';
// Execute both real tunnel programs with in-memory sockets/HTTP streams. The live
// TCP integration remains in railway-tunnel.test.js; these checks need no ports.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter, once} = require('node:events');
const {Readable, Writable} = require('node:stream');
const {createRequire} = require('node:module');
const {decode} = require('../railway/wire');

function fixture({legacy = false} = {}) {
  let handlePublic, bridge, relaySocket, localSocket;
  const localCalls = [], frames = [];
  class Socket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    send(payload, done) {
      if (this.readyState !== 1) return done?.(new Error('Socket cerrado'));
      const message = decode(payload, Buffer.isBuffer(payload));
      frames.push(message);
      setImmediate(() => {
        if (this.peer.readyState === 1 && !(legacy && message.type === 'hello')) this.peer.emit('message', Buffer.from(payload), Buffer.isBuffer(payload));
        done?.();
      });
    }
    terminate() {
      if (this.readyState !== 1) return;
      this.readyState = 3; this.emit('close');
      this.peer.terminate();
    }
    close() { this.terminate(); }
    ping() { this.emit('pong'); }
  }
  class ClientSocket extends Socket {
    static OPEN = 1;
    constructor() {
      super();
      localSocket = this;
      relaySocket = new Socket(); this.peer = relaySocket; relaySocket.peer = this;
      setImmediate(() => { this.emit('open'); bridge.emit('connection', relaySocket); });
    }
  }
  class ServerSocket extends EventEmitter {
    constructor() { super(); bridge = this; }
  }
  class PublicResponse extends Writable {
    headersSent = false;
    statusCode = 0;
    chunks = [];
    _write(chunk, encoding, done) { this.chunks.push(Buffer.from(chunk)); setImmediate(done); }
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; this.headersSent = true; }
    flushHeaders() { this.flushed = true; }
  }
  const localHttp = {
    request(options, respond) {
      const chunks = [];
      const request = new Writable({
        write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); setImmediate(done); },
        final(done) {
          const body = Buffer.concat(chunks);
          localCalls.push({options, body});
          const bytes = options.path === '/api/media/large' ? Buffer.alloc(5_000_000, 42) : body;
          const response = Readable.from([bytes]);
          response.statusCode = 200;
          response.headers = {'content-type': 'application/octet-stream', 'content-length': String(bytes.length)};
          respond(response); done();
        }
      });
      return request;
    }
  };
  function load(file, http) {
    const filename = path.join(__dirname, '../railway', file);
    const nativeRequire = createRequire(filename);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      require: name => name === 'node:http' ? http : name === 'ws' ? {WebSocket: ClientSocket, WebSocketServer: ServerSocket} : nativeRequire(name),
      Buffer, URL, console: {log() {}, error() {}},
      process: {env: {TUNNEL_TOKEN: 'a'.repeat(64), RAILWAY_URL: 'http://127.0.0.1:3001', LOCAL_PORT: '3000'}, on() {}, exit() {throw Error('Exit inesperado');}},
      setInterval() {}, setTimeout() {}
    }, {filename});
  }
  load('relay.js', {createServer(handler) { handlePublic = handler; const server = new EventEmitter(); server.listen = () => {}; return server; }});
  load('client.js', localHttp);
  return {
    frames, localCalls,
    async ready() {
      for (let index = 0; index < 100; index++) {
        if (legacy ? frames.some(frame => frame.type === 'hello') : relaySocket?.binary && localSocket?.binary) return;
        await new Promise(resolve => setImmediate(resolve));
      }
      throw Error('No se negoció el protocolo binario');
    },
    request(url, body = Buffer.alloc(0)) {
      const parts = [];
      for (let index = 0; index < body.length; index += 65536) parts.push(body.subarray(index, index + 65536));
      const req = Readable.from(parts);
      req.url = url; req.method = body.length ? 'POST' : 'GET';
      req.headers = {'content-length': String(body.length), 'content-type': 'application/octet-stream'};
      const res = new PublicResponse();
      const finished = once(res, 'finish').then(() => ({status: res.statusCode, body: Buffer.concat(res.chunks), flushed: res.flushed}));
      handlePublic(req, res);
      return finished;
    },
    close() { relaySocket?.terminate(); }
  };
}

test('puente completo en memoria: subida fragmentada, descarga grande y texto simultáneo', {timeout: 5000}, async t => {
  const tunnel = fixture(); t.after(() => tunnel.close()); await tunnel.ready();
  const upload = require('node:crypto').randomBytes(700000);
  const [large, echo, chat] = await Promise.all([
    tunnel.request('/api/media/large'), tunnel.request('/api/uploads', upload), tunnel.request('/api/messages', Buffer.from('hola 日本'))
  ]);
  assert.equal(large.status, 200); assert.equal(large.body.length, 5_000_000);
  assert.ok(large.body.equals(Buffer.alloc(5_000_000, 42)));
  assert.equal(echo.status, 200); assert.deepEqual(echo.body, upload);
  assert.equal(chat.status, 200); assert.equal(chat.body.toString(), 'hola 日本');
  assert.equal(chat.flushed, true);
  assert.equal(tunnel.localCalls.length, 3);
  const uploadCall = tunnel.localCalls.find(call => call.options.path === '/api/uploads');
  assert.deepEqual(uploadCall.body, upload);
  assert.equal(uploadCall.options.headers['content-length'], undefined);
  assert.ok(tunnel.frames.filter(frame => ['chunk', 'body'].includes(frame.type)).every(frame => frame.bytes.length <= 16384));
});

test('el puente mantiene subidas y descargas si el par no negocia protocolo binario', {timeout: 5000}, async t => {
  const tunnel = fixture({legacy: true}); t.after(() => tunnel.close()); await tunnel.ready();
  const body = require('node:crypto').randomBytes(100000);
  const response = await tunnel.request('/api/messages', body);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, body);
  assert.ok(tunnel.frames.filter(frame => frame.type === 'chunk').every(frame => !frame.bytes && typeof frame.data === 'string'));
});
