import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {Desktop} from '../desktop.mjs';
import {State} from '../state.mjs';
import {Attachments} from '../attachments.mjs';
import {pairOwner} from '../ubuntu/pair.mjs';
import {launchFiles} from '../ubuntu/launch-files.mjs';
import {brokerEndpoint,desktopEndpoint,readPairing,startBroker} from '../ubuntu/runtime.mjs';

function state() {
 const base=process.platform==='win32'?path.resolve(import.meta.dirname,'../private/test-ubuntu'):os.tmpdir();
 fs.mkdirSync(base,{recursive:true});
 return new State(path.join(fs.mkdtempSync(path.join(base,'codex-telegram-test-')),'state.json'));
}

test('Ubuntu cannot reuse a saved desktop endpoint without a live authenticated relay',async()=>{
 const s=state();
 const desktop=new Desktop({
  chats:[],stateRoot:path.dirname(s.file),requireLiveEndpoint:true,
  endpointValidator:socket=>socket==='/tmp/codex-app-tools-1000',
 },s,async()=>{});
 fs.mkdirSync(path.dirname(desktop.file),{recursive:true});
 fs.writeFileSync(desktop.file,JSON.stringify({pipePath:'/tmp/codex-app-tools-1000'}));
 await assert.rejects(()=>desktop.connect(),/Waiting for Codex/);
 await desktop.attach('/tmp/codex-app-tools-1000');
 assert.equal(desktop.pipe,'/tmp/codex-app-tools-1000');
 await desktop.detach('/tmp/codex-app-tools-1000');
 await assert.rejects(()=>desktop.connect(),/Waiting for Codex/);
});

test('Ubuntu drops a command if its authenticated desktop endpoint closes before dispatch',async()=>{
 const s=state(),id='10000000-0000-4000-8000-000000000001';
 const d=new Desktop({chats:[{id}],stateRoot:path.dirname(s.file),requireLiveEndpoint:true},s,async()=>{});
 let writes=0;
 d.read=async()=>({thread:{id}});
 d.connect=async()=>({call:async()=>writes++});
 await assert.rejects(()=>d.sendText(id,'test command'),/Codex endpoint changed/);
 assert.equal(writes,0);
});

test('pairing skips old, forwarded and public messages without consuming later owner commands',async()=>{
 const now=Date.now(),date=Math.floor(now/1000),code='fresh-local-code';
 const message={from:{id:11},chat:{id:11,type:'private'},text:'/pair '+code,date};
 const seen=[];
 const api={call:async(method,params)=>{
  assert.equal(method,'getUpdates');seen.push(params.offset);
  if(seen.length===1)return [
   {update_id:8,message:{...message,date:date-10}},
   {update_id:9,message:{...message,forward_origin:{type:'user'}}},
   {update_id:10,message:{...message,chat:{id:11,type:'group'}}},
  ];
  return [{update_id:11,message},{update_id:12,message:{...message,text:'/status'}}];
 }};
 assert.deepEqual(await pairOwner(api,'testbot',code,now),{owner:{userId:'11',chatId:'11',botUsername:'testbot'},offset:12});
 assert.deepEqual(seen,[0,11]);
});

test('Ubuntu launchers preserve literal paths containing spaces, quotes and systemd variables',()=>{
 const files=launchFiles({root:"/home/a's/bridge %",node:'/home/a/node $HOME',app:'/usr/bin/chatgpt',codexHome:"/home/a's/.codex"});
 assert.ok(files.cli.startsWith('#!/bin/sh\nexec '));
 assert.ok(files.desktop.includes("CODEX_HOME='/home/a'\\''s/.codex'"));
 assert.ok(files.unit.includes('ExecStart=:"/home/a/node $HOME" --use-env-proxy "/home/a\'s/bridge %%/daemon.mjs"'));
 assert.throws(()=>launchFiles({root:'/home/a\nInjected',node:'node',app:'chatgpt',codexHome:'/home/a'}),/control characters/);
});

test('Ubuntu preserves valid Persian file names and uses a short temporary component',async()=>{
 const s=state(),root=path.dirname(s.file),id='10000000-0000-4000-8000-000000000001';
 const files=new Attachments({state:s,config:{platform:'linux',stateRoot:root,transferRoot:path.join(root,'files')},chatId:'11',
  api:{download:async(_id,file)=>{assert.ok(Buffer.byteLength(path.basename(file))<=255);fs.writeFileSync(file,'data');return{bytes:4};}},
 });
 const valid='ا'.repeat(124)+'.txt';
 const send=(filename,updateId)=>files.receive({threadId:id,updateId,attachment:{fileId:'f',filename}});
 assert.equal(path.basename((await send(valid,1)).path),valid);
 const longer=await send('😀'.repeat(100)+'.txt',2);
 assert.ok(Buffer.byteLength(path.basename(longer.path))<=255);
 assert.equal(fs.readFileSync(longer.path,'utf8'),'data');
});

test('Ubuntu starts a real owner socket and rejects linked endpoints and exposed credentials',{skip:process.platform!=='linux'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctb-'));
 const dir=path.join(root,'private');
 fs.mkdirSync(dir,{mode:0o700});
 const config={stateRoot:root};
 const server=await startBroker(config,socket=>socket.end('ready'));
 try{
  const endpoint=brokerEndpoint(config);
  const linked=path.join(dir,'linked.sock');
  fs.symlinkSync(endpoint,linked);
  assert.equal(desktopEndpoint(endpoint),true);
  assert.equal(desktopEndpoint(linked),false);
  const reply=await new Promise((resolve,reject)=>{
   const socket=net.createConnection(endpoint);
   let text='';
   socket.on('data',chunk=>text+=chunk);
   socket.on('end',()=>resolve(text));
   socket.on('error',reject);
  });
  assert.equal(reply,'ready');
  const file=path.join(dir,'ubuntu-pairing.json');
  const saved={token:'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ',key:Buffer.alloc(32).toString('base64'),owner:{userId:'11',chatId:'11',botUsername:'testbot'},offset:2};
  fs.writeFileSync(file,JSON.stringify(saved),{mode:0o600});
  assert.equal(readPairing(config).key.length,32);
  fs.chmodSync(file,0o644);
  assert.throws(()=>readPairing(config),/permissions/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
