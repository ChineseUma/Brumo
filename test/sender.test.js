'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {TunnelSender, priority, FRAME_BYTES} = require('../railway/sender');
const {decode} = require('../railway/wire');

class SlowSocket extends EventEmitter {
  readyState = 1;
  binary = true;
  sent = [];
  send(payload, callback) {
    assert.equal(this.callback, undefined, 'solo una trama entra en el socket a la vez');
    this.sent.push(decode(payload, Buffer.isBuffer(payload)));
    this.callback = callback;
  }
  async drain(error) {
    const callback = this.callback;
    this.callback = undefined;
    callback?.(error);
    await new Promise(resolve => setImmediate(resolve));
  }
  terminate() { this.readyState = 3; this.emit('close'); }
}

test('texto adelanta a una transferencia grande sin corromper bytes ni adelantar end', async () => {
  const socket = new SlowSocket(), sender = new TunnelSender(socket, 'data');
  const bytes = Buffer.alloc(FRAME_BYTES * 5 + 7, 123);
  let completed = false;
  sender.send({type: 'chunk', id: 'download'}, bytes, () => { completed = true; }, 0);
  sender.send({type: 'end', id: 'download'}, undefined, undefined, 0);
  sender.send({type: 'chunk', id: 'chat'}, Buffer.from('hola 日本'), undefined, 1);
  assert.equal(completed, false);
  await socket.drain();
  assert.equal(socket.sent[1].id, 'chat');
  assert.equal(socket.sent[1].bytes.toString(), 'hola 日本');
  while (socket.callback) await socket.drain();
  const download = socket.sent.filter(frame => frame.id === 'download');
  assert.equal(download.at(-1).type, 'end');
  assert.deepEqual(Buffer.concat(download.filter(frame => frame.bytes).map(frame => frame.bytes)), bytes);
  assert.ok(download.every(frame => !frame.bytes || frame.bytes.length <= FRAME_BYTES));
  assert.equal(completed, true);
  assert.equal(sender.queuedBytes, 0);
});

test('eventos continuos dejan avanzar archivos y conservan el orden de cada petición', async () => {
  const socket = new SlowSocket(), sender = new TunnelSender(socket, 'body');
  sender.send({type: 'request', id: 'first', path: '/api/messages'}, Buffer.from('{}'));
  sender.send({type: 'body', id: 'upload'}, Buffer.alloc(2 * FRAME_BYTES), undefined, 0);
  for (let index = 0; index < 20; index++) sender.send({type: 'chunk', id: 'events'}, Buffer.from(String(index)));
  while (socket.callback) await socket.drain();
  assert.ok(socket.sent.findIndex(frame => frame.id === 'upload') <= 8);
  assert.deepEqual(socket.sent.filter(frame => frame.id === 'events').map(frame => Number(frame.bytes.toString())), Array.from({length: 20}, (_, index) => index));
});

test('cierre y errores liberan la cola y completan los callbacks una sola vez', async () => {
  const socket = new SlowSocket(), sender = new TunnelSender(socket, 'data');
  const errors = [];
  for (let index = 0; index < 4; index++) sender.send({type: 'chunk', id: String(index)}, Buffer.alloc(100), error => errors.push(error));
  await socket.drain(new Error('fallo simulado'));
  socket.terminate();
  assert.equal(errors.length, 4);
  assert.ok(errors.every(error => error.message === 'fallo simulado'));
  assert.equal(sender.queuedBytes, 0);
  assert.equal(sender.send({type: 'end'}), false);
});

test('un puente anterior recibe el mismo protocolo base64 y las peticiones no se fragmentan', async () => {
  const socket = new SlowSocket(); socket.binary = false;
  const sender = new TunnelSender(socket, 'body');
  const bytes = Buffer.alloc(FRAME_BYTES * 3, 12);
  sender.send({type: 'request', id: 'legacy'}, bytes);
  await socket.drain();
  assert.equal(socket.sent.length, 1);
  assert.deepEqual(Buffer.from(socket.sent[0].body, 'base64'), bytes);
  assert.equal(priority({path: '/api/messages', headers: {'content-length': '500'}}), 1);
  assert.equal(priority({path: '/api/events?v=3'}), 1);
  assert.equal(priority({path: '/api/media/image'}), 0);
  assert.equal(priority({path: '/api/uploads'}), 0);
  assert.equal(priority({path: '/api/messages', streaming: true}), 0);
});
