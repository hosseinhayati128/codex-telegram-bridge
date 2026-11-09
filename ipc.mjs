import {EventEmitter} from 'node:events';import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';import {LineObserver} from './framing.mjs';import {stringifyWire} from './wire.mjs';
const mac=(key,role,s,c)=>createHmac('sha256',key).update([role,s,c].join('\0')).digest('hex');
const equal=(a,b)=>typeof a==='string'&&a.length===64&&/^[0-9a-f]+$/.test(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
export class Channel extends EventEmitter {
 constructor(stream){super();this.stream=stream;this.backlog=[];
  this.observer=new LineObserver({limit:16*1024*1024,onOverflow:()=>stream.destroy(),onInvalid:()=>stream.destroy(),onFrame:m=>{if(this.listenerCount('message'))this.emit('message',m);else this.backlog.push(m);if(this.backlog.length>100)stream.destroy();}});
  stream.on('data',b=>this.observer.push(b));stream.on('error',()=>{});stream.on('close',()=>this.emit('close'));
 }
 on(name,fn){super.on(name,fn);if(name==='message'&&this.backlog?.length)queueMicrotask(()=>{for(const m of this.backlog.splice(0))this.emit('message',m);});return this;}
 send(m){if(this.stream.destroyed||this.stream.writableLength>32*1024*1024)throw new Error('Local channel unavailable');this.stream.write(stringifyWire(m)+'\n');}
 close(){this.stream.destroy();}
}
function handshake(stream,key,server,timeout){
 const channel=new Channel(stream),s=server?randomBytes(32).toString('hex'):null;
 return new Promise((resolve,reject)=>{
  let stage=0,serverNonce=s,clientNonce;
  const fail=()=>{cleanup();channel.close();reject(new Error('Local authentication failed'));};
  const timer=setTimeout(fail,timeout);
  const cleanup=()=>{clearTimeout(timer);channel.off('message',receive);channel.off('close',fail);};
  const done=()=>{cleanup();resolve(channel);};
  const receive=m=>{
   if(server){if(stage!==0||m?.type!=='authenticate'||typeof m.nonce!=='string'||!/^[0-9a-f]{64}$/.test(m.nonce)||!equal(m.proof,mac(key,'client',s,m.nonce)))return fail();
    stage=1;channel.send({type:'authenticated',proof:mac(key,'server',s,m.nonce)});done();
   }else if(stage===0){if(m?.type!=='challenge'||!/^[0-9a-f]{64}$/.test(m.nonce||''))return fail();serverNonce=m.nonce;clientNonce=randomBytes(32).toString('hex');stage=1;channel.send({type:'authenticate',nonce:clientNonce,proof:mac(key,'client',serverNonce,clientNonce)});
   }else{if(m?.type!=='authenticated'||!equal(m.proof,mac(key,'server',serverNonce,clientNonce)))return fail();done();}
  };
  channel.on('message',receive);channel.on('close',fail);if(server)channel.send({type:'challenge',nonce:s});
 });
}
export const serverHandshake=(stream,key,timeout=5000)=>handshake(stream,key,true,timeout);
export const clientHandshake=(stream,key,timeout=5000)=>handshake(stream,key,false,timeout);
