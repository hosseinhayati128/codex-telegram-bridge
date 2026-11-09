import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {cloneWire,parseWire,stringifyWire,fingerprint} from './wire.mjs';
export function atomicWrite(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.next-'+randomUUID();fs.writeFileSync(tmp,stringifyWire(data),{flag:'wx',mode:0o600,flush:true});fs.renameSync(tmp,file);}
export class State {
 constructor(file,{offset=0,selected='this'}={}){this.file=file;this.data=fs.existsSync(file)?parseWire(fs.readFileSync(file,'utf8')):{version:1,offset,selected,journal:{},seen:{}};
  if(this.data.version!==1||!Number.isSafeInteger(this.data.offset)||!this.data.journal)throw new Error('Invalid persistent state; manual recovery required');
  for(const x of Object.values(this.data.journal))if(['prepared','dispatching','queued'].includes(x.state))x.state='uncertain';this.save();
 }
 save(){atomicWrite(this.file,this.data);}
 get(id){return this.data.journal[String(id)];}
 begin(id,payload){if(!Number.isSafeInteger(id)||id<this.data.offset||this.get(id))return false;this.data.journal[String(id)]={state:'prepared',payload:cloneWire(payload),fingerprint:fingerprint(payload),at:new Date().toISOString()};this.data.offset=id+1;this.save();return true;}
 dispatching(id){const e=this.get(id);if(e?.state!=='prepared'&&!(e?.state==='queued'&&['incoming-file','outgoing-file'].includes(e.payload.kind)))throw new Error('Operation is not prepared');e.state='dispatching';this.save();}
 finish(id,state){const e=this.get(id);if(!e)throw new Error('Unknown operation');e.state=state;this.save();}
}
