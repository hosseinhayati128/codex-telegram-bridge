import test from 'node:test';import assert from 'node:assert/strict';import {Duplex} from 'node:stream';import {randomBytes} from 'node:crypto';import {serverHandshake,clientHandshake} from '../ipc.mjs';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {startBroker} from '../broker.mjs';
function pair(){let a,b;a=new Duplex({read(){},write(c,e,cb){queueMicrotask(()=>b.push(c));cb();}});b=new Duplex({read(){},write(c,e,cb){queueMicrotask(()=>a.push(c));cb();}});return[a,b];}
test('mutual fresh challenge handshake carries lossless IDs',async()=>{const [a,b]=pair(),key=randomBytes(32);const [s,c]=await Promise.all([serverHandshake(a,key),clientHandshake(b,key)]);const received=new Promise(r=>s.once('message',r));c.send({id:9007199254740993n});assert.equal((await received).id,9007199254740993n);a.destroy();b.destroy();});
test('wrong key never authenticates',async()=>{const [a,b]=pair();const results=await Promise.allSettled([serverHandshake(a,randomBytes(32),100),clientHandshake(b,randomBytes(32),100)]);assert.ok(results.every(r=>r.status==='rejected'));a.destroy();b.destroy();});

const csc=path.join(process.env.SystemRoot??'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
test('Windows broker survives a rejected client and serves the next authenticated client',{skip:process.platform!=='win32'||!fs.existsSync(csc),timeout:10000},async t=>{
 const privateRoot=path.resolve(import.meta.dirname,'../private');
 fs.mkdirSync(privateRoot,{recursive:true});
 const tmp=fs.mkdtempSync(path.join(privateRoot,'test-broker-'));
 const exe=path.join(tmp,'PipeBroker.exe');
 const build=spawnSync(csc,['/nologo','/optimize+','/out:'+exe,path.resolve(import.meta.dirname,'../PipeBroker.cs')],{windowsHide:true,encoding:'utf8'});
 assert.equal(build.status,0,build.stderr||build.stdout);
 const key=randomBytes(32),name='CodexTelegramBridge-test-'+randomBytes(12).toString('hex'),endpoint='\\\\.\\pipe\\'+name;
 const broker=startBroker(exe,name,async socket=>{
  try{
   const channel=await serverHandshake(socket,key,1500);
   channel.on('message',message=>channel.send(message));
  }catch{}
 });
 t.after(async()=>{
  if(broker.exitCode===null&&broker.signalCode===null){const closed=once(broker,'close');broker.stdin.end();await closed;}
  fs.rmSync(tmp,{recursive:true,force:true});
 });
 async function connect(){
  for(let attempt=0;attempt<60;attempt++){
   assert.equal(broker.exitCode,null,'Broker exited while a client disconnected');
   const socket=net.connect(endpoint);
   socket.on('error',()=>{});
   try{await once(socket,'connect',{signal:AbortSignal.timeout(250)});return socket;}
   catch{socket.destroy();await sleep(25);}
  }
  throw new Error('Broker pipe unavailable');
 }
 await assert.rejects(clientHandshake(await connect(),randomBytes(32),1500),/authentication failed/);
 await sleep(500);
 const client=await clientHandshake(await connect(),key,1500);
 try{
  const reply=once(client,'message',{signal:AbortSignal.timeout(1500)});
  client.send({verified:true});
  assert.deepEqual(await reply,[{verified:true}]);
 }finally{client.close();}
});
