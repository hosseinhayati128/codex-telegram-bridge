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
