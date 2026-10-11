const test = require('node:test');
const assert = require('node:assert/strict');
const {validBanner} = require('../lib/profile');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64');
const data = bytes => 'data:image/png;base64,'+bytes.toString('base64');
test('static banners reject GIF, APNG, animated WebP and truncated data', () => {
  assert.equal(validBanner(data(png)),true); assert.equal(validBanner(''),true);
  assert.equal(validBanner(data(png.subarray(0,25))),false);
  const control = Buffer.alloc(20); control.writeUInt32BE(8,0); control.write('acTL',4);
  assert.equal(validBanner(data(Buffer.concat([png.subarray(0,33),control,png.subarray(33)]))),false);
  const webp = Buffer.alloc(30); webp.write('RIFF',0); webp.writeUInt32LE(22,4); webp.write('WEBPVP8X',8); webp.writeUInt32LE(10,16); webp[20] = 2;
  assert.equal(validBanner('data:image/webp;base64,'+webp.toString('base64')),false);
  assert.equal(validBanner('data:image/gif;base64,R0lGODlh'),false);
  assert.equal(validBanner(null),false);
});
