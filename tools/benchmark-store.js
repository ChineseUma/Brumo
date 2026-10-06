'use strict';
// Synthetic data only. The optional source path allows before/after comparisons.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {performance} = require('node:perf_hooks');
const source = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const {MessageStore} = require(path.join(source, 'lib/message-store'));
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruma-store-bench-'));
  const store = new MessageStore(directory);
  try {
    await store.call('init', {group: [], privateRooms: {}});
    const avatarData = 'data:image/png;base64,' + crypto.randomBytes(4096).toString('base64');
    const delays = [];
    const io = () => Number(fs.readFileSync('/proc/self/io', 'utf8').match(/^wchar: (\d+)$/m)[1]);
    const before = io(), started = performance.now();
    for (let batch = 0; batch < 40; batch++) {
      await Promise.all(Array.from({length: 16}, async () => {
        const start = performance.now();
        await store.call('create', {owner: 'benchmark', message: {
          id: crypto.randomUUID(), clientId: crypto.randomUUID(), author: 'Fixture',
          text: 'Mensaje de prueba', createdAt: Date.now(), avatarData
        }});
        delays.push(performance.now() - start);
      }));
    }
    console.log(JSON.stringify({source, messages: delays.length, concurrency: 16,
      totalMs: Math.round(performance.now() - started),
      ackP50Ms: Number(percentile(delays, .5).toFixed(2)),
      ackP95Ms: Number(percentile(delays, .95).toFixed(2)),
      writtenBytes: io() - before}, null, 2));
  } finally {
    await store.close();
    fs.rmSync(directory, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
