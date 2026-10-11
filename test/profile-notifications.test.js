const test = require('node:test');
const assert = require('node:assert/strict');
const {validAvatar,MAX_AVATAR_BYTES} = require('../lib/avatar');
const {BrumaNotices} = require('../public/notifications');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('notifications ignore own messages, active-room messages and duplicate delivery', () => {
  const center = new BrumaNotices();
  assert.equal(center.receive({id:'own'},'@bob',true,false),false);
  assert.equal(center.receive({id:'visible'},'',false,true),false);
  assert.equal(center.receive({id:'visible'},'',false,false),false);
  assert.equal(center.receive({id:'one'},'@bob',false,false),true);
  assert.equal(center.receive({id:'one'},'@bob',false,false),false);
  assert.equal(center.receive({id:'two'},'',false,false),true);
  assert.equal(center.count(),2); center.read('@bob'); assert.equal(center.count(),1);
  center.reset(); assert.equal(center.count(),0);
  for (let i=0;i<1200;i++) center.receive({id:String(i)},'',false,false);
  assert.equal(center.seen.size,1000);
});

test('GIF profile validation rejects mismatched headers and excessive dimensions', () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  const url = bytes => 'data:image/gif;base64,'+bytes.toString('base64');
  assert.equal(validAvatar(url(gif)),true);
  const huge = Buffer.from(gif); huge.writeUInt16LE(65535,6); assert.equal(validAvatar(url(huge)),false);
  const empty = Buffer.from(gif); empty.writeUInt16LE(0,8); assert.equal(validAvatar(url(empty)),false);
  assert.equal(validAvatar(url(gif.subarray(0,-1))),false);
  assert.equal(validAvatar(''),true);
});

test('GIF profiles above the old 280 KB cap preserve frames and allow encoder padding', () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  const blocks = [gif.subarray(0,-1),Buffer.from([0x21,0xfe])];
  for (let i=0;i<1200;i++) blocks.push(Buffer.from([255]),Buffer.alloc(255,0x41));
  blocks.push(Buffer.from([0]),gif.subarray(27),Buffer.alloc(8));
  const large = Buffer.concat(blocks);
  assert.ok(large.length > 280000);
  assert.equal(validAvatar('data:image/gif;base64,'+large.toString('base64')),true);
  assert.equal(validAvatar('data:image/gif;base64,'+Buffer.concat([gif,Buffer.alloc(MAX_AVATAR_BYTES)]).toString('base64')),false);
  assert.equal(validAvatar('data:image/gif;base64,'+Buffer.from('GIF89a fake;').toString('base64')),false);
});

test('web profile importer recognizes GIF bytes despite a generic MIME and preserves frames', async () => {
  const app = fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  const start = app.indexOf('async function prepareAvatar(file) {');
  const source = app.slice(start,app.indexOf('\n}',start)+2);
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  const file = new Blob([gif],{type:'application/octet-stream'});
  const sandbox = {Uint8Array,readFileAsDataUrl: async ()=>'data:application/octet-stream;base64,'+gif.toString('base64')};
  vm.createContext(sandbox); vm.runInContext(source,sandbox);
  assert.equal(await sandbox.prepareAvatar(file),'data:image/gif;base64,'+gif.toString('base64'));
  await assert.rejects(sandbox.prepareAvatar(new Blob([gif,Buffer.alloc(4000000)])),/4 MB/);
});
