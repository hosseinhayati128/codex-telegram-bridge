import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {randomUUID,createHash} from 'node:crypto';
import {NativeRequests} from './native-requests.mjs';import {FrameMux,LineObserver} from './framing.mjs';import {clientHandshake} from './ipc.mjs';import {loadSecret} from './secrets.mjs';
const root=import.meta.dirname;let config=null;
try{config=JSON.parse(fs.readFileSync(path.join(root,'bridge-config.json'),'utf8'));}catch{}
const ubuntu=process.platform==='linux'?await import('./ubuntu/runtime.mjs'):null;
if(ubuntu)ubuntu.verifyInstallation(root,config);
const vendor=ubuntu?config.realCli:process.env.CODEX_TELEGRAM_REAL_CLI||config?.realCli;
if(!vendor){console.error('Vendor CLI path missing; use rollback launcher.');process.exit(1);}
const env={...process.env};delete env.CODEX_WINDOWS_REGISTERED_CORE;delete env.CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY;delete env.CODEX_TELEGRAM_REAL_CLI;
const args=process.argv.slice(2);
const appToolsSocket=process.env.CODEX_APP_TOOLS_PIPE_PATH?.trim()||null;
const child=spawn(ubuntu?config.bubblewrap:vendor,ubuntu?ubuntu.sandboxArgs(config,vendor,args,appToolsSocket):args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
let channel=null,alive=true,enabled=false,retry=null,registry=null;
try{enabled=!!config&&createHash('sha256').update(fs.readFileSync(vendor)).digest('hex')===config.expectedCliSha256;}catch{}
const generation=randomUUID();
const publish=event=>{try{channel?.send({type:'native',event});}catch{channel?.close();}};
const disable=()=>{enabled=false;registry?.disconnect();};
const mux=new FrameMux({write:bytes=>{if(!child.stdin.write(bytes))process.stdin.pause();},accept:message=>enabled?registry.desktop(message):true,onOverflow:disable});
registry=new NativeRequests({generation,threads:config?.chats?.map(c=>c.id)||[],send:message=>mux.inject(message),publish});
let linuxLinked=false;
const observer=new LineObserver({onFrame:message=>{
 if(enabled)registry.server(message);
 // A response proves the Linux vendor started inside its private mount namespace.
 if(ubuntu&&!linuxLinked&&args.includes('app-server')){
  linuxLinked=true;
  reconnect();
 }
},onOverflow:disable});
process.stdin.on('data',b=>mux.push(b));child.stdin.on('drain',()=>process.stdin.resume());
process.stdin.on('end',()=>{alive=false;registry.disconnect();mux.end();child.stdin.end();channel?.close();clearTimeout(retry);});
process.stdin.on('error',()=>child.stdin.end());child.stdin.on('error',()=>{});
child.stdout.on('data',b=>{if(!process.stdout.write(b))child.stdout.pause();observer.push(b);});process.stdout.on('drain',()=>child.stdout.resume());
child.stderr.on('data',b=>{if(!process.stderr.write(b))child.stderr.pause();});process.stderr.on('drain',()=>child.stderr.resume());
const finish=code=>{alive=false;registry.disconnect();clearTimeout(retry);channel?.close();process.exitCode=code??1;process.stdin.destroy();};
child.on('error',()=>finish(1));child.on('exit',finish);
process.stdout.on('error',()=>{alive=false;child.stdin.end();setTimeout(()=>child.kill(),2000).unref();});
const interval=setInterval(()=>registry.expire(),5000);interval.unref();
function reconnect(){if(!alive||!config)return;
 if(ubuntu&&!ubuntu.desktopEndpoint(appToolsSocket)){retry=setTimeout(reconnect,5000);return;}
 const socket=net.connect(ubuntu?ubuntu.brokerEndpoint(config):'\\\\.\\pipe\\'+config.pipeName);socket.on('error',()=>{});
 socket.once('connect',async()=>{try{const key=ubuntu?ubuntu.readPairing(config).key:loadSecret(config.stateRoot,'key');const c=await clientHandshake(socket,key);if(!alive){c.close();return;}channel=c;
   c.on('message',m=>{if(m?.type==='watch-threads'&&enabled){try{registry.setThreads(m.threadIds);}catch{c.close();}return;}if(m?.type==='answer'&&enabled){try{const result=registry.answer(m.ticket,m.input);c.send({type:'answer-result',operation:m.operation,...result});}catch{try{c.send({type:'answer-result',operation:m.operation,state:'rejected-or-uncertain'});}catch{}}}});
   c.send({type:'hello',generation,watchProtocol:1,nativeEnabled:enabled,cliHash:enabled?config.expectedCliSha256:null,appToolsPipe:appToolsSocket});if(enabled)registry.reissue();
  }catch{socket.destroy();}});
 socket.once('close',()=>{channel=null;if(alive)retry=setTimeout(reconnect,5000);});
}
if(!ubuntu)reconnect();
