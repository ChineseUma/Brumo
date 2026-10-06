'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');
class MessageStore {
  constructor(directory) {
    this.pending = new Map(); this.sequence = 0; this.failure = null;
    this.creates = []; this.flushTask = null;
    this.worker = new Worker(path.join(__dirname, 'message-worker.js'), {workerData: {directory}});
    this.worker.on('message', ({id, result, error}) => {
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      if (error) request.reject(new Error(error)); else request.resolve(result);
    });
    const fail = error => {
      this.failure = error;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      this.creates = [];
      clearImmediate(this.flushTask); this.flushTask = null;
    };
    this.worker.on('error', fail);
    this.worker.on('exit', () => fail(new Error('El almacenamiento se detuvo.')));
  }
  call(method, data) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= 256) return Promise.reject(new Error('Servidor ocupado; vuelve a intentar el envío.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, {resolve, reject});
      if (method === 'create') {
        this.creates.push({id, data});
        if (this.creates.length >= 32) this.flushCreates();
        else if (!this.flushTask) this.flushTask = setImmediate(() => this.flushCreates());
      } else {
        // Preserve ordering: a read, edit or shutdown must see preceding sends.
        this.flushCreates();
        this.post({id, method, data}, [id]);
      }
    });
  }
  post(message, ids) {
    try { this.worker.postMessage(message); }
    catch (error) {
      for (const id of ids) { this.pending.get(id)?.reject(error); this.pending.delete(id); }
    }
  }
  flushCreates() {
    clearImmediate(this.flushTask); this.flushTask = null;
    const batch = this.creates;
    this.creates = [];
    if (batch.length) this.post({method: 'createBatch', data: batch}, batch.map(request => request.id));
  }
  async close() { await this.call('close'); await this.worker.terminate(); }
}
module.exports = { MessageStore };
