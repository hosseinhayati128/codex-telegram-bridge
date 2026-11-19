import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import net from 'node:net';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {packageRuntime,refreshWindowsRuntime} from '../windows-runtime.mjs';
import {RUNTIME_FILES} from '../installation.mjs';
import {clientHandshake} from '../ipc.mjs';

const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-windows-refresh-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const runtime={realCli:path.join(root,'codex.exe'),appTools:path.join(root,'server.mjs')};
 fs.writeFileSync(runtime.realCli,'new cli');fs.writeFileSync(runtime.appTools,'adapter');
 const config={realCli:path.join(root,'removed','codex.exe'),appTools:path.join(root,'removed','server.mjs'),expectedCliSha256:'old',chats:[{id:'kept'}],stateRoot:root,pipeName:'kept',node:process.execPath};
 return {root,runtime,config};
}

test('Windows package discovery accepts only the registered Store package under WindowsApps',()=>{
 const valid={Name:'OpenAI.Codex',PublisherId:'2p2nqsd0c76g0',SignatureKind:'Store',Status:'Ok',InstallLocation:'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1111.2228.0_x64__2p2nqsd0c76g0'};
 assert.ok(packageRuntime(valid,'C:\\Program Files').realCli.endsWith('\\app\\resources\\codex.exe'));
 for(const patch of [
  {PublisherId:'other'},{SignatureKind:'Developer'},{Status:'Modified'},
  {InstallLocation:'C:\\Users\\someone\\OpenAI.Codex_fake'},
  {InstallLocation:'C:\\Program Files\\WindowsApps\\OpenAI.Codex_fake\\..\\other'},
 ])assert.throws(()=>packageRuntime({...valid,...patch},'C:\\Program Files'));
});

test('Windows startup replaces removed package paths only after CLI qualification and preserves chat settings',async t=>{
 const f=fixture(t),old=structuredClone(f.config),calls=[];
 const discover=async()=>f.runtime;
 const qualify=async cli=>{calls.push(cli);assert.deepEqual(f.config,old);};
 assert.equal(await refreshWindowsRuntime(f.config,{discover,qualify}),true);
 assert.equal(f.config.realCli,f.runtime.realCli);
 assert.equal(f.config.appTools,f.runtime.appTools);
 assert.equal(f.config.expectedCliSha256,sha(f.runtime.realCli));
 assert.deepEqual(f.config.chats,old.chats);
 assert.equal(f.config.pipeName,old.pipeName);
 assert.equal(await refreshWindowsRuntime(f.config,{discover,qualify}),false);
 assert.deepEqual(calls,[f.runtime.realCli]);
});

test('failed qualification leaves the old runtime and approval fingerprint intact',async t=>{
 const f=fixture(t),old=structuredClone(f.config);
 await assert.rejects(refreshWindowsRuntime(f.config,{discover:async()=>f.runtime,qualify:async()=>{throw new Error('sandbox failed');}}),/sandbox failed/);
 assert.deepEqual(f.config,old);
});

test('a package replacement during qualification is rejected before it becomes actionable',async t=>{
 const f=fixture(t),old=structuredClone(f.config);
 await assert.rejects(refreshWindowsRuntime(f.config,{discover:async()=>f.runtime,qualify:async()=>{fs.writeFileSync(f.runtime.realCli,'different');}}),/changed/);
 assert.deepEqual(f.config,old);
});

test('concurrent Windows refreshes qualify once and never accept a linked executable',async t=>{
 const f=fixture(t);
 let attempts=0;
 const options={discover:async()=>f.runtime,qualify:async()=>{attempts++;await new Promise(r=>setTimeout(r,15));}};
 await Promise.all([refreshWindowsRuntime(f.config,options),refreshWindowsRuntime(f.config,options)]);
 assert.equal(attempts,1);
 const linked=path.join(f.root,'linked.exe');
 try{fs.linkSync(f.runtime.realCli,linked);}catch{return;}
 await assert.rejects(refreshWindowsRuntime({...f.config,expectedCliSha256:'old'},{discover:async()=>({...f.runtime,realCli:linked}),qualify:async()=>{throw new Error('must not run');}}),/regular|package|linked/);
});

const csc=path.join(process.env.SystemRoot??'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
test('Windows daemon refreshes an authenticated relay before checking its new CLI fingerprint',
 {skip:process.platform!=='win32'||!fs.existsSync(csc),timeout:15000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-daemon-refresh-'));
 const release=path.join(root,'release'),privateDir=path.join(root,'private'),ready=path.join(release,'runtime-ready');
 fs.mkdirSync(release);fs.mkdirSync(privateDir);
 for(const file of RUNTIME_FILES.filter(n=>n.endsWith('.mjs')))fs.copyFileSync(path.resolve(import.meta.dirname,'..',file),path.join(release,file));
 const build=spawnSync(csc,['/nologo','/optimize+','/out:'+path.join(release,'PipeBroker.exe'),path.resolve(import.meta.dirname,'../PipeBroker.cs')],{windowsHide:true,encoding:'utf8'});
 assert.equal(build.status,0,build.stdout+build.stderr);
 // This fixture simulates a package update after startup, with no watched chats to trigger polling.
 fs.writeFileSync(path.join(release,'windows-runtime.mjs'),
  "import fs from 'node:fs'; import {setTimeout as sleep} from 'node:timers/promises'; let calls=0;"+
  "export async function refreshWindowsRuntime(config){ if(++calls===1)return false; while(!fs.existsSync(new URL('./runtime-ready',import.meta.url)))await sleep(10); config.expectedCliSha256='new';return true;}");
 fs.writeFileSync(path.join(release,'secrets.mjs'),"export const loadSecret=(_root,kind)=>kind==='key'?Buffer.alloc(32,3):'123456:abcdefghijklmnopqrstuvwxyz';");
 fs.writeFileSync(path.join(release,'telegram.mjs'),
  "import {setTimeout as sleep} from 'node:timers/promises'; export class TelegramApi {async call(method){"+
  "if(method==='getMe')return {username:'fixturebot'};if(method==='getWebhookInfo')return {url:''};"+
  "if(method==='getUpdates'){await sleep(50);return [];}return {message_id:1};}}"+
  "export const sendText=async()=>{};export const sendCodexText=async()=>{};export const isOwner=()=>false;");
 const pipeName='CodexTelegramBridge-refresh-'+path.basename(root),endpoint='\\\\.\\pipe\\'+pipeName;
 fs.writeFileSync(path.join(release,'bridge-config.json'),JSON.stringify({stateRoot:root,transferRoot:path.join(root,'files'),codexHome:root,pipeName,chats:[],expectedCliSha256:'old'}));
 fs.writeFileSync(path.join(privateDir,'owner.json'),JSON.stringify({userId:'1',chatId:'1',botUsername:'fixturebot'}));
 const env={...process.env};delete env.CODEX_TELEGRAM_SUPERVISED;
 const daemon=spawn(process.execPath,[path.join(release,'daemon.mjs')],{env,windowsHide:true,stdio:['pipe','ignore','pipe']});
 daemon.stderr.resume();
 let channel;
 t.after(async()=>{
  channel?.close();
  if(daemon.exitCode===null&&daemon.signalCode===null){const closed=once(daemon,'close');daemon.kill();await closed;}
  fs.rmSync(root,{recursive:true,force:true,maxRetries:15,retryDelay:50});
 });
 let socket;
 for(let n=0;n<80;n++){
  assert.equal(daemon.exitCode,null,'Daemon exited before accepting its relay');
  socket=net.connect(endpoint);socket.on('error',()=>{});
  try{await once(socket,'connect',{signal:AbortSignal.timeout(100)});break;}
  catch{socket.destroy();await sleep(25);}
 }
 assert.ok(socket&&!socket.destroyed,'Fixture broker did not start');
 channel=await clientHandshake(socket,Buffer.alloc(32,3),1500);
 const response=once(channel,'message',{signal:AbortSignal.timeout(3000)});
 channel.send({type:'hello',generation:'fixture-generation',watchProtocol:1,nativeEnabled:true,cliHash:'new',appToolsPipe:null});
 await sleep(75);
 fs.writeFileSync(ready,'ready');
 const [message]=await response;
 assert.deepEqual(message,{type:'watch-threads',threadIds:[]});
});
