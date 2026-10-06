// Local synthetic benchmark; never opens the project's real storage or Railway.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {once} = require('node:events');
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
async function port() {
  const socket = net.createServer(); socket.listen(0,'127.0.0.1'); await once(socket,'listening');
  const result = socket.address().port; await new Promise(resolve => socket.close(resolve)); return result;
}
function io(pid) {
  try { return Number(fs.readFileSync(`/proc/${pid}/io`,'utf8').match(/^wchar: (\d+)$/m)[1]); } catch { return null; }
}
function peakRss(pid) { try { return Number(fs.readFileSync(`/proc/${pid}/status`,'utf8').match(/^VmHWM:\s+(\d+)/m)[1]); } catch { return null; } }
function percentile(values,p) { const sorted = [...values].sort((a,b)=>a-b); return Number(sorted[Math.floor((sorted.length-1)*p)].toFixed(2)); }
(async () => {
  const source = path.resolve(process.argv[2] || path.join(__dirname,'..'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'bruma-bench-'));
  const children=[]; let abort;
  try {
    for (const name of ['server.js','lib','railway']) if (fs.existsSync(path.join(source,name))) fs.cpSync(path.join(source,name),path.join(root,name),{recursive:true});
    fs.symlinkSync(path.join(source,'node_modules'),path.join(root,'node_modules'),'dir');
    fs.mkdirSync(path.join(root,'public')); fs.writeFileSync(path.join(root,'public/index.html'),'fixture');
    fs.mkdirSync(path.join(root,'storage'));
    const avatar='data:image/png;base64,'+crypto.randomBytes(4096).toString('base64');
    const image='data:image/png;base64,'+crypto.randomBytes(128000).toString('base64');
    const history=Array.from({length:1000},(_,i)=>({id:crypto.randomUUID(),author:'Fixture',text:`historial ${i}`,createdAt:Date.now(),avatarData:avatar,...(i%25===0?{images:[image]}:{})}));
    fs.writeFileSync(path.join(root,'storage/messages.json'),JSON.stringify(history));
    const localPort=await port(), relayPort=await port();
    const launch=(script,env)=>{
      const child=spawn(process.execPath,[path.join(root,script)],{env:{...process.env,...env,GIPHY_API_KEY:''},stdio:['ignore','ignore','pipe']});
      let errors=''; child.stderr.on('data',chunk=>{errors+=chunk;}); child.on('exit',code=>{if(code) console.error(errors.slice(-500));}); children.push(child); return child;
    };
    const server=launch('server.js',{HOST:'127.0.0.1',PORT:String(localPort)});
    const local=`http://127.0.0.1:${localPort}`;
    for(let i=0;;i++){try{if((await fetch(local)).ok)break;}catch{}if(i===300)throw Error('Servidor no inició');await pause(30);}
    const tunnel=process.argv.includes('--tunnel');
    let base=local;
    if(tunnel){
      const token='fixture-'+crypto.randomBytes(32).toString('hex');
      base=`http://127.0.0.1:${relayPort}`;
      launch('railway/relay.js',{PORT:String(relayPort),TUNNEL_TOKEN:token});
      launch('railway/client.js',{LOCAL_PORT:String(localPort),TUNNEL_TOKEN:token,RAILWAY_URL:base});
      for(let i=0;;i++){try{if((await(await fetch(base+'/health')).json()).connected)break;}catch{}if(i===300)throw Error('Túnel no inició');await pause(30);}
    }
    const compact=fs.existsSync(path.join(source,'lib/message-worker.js'));
    const cookie=(await fetch(base)).headers.get('set-cookie').split(';')[0];
    const headers={Cookie:cookie,'Content-Type':'application/json',...(compact?{'X-Bruma-Version':'3'}:{})};
    const initial=await(await fetch(base+'/api/messages',{headers})).text();
    abort=new AbortController();
    const stream=await fetch(base+`/api/events?v=${compact?3:2}`,{headers,signal:abort.signal});
    const reader=stream.body.getReader(); let buffer='',ready=false,eventBytes=0;
    const started=new Map(),received=[];
    const reading=(async()=>{try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=Buffer.from(value).toString();let index;while((index=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,index);buffer=buffer.slice(index+2);if(block.startsWith('event: messages\n'))ready=true;if(block.startsWith('event: message-created\n')){const item=JSON.parse(block.slice(block.indexOf('data: ')+6));if(started.has(item.text)){received.push(performance.now()-started.get(item.text));eventBytes+=Buffer.byteLength(block)+2;}}}}}catch(error){if(error.name!=='AbortError')throw error;}})();
    while(!ready)await pause(5);
    const before=io(server.pid), latencies=[],responses=[];
    const beginning=performance.now();
    for(let batch=0;batch<20;batch++)await Promise.all(Array.from({length:4},async(_,n)=>{
      const text=`bench-${batch*4+n}`; const start=performance.now();started.set(text,start);
      const response=await fetch(base+'/api/messages',{method:'POST',headers,body:JSON.stringify({author:'Bench',text,clientId:crypto.randomUUID(),avatarData:avatar})});
      const body=await response.text();if(!response.ok)throw Error(body);latencies.push(performance.now()-start);responses.push(Buffer.byteLength(body));
    }));
    for(let i=0;received.length<80&&i<400;i++)await pause(5);
    const after=io(server.pid);
    console.log(JSON.stringify({source,via:tunnel?'local relay':'direct',messages:80,received:received.length,totalMs:Math.round(performance.now()-beginning),ackP50Ms:percentile(latencies,.5),ackP95Ms:percentile(latencies,.95),deliveryP95Ms:percentile(received,.95),initialJsonBytes:Buffer.byteLength(initial),averageResponseBytes:Math.round(responses.reduce((a,b)=>a+b,0)/80),eventBytes,serverPeakRssKiB:peakRss(server.pid),writtenBytes:before===null||after===null?null:after-before},null,2));
    abort.abort();await reading;
  }finally{
    abort?.abort();
    await Promise.all(children.map(async child=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}));
    fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
