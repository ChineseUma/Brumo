'use strict';
const wire = require('./wire');

// Only body/chunk frames can be split without changing the HTTP protocol.
const FRAME_BYTES = 16 * 1024;
const MAX_QUEUED_BYTES = 64_000_000;
function priority(message) {
  const pathname = (message.path || '').split('?')[0];
  const length = Number(message.headers?.['content-length'] || 0);
  return !pathname.startsWith('/api/media/') && !pathname.startsWith('/api/uploads')
    && !message.streaming && length <= 8192 ? 1 : 0;
}

class TunnelSender {
  constructor(socket, legacyField) {
    this.socket = socket;
    this.legacyField = legacyField;
    this.streams = new Map();
    this.queuedBytes = 0;
    this.busy = false;
    this.closed = false;
    this.fastStreak = 0;
    socket.once('close', () => this.fail(new Error('Túnel desconectado.')));
  }
  send(message, bytes, done, importance = 1) {
    if (this.closed || this.socket.readyState !== 1) return false;
    const size = Buffer.byteLength(JSON.stringify(message)) + (bytes?.length || 0) + 4;
    if (this.queuedBytes + size > MAX_QUEUED_BYTES) {
      this.fail(new Error('Túnel saturado.'));
      this.socket.terminate();
      return false;
    }
    const key = message.id || '';
    const queue = this.streams.get(key) || [];
    queue.push({message, bytes, done, importance, size, offset: 0});
    this.streams.set(key, queue);
    this.queuedBytes += size;
    this.pump();
    return true;
  }
  pump() {
    if (this.busy || this.closed || !this.streams.size) return;
    const entries = [...this.streams];
    // Let text/events pass queued media; reserve a turn for media every 8 fast frames.
    const prefer = this.fastStreak < 8 ? 1 : 0;
    const [key, queue] = entries.find(([, items]) => items[0].importance === prefer) || entries[0];
    const item = queue[0];
    this.fastStreak = item.importance ? this.fastStreak + 1 : 0;
    const split = item.bytes && ['body', 'chunk'].includes(item.message.type);
    const bytes = split ? item.bytes.subarray(item.offset, item.offset + FRAME_BYTES) : item.bytes;
    const last = !split || item.offset + bytes.length >= item.bytes.length;
    const payload = bytes && this.socket.binary ? wire.encode(item.message, bytes)
      : JSON.stringify(bytes ? {...item.message, [this.legacyField]: bytes.toString('base64')} : item.message);
    this.busy = true;
    const complete = error => {
      if (this.closed) return;
      if (error) { this.fail(error); this.socket.terminate(); return; }
      this.busy = false;
      this.streams.delete(key);
      if (last) { queue.shift(); this.queuedBytes -= item.size; }
      else item.offset += bytes.length;
      // Rotate equal-priority streams without reordering frames within a request.
      if (queue.length) this.streams.set(key, queue);
      if (last) item.done?.();
      this.pump();
    };
    try { this.socket.send(payload, error => queueMicrotask(() => complete(error))); }
    catch (error) { complete(error); }
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    const queues = [...this.streams.values()];
    this.streams.clear(); this.queuedBytes = 0;
    for (const queue of queues) for (const item of queue) item.done?.(error);
  }
}

module.exports = {TunnelSender, priority, FRAME_BYTES};
