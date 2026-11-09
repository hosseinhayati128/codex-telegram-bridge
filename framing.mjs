import {parseWire,stringifyWire} from './wire.mjs';
const LIMIT=64*1024*1024;
export class LineObserver {
  constructor({onFrame,onOverflow=()=>{},onInvalid=()=>{},limit=LIMIT}){Object.assign(this,{onFrame,onOverflow,onInvalid,limit});this.parts=[];this.size=0;this.skip=false;}
  push(chunk){
    let start=0;
    for(let end=chunk.indexOf(10,start);end!==-1;end=chunk.indexOf(10,start)){
      const part=chunk.subarray(start,end+1);this.add(part);
      if(!this.skip){try{this.onFrame(parseWire(Buffer.concat(this.parts,this.size).toString('utf8')));}catch{this.onInvalid();}}
      this.parts=[];this.size=0;this.skip=false;start=end+1;
    }
    if(start<chunk.length)this.add(chunk.subarray(start));
  }
  add(part){if(this.skip)return;this.size+=part.length;if(this.size>this.limit){this.parts=[];this.skip=true;this.onOverflow();}else this.parts.push(part);}
}
// Buffer only a single desktop JSONL frame. Insert remote responses at boundaries.
// An oversized frame switches this connection to unchanged desktop passthrough.
export class FrameMux {
 constructor({write,accept=()=>true,onOverflow=()=>{},limit=LIMIT}){Object.assign(this,{write,accept,onOverflow,limit});this.parts=[];this.size=0;this.queued=[];this.closed=false;this.passthrough=false;}
 push(chunk){
  if(this.closed)throw new Error('Mux closed');if(this.passthrough){this.write(chunk);return;}
  let start=0;
  for(let end=chunk.indexOf(10,start);end!==-1;end=chunk.indexOf(10,start)){
   this.parts.push(chunk.subarray(start,end+1));this.size+=end+1-start;
   const frame=Buffer.concat(this.parts,this.size);this.parts=[];this.size=0;
   if(frame.length>this.limit){this.passthrough=true;this.queued=[];this.onOverflow();this.write(frame);this.write(chunk.subarray(end+1));return;}
   let accepted=true;try{accepted=this.accept(parseWire(frame.toString('utf8')));}catch{/* observational failure never corrupts desktop bytes */}
   if(accepted)this.write(frame);this.flush();start=end+1;
  }
  if(start<chunk.length){this.parts.push(chunk.subarray(start));this.size+=chunk.length-start;}
  if(this.size>this.limit){this.passthrough=true;this.queued=[];this.onOverflow();this.write(Buffer.concat(this.parts,this.size));this.parts=[];this.size=0;}
 }
 inject(message){if(this.closed||this.passthrough)throw new Error('Mux closed for native replies');const frame=Buffer.from(stringifyWire(message)+'\n');if(this.size)this.queued.push(frame);else this.write(frame);}
 flush(){if(!this.size)for(const frame of this.queued.splice(0))this.write(frame);}
 end(){if(this.closed)return;this.closed=true;if(this.size)this.write(Buffer.concat(this.parts,this.size));this.parts=[];this.size=0;this.queued=[];}
}
