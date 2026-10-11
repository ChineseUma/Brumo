const test = require('node:test');
const assert = require('node:assert/strict');
const {validAvatar} = require('../lib/avatar');
const {BrumaNotices} = require('../public/notifications');

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
