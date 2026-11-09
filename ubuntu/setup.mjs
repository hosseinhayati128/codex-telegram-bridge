import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {parseArgs} from 'node:util';
import {TelegramApi} from '../telegram.mjs';
import {atomicWrite} from '../state.mjs';
import {privateDirectory,readPairing,sandboxArgs,verifyInstallation} from './runtime.mjs';
import {launchFiles} from './launch-files.mjs';
import {pairOwner} from './pair.mjs';

const root=fs.realpathSync(path.dirname(import.meta.dirname));
const unitName='codex-telegram-bridge.service';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const configFile=path.join(root,'bridge-config.json');

function executable(file) {
 try {
  const real=fs.realpathSync(file);
  fs.accessSync(real,fs.constants.X_OK);
  return fs.statSync(real).isFile()?real:null;
 } catch {return null;}
}

function onPath(name) {
 for(const dir of (process.env.PATH||'').split(path.delimiter)){
  if(!path.isAbsolute(dir))continue;
  const file=executable(path.join(dir,name));
  if(file)return file;
 }
}

function appToolsAt(codexHome,packageFiles) {
 const cache=path.join(codexHome,'plugins/cache/openai-bundled/codex-app-tools');
 const versions=fs.existsSync(cache)?fs.readdirSync(cache).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})):[];
 return [...versions.map(version=>path.join(cache,version,'server.mjs')),
  ...packageFiles.filter(file=>file.endsWith('/codex-app-tools/server.mjs'))].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
}

async function ask(prompt,hidden=false) {
 if(!process.stdin.isTTY)throw new Error('Run setup in the Ubuntu desktop terminal.');
 const muted=new Writable({write(_chunk,_encoding,done){done();}});
 const input=createInterface({input:process.stdin,output:hidden?muted:process.stderr,terminal:true});
 const abort=new AbortController();
 input.on('SIGINT',()=>abort.abort());
 if(hidden)process.stderr.write(prompt);
 try {return (await input.question(hidden?'':prompt,{signal:abort.signal})).trim();}
 finally {input.close();if(hidden)process.stderr.write('\n');}
}

async function chooseChat(codexHome,explicitId) {
 const index=path.join(codexHome,'session_index.jsonl');
 const chats=new Map();
 if(fs.existsSync(index)){
  for(const line of fs.readFileSync(index,'utf8').split(/\r?\n/)){
   try {
    const row=JSON.parse(line);
    if(!uuid.test(row.id||''))continue;
    const title=String(row.thread_name||'چت Codex').replace(/[\x00-\x1f\x7f-\x9f]/g,' ').slice(0,120);
    chats.set(row.id,{id:row.id,title,updatedAt:String(row.updated_at||'')});
   } catch {}
  }
 }
 let id=explicitId;
 if(!id){
  const recent=[...chats.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,10);
  recent.forEach((chat,i)=>console.log((i+1)+'. '+chat.title));
  const answer=await ask(recent.length?'شمارهٔ چت موجود یا شناسهٔ آن: ':'شناسهٔ یک چت محلی موجود Codex: ');
  id=recent[Number(answer)-1]?.id||answer.replace(/^codex:\/\/threads\//,'');
 }
 if(!uuid.test(id||''))throw new Error('Choose an existing Codex chat or enter its UUID.');
 return {id,alias:'this',title:chats.get(id)?.title||'چت Codex'};
}

function writeNew(file,body,mode=0o600) {
 try {fs.writeFileSync(file,body,{flag:'wx',mode,flush:true});}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  const info=fs.lstatSync(file);
  if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o022)||fs.readFileSync(file,'utf8')!==body)throw new Error('Existing setup file differs: '+file);
 }
}

function checkIsolation(config) {
 const name='.probe-'+randomUUID();
 const privateProbe=path.join(config.stateRoot,'private',name);
 const inputProbe=path.join(config.transferRoot,name);
 try {
  fs.writeFileSync(privateProbe,'private probe',{flag:'wx',mode:0o600});
  fs.writeFileSync(inputProbe,'transfer probe',{flag:'wx',mode:0o600});
  const manager=spawnSync(config.systemctl,['--user','show-environment'],{stdio:'ignore',timeout:5000});
  if(manager.status!==0)throw new Error('Run setup inside the Ubuntu desktop user session.');
  const probe='test ! -e "$1" && test -r "$2" && ! (printf x > "$2") && ! "$3" --user show-environment';
  const isolated=spawnSync(config.bubblewrap,sandboxArgs(config,'/bin/sh',['-c',probe,'probe',privateProbe,inputProbe,config.systemctl]),{stdio:'ignore',timeout:8000});
  if(isolated.status!==0)throw new Error('Bubblewrap did not isolate private files and the user service manager.');
  const version=spawnSync(config.bubblewrap,sandboxArgs(config,config.realCli,['--version']),{stdio:'ignore',timeout:8000});
  if(version.status!==0)throw new Error('Codex could not start inside the Ubuntu bridge launcher.');
 } finally {
  for(const file of [privateProbe,inputProbe])if(fs.existsSync(file))fs.unlinkSync(file);
 }
}

async function setup() {
 const {values}=parseArgs({options:{
  help:{type:'boolean'},cli:{type:'string'},'app-tools':{type:'string'},thread:{type:'string'},
 }});
 if(values.help){console.log('node --use-env-proxy ubuntu/setup.mjs [--cli /path/to/codex] [--app-tools /path/to/server.mjs] [--thread UUID]');return;}
 if(process.platform!=='linux'||process.getuid()===0)throw new Error('Run this setup as the Ubuntu desktop user.');
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major<24||(major===24&&minor<5))throw new Error('Node.js 24.5 or later is required.');
 process.umask(0o077);
 fs.mkdirSync(path.join(root,'private'),{recursive:true,mode:0o700});
 const privateDir=privateDirectory(root);
 const lock=path.join(privateDir,'ubuntu-setup.lock');
 const lockFd=fs.openSync(lock,'wx',0o600);
 fs.closeSync(lockFd);
 try {
  let config;
  const existing=fs.existsSync(configFile);
  const correcting=existing&&(values.thread||values.cli||values['app-tools']);
  if(existing){
   const info=fs.lstatSync(configFile);
   if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o022))throw new Error('Unexpected existing configuration file.');
   config=JSON.parse(fs.readFileSync(configFile,'utf8'));
   verifyInstallation(root,config);
   if(correcting){
    if(fs.existsSync(path.join(privateDir,'daemon-lock.json')))throw new Error('Stop codex-telegram-bridge.service before correcting setup.');
    if(values.thread){
     const chat=await chooseChat(config.codexHome,values.thread);
     config.callerThreadId=chat.id;
     config.chats=[chat];
    }
    if(values.cli){
     const cli=executable(values.cli);
     if(!cli)throw new Error('The supplied Codex executable is unavailable.');
     config.realCli=cli;
     config.expectedCliSha256=createHash('sha256').update(fs.readFileSync(cli)).digest('hex');
    }
    if(values['app-tools']){
     if(!fs.statSync(values['app-tools']).isFile())throw new Error('The supplied App Tools adapter is unavailable.');
     config.appTools=fs.realpathSync(values['app-tools']);
    }
   }
  }else{
   const app=onPath('chatgpt'),bubblewrap=onPath('bwrap'),dpkg=onPath('dpkg-query'),systemctl=onPath('systemctl');
   const runtimeDir='/run/user/'+process.getuid();
   const bus=process.env.DBUS_SESSION_BUS_ADDRESS;
   if(process.env.XDG_RUNTIME_DIR!==runtimeDir||(bus&&bus!=='unix:path='+runtimeDir+'/bus'))throw new Error('Use a standard Ubuntu desktop user session.');
   const packageFiles=dpkg?(spawnSync(dpkg,['-L','chatgpt'],{encoding:'utf8',timeout:5000}).stdout||'').split('\n'):[];
   const realCli=values.cli?executable(values.cli):packageFiles.filter(f=>f.endsWith('/codex')).map(executable).find(Boolean)||onPath('codex');
   const codexHome=fs.realpathSync(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'));
   const appTools=values['app-tools']||appToolsAt(codexHome,packageFiles);
   if(!app||!bubblewrap||!systemctl||!realCli||!appTools||!fs.statSync(appTools).isFile())throw new Error('Install ChatGPT Desktop, its Codex CLI, and bubblewrap. Use --cli or --app-tools for a custom installation.');
   const chat=await chooseChat(codexHome,values.thread);
   config={version:1,platform:'linux',stateRoot:root,transferRoot:path.join(root,'files'),codexHome,
    app,bubblewrap,systemctl,runtimeDir,realCli,appTools:fs.realpathSync(appTools),node:process.execPath,
    expectedCliSha256:createHash('sha256').update(fs.readFileSync(realCli)).digest('hex'),
    callerThreadId:chat.id,chats:[chat]};
   verifyInstallation(root,config);
  }
  fs.mkdirSync(config.transferRoot,{recursive:true,mode:0o700});
  const transfer=fs.lstatSync(config.transferRoot);
  if(!transfer.isDirectory()||transfer.uid!==process.getuid()||(transfer.mode&0o077))throw new Error('The incoming file directory must belong to this user and have mode 0700.');
  checkIsolation(config);
  const files=launchFiles({root,node:config.node,app:config.app,codexHome:config.codexHome});
  const unitDir=path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'),'systemd/user');
  fs.mkdirSync(unitDir,{recursive:true,mode:0o700});
  writeNew(path.join(unitDir,unitName),files.unit);
  if(correcting)atomicWrite(configFile,config);
  else if(!existing)writeNew(configFile,JSON.stringify(config,null,2)+'\n');
  writeNew(path.join(root,'codex-telegram-cli'),files.cli,0o700);
  writeNew(path.join(root,'start-codex'),files.desktop,0o700);

  const pairingFile=path.join(privateDir,'ubuntu-pairing.json');
  if(fs.existsSync(pairingFile))readPairing(config);
  else{
   const token=await ask('توکن BotFather را همین‌جا وارد کن: ',true);
   const api=new TelegramApi(token);
   const bot=await api.call('getMe');
   if(!bot.is_bot||!/^[A-Za-z0-9_]{5,32}$/.test(bot.username||''))throw new Error('Telegram did not identify a bot.');
   if((await api.call('getWebhookInfo')).url)throw new Error('This bot has a webhook. Pair a bot that uses polling.');
   await ask('اگر همین ربات روی ویندوز یا دستگاه دیگری فعال است، سرویس قبلی را متوقف کن. سپس Enter بزن: ');
   const code=randomBytes(12).toString('base64url');
   console.log('تا پنج دقیقه این پیام را در چت خصوصی @'+bot.username+' بفرست:\n/pair '+code);
   const pairing=await pairOwner(api,bot.username,code);
   const temp=pairingFile+'.next-'+randomUUID();
   try {
    fs.writeFileSync(temp,JSON.stringify({...pairing,key:randomBytes(32).toString('base64'),token})+'\n',{flag:'wx',mode:0o600,flush:true});
    fs.linkSync(temp,pairingFile);
   }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  console.log('آماده است. برای شروع سرویس:\nsystemctl --user daemon-reload\nsystemctl --user enable --now '+unitName);
  console.log('بعد از خروج کامل از ChatGPT، از همین پوشه اجرا کن:\n./start-codex\nnode ubuntu/doctor.mjs');
 }finally{fs.unlinkSync(lock);}
}

setup().catch(error=>{
 console.error(error.telegramCode===409?'Telegram polling is active on another host. Stop that service and run setup again.':error.message);
 process.exitCode=1;
});
