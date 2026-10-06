const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {encode,decode}=require('../railway/wire');
test('tramas binarias preservan los bytes y evitan base64; protocolo anterior sigue disponible',()=>{
  const bytes=crypto.randomBytes(1024*1024);
  const metadata={type:'request',id:'fixture',path:'/api/messages'};
  const encoded=encode(metadata,bytes);
  const result=decode(encoded,true);
  assert.deepEqual(result.bytes,bytes);assert.equal(result.path,metadata.path);
  assert.equal(encoded.length,bytes.length+4+Buffer.byteLength(JSON.stringify(metadata)));
  const legacy=JSON.stringify({...metadata,body:bytes.toString('base64')});
  assert.ok(encoded.length<Buffer.byteLength(legacy)*.751);
  assert.equal(decode(Buffer.from(legacy),false).body,bytes.toString('base64'));
  assert.throws(()=>decode(Buffer.alloc(2),true));
  assert.throws(()=>decode(Buffer.from([255,255,255,255]),true));
});
