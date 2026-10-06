// Run with NODE_PATH=/path/to/jsdom/node_modules node tools/check-web-ui.js.
const {JSDOM} = require('jsdom');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pause = () => new Promise(resolve => setImmediate(resolve));
(async()=>{
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8'),{url:'https://bruma.test',runScripts:'outside-only'});
  const w=dom.window; const posts=[]; const eventSources=[];
  w.matchMedia=()=>({matches:false,addEventListener(){}});
  w.ResizeObserver=class{observe(){}};
  w.CSS ||= {}; w.CSS.escape=value=>value.replace(/[^a-zA-Z0-9-]/g,'');
  w.AbortSignal=AbortSignal;
  w.EventSource=class{
    constructor(){this.handlers={};eventSources.push(this);}
    addEventListener(type,handler){this.handlers[type]=handler;}
    close(){}
    emit(type,data){this.handlers[type]?.({data:JSON.stringify(data)});}
  };
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  w.fetch=(url,options={})=>{
    if(url==='/api/auth/me')return Promise.resolve(json({account:null}));
    if(url==='/api/config')return Promise.resolve(json({maxImages:10}));
    if(url==='/api/friends')return Promise.resolve(json({},401));
    if(options.method==='POST'&&url==='/api/messages')return new Promise(resolve=>posts.push({resolve,body:JSON.parse(options.body),headers:options.headers}));
    if(url==='/api/messages')return Promise.resolve(json([]));
    throw Error('Unexpected request '+url);
  };
  try {
    w.eval(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'));
    for(let i=0;i<5;i++)await pause();
    assert.equal(eventSources.length,1);
    const events=eventSources[0];events.emit('messages',[]);
    const input=w.document.querySelector('#text'),form=w.document.querySelector('#message-form');
    input.value='mensaje inmediato';form.dispatchEvent(new w.Event('submit',{cancelable:true}));
    assert.equal(input.value,'');
    assert.match(w.document.querySelector('#messages').textContent,/Enviando/);
    assert.equal(posts.length,1);
    assert.equal(posts[0].headers['X-Bruma-Version'],'3');
    const sent={...posts[0].body,id:'confirmed-1',author:'Fixture',createdAt:Date.now(),canEdit:true};
    events.emit('message-created',sent);
    posts[0].resolve(json(sent,201));for(let i=0;i<4;i++)await pause();
    assert.equal(w.document.querySelectorAll('.message').length,1);
    assert.doesNotMatch(w.document.querySelector('#messages').textContent,/Enviando/);
    // Failure stays visible; retry reuses the same client ID.
    input.value='reintento';form.dispatchEvent(new w.Event('submit',{cancelable:true}));
    posts[1].resolve(json({error:'Prueba rechazada'},400));for(let i=0;i<4;i++)await pause();
    const retry=w.document.querySelector('[data-retry-id]');assert.ok(retry);
    retry.click();assert.equal(posts.length,3);
    assert.equal(posts[1].body.clientId,posts[2].body.clientId);
    const retried={...posts[2].body,id:'confirmed-2',author:'Fixture',createdAt:Date.now()};
    posts[2].resolve(json(retried,200));for(let i=0;i<4;i++)await pause();
    assert.equal(w.document.querySelectorAll('.message').length,2);
    assert.doesNotMatch(w.document.querySelector('#messages').textContent,/Enviando|Reintentar/);
    // Updating one row must retain the other node and its media/playback state.
    const unchanged=w.document.querySelector('[data-message-id="confirmed-2"]');
    events.emit('message-updated',{...sent,text:'editado'});
    assert.equal(w.document.querySelector('[data-message-id="confirmed-2"]'),unchanged);
    events.emit('message-deleted',{id:'confirmed-1'});
    assert.equal(w.document.querySelectorAll('.message').length,1);
    // A reconnect confirms a pending POST even if its HTTP response later fails.
    input.value='confirmado al reconectar';form.dispatchEvent(new w.Event('submit',{cancelable:true}));
    const recovered={...posts[3].body,id:'recovered',author:'Fixture',createdAt:Date.now()};
    events.emit('messages',[retried,recovered]);
    posts[3].resolve(json({error:'Respuesta perdida'},400));for(let i=0;i<4;i++)await pause();
    assert.doesNotMatch(w.document.querySelector('#messages').textContent,/No enviado|Reintentar/);
    // Long histories keep only a page in the DOM, including lazy avatars.
    const history=Array.from({length:1000},(_,index)=>({id:'history-'+index,author:'Fixture',text:'historial '+index,
      createdAt:Date.now(),avatarData:'/api/media/'+'a'.repeat(64)}));
    events.emit('messages',history);
    assert.equal(w.document.querySelectorAll('.message').length,40);
    assert.equal(w.document.querySelectorAll('.profile-avatar[loading="lazy"]').length,40);
    w.document.querySelector('[data-history-more]').click();
    assert.equal(w.document.querySelectorAll('.message').length,80);
    const anchor=w.document.querySelector('[data-message-id="history-999"]');
    events.emit('message-created',{id:'history-1000',author:'Fixture',text:'nuevo',createdAt:Date.now()});
    assert.equal(w.document.querySelectorAll('.message').length,80);
    assert.equal(w.document.querySelector('[data-message-id="history-999"]'),anchor);
    console.log('OK: envío inmediato, confirmación SSE/HTTP sin duplicados, reintento estable y actualización de una sola fila.');
  }finally{w.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
