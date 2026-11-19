import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export function privateDirectory(root) {
 const dir=path.join(root,'private');
 const info=fs.lstatSync(dir);
 if(!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o077)) {
  throw new Error('The bridge private directory must belong to this user and have mode 0700.');
 }
 return dir;
}

export function verifyInstallation(root,config) {
 if(config?.platform!=='linux'||config.stateRoot!==fs.realpathSync(root)
   ||config.transferRoot!==path.join(config.stateRoot,'files')
   ||config.runtimeDir!=='/run/user/'+process.getuid()
   ||config.codexHome===root||config.codexHome.startsWith(root+'/')) {
  throw new Error('Run Ubuntu setup from the extracted bridge directory.');
 }
 privateDirectory(config.stateRoot);
 brokerEndpoint(config);
}

export function brokerEndpoint(config) {
 const endpoint=path.posix.join(config.stateRoot,'private','control.sock');
 if(Buffer.byteLength(endpoint)>107)throw new Error('Use a shorter path for the Ubuntu bridge directory.');
 return endpoint;
}

export function readPairing(config) {
 const file=path.join(privateDirectory(config.stateRoot),'ubuntu-pairing.json');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try {
  const info=fs.fstatSync(fd);
  if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o077)||info.nlink!==1||info.size>4096) {
   throw new Error('Invalid Ubuntu credential file permissions.');
  }
  let pairing;
  try {pairing=JSON.parse(fs.readFileSync(fd,'utf8'));}catch{throw new Error('Unreadable Ubuntu pairing.');}
  const key=Buffer.from(pairing.key||'','base64');
  if(key.length!==32||!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(pairing.token||'')
    ||!/^[1-9]\d{0,15}$/.test(pairing.owner?.userId||'')||pairing.owner.userId!==pairing.owner.chatId
    ||!/^[A-Za-z0-9_]{5,32}$/.test(pairing.owner.botUsername||'')
    ||!Number.isSafeInteger(pairing.offset)||pairing.offset<0)throw new Error('Invalid Ubuntu pairing.');
  return {...pairing,key};
 } finally {
  fs.closeSync(fd);
 }
}

export function desktopEndpoint(endpoint) {
 if(typeof endpoint!=='string'||!path.posix.isAbsolute(endpoint)||endpoint.startsWith('//')
   ||endpoint.includes('\0')||Buffer.byteLength(endpoint)>107)return false;
 try {
  const info=fs.lstatSync(endpoint);
  return info.isSocket()&&info.uid===process.getuid();
 } catch {
  return false;
 }
}

export function sandboxArgs(config,command,args=[],appToolsSocket) {
 const root=config.stateRoot;
 // The user service manager could otherwise run a command outside the private mount.
 const isolation=[
  '--unshare-pid','--die-with-parent','--bind','/','/','--proc','/proc',
  '--ro-bind',root,root,'--tmpfs',path.posix.join(root,'private'),
  '--tmpfs',config.runtimeDir,'--unsetenv','DBUS_SESSION_BUS_ADDRESS',
 ];
 if(appToolsSocket?.startsWith(config.runtimeDir+'/')&&path.posix.basename(appToolsSocket).startsWith('codex-app-tools')&&desktopEndpoint(appToolsSocket)){
  isolation.push('--ro-bind',appToolsSocket,appToolsSocket);
 }
 return [...isolation,'--',command,...args];
}

async function removeStaleSocket(endpoint) {
 let info;
 try {info=fs.lstatSync(endpoint);} catch(error) {
  if(error.code==='ENOENT')return;
  throw error;
 }
 if(!info.isSocket()||info.uid!==process.getuid())throw new Error('Unexpected local broker path.');
 await new Promise((resolve,reject)=>{
  const connection=net.createConnection(endpoint);
  connection.setTimeout(1000,()=>connection.destroy(new Error('Broker path is busy.')));
  connection.once('connect',()=>connection.destroy(new Error('Broker already running.')));
  connection.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));
 });
 const current=fs.lstatSync(endpoint);
 if(current.dev!==info.dev||current.ino!==info.ino)throw new Error('Broker path changed during startup.');
 fs.unlinkSync(endpoint);
}

export async function startBroker(config,onConnection) {
 const endpoint=brokerEndpoint(config);
 await removeStaleSocket(endpoint);
 const server=net.createServer(onConnection);
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(endpoint,()=>{
   server.off('error',reject);
   resolve();
  });
 });
 return server;
}

export function appToolsAt(codexHome,packageFiles) {
 const cache=path.join(codexHome,'plugins/cache/openai-bundled/codex-app-tools');
 const versions=fs.existsSync(cache)?fs.readdirSync(cache).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})):[];
 return [...packageFiles.filter(file=>file.endsWith('/codex-app-tools/server.mjs')),
  ...versions.map(version=>path.join(cache,version,'server.mjs'))].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
}

export function checkIsolation(config) {
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
