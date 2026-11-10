// Only notifications are retried. Commands and native answers never use this queue.
export class Outbox {
 constructor(state,send){this.state=state;this.send=send;this.running=false;state.data.notifications??={};}
 add(key,text,meta={}){if(Object.hasOwn(this.state.data.notifications,key))return;Object.defineProperty(this.state.data.notifications,key,{value:{...meta,text,atUtc:new Date().toISOString()},enumerable:true,configurable:true,writable:true});this.state.save();}
 async flush(){
  if(this.running)return;
  this.running=true;
  try{
   for(const[key,item]of Object.entries(this.state.data.notifications)){
    if(!Object.hasOwn(this.state.data.notifications,key))continue;
    if(item.kind==='progress'&&this.state.data.updatesByThread?.[item.threadId]!=='progress'){
     delete this.state.data.notifications[key];this.state.save();continue;
    }
    try{
     if(!item.parts)await this.send(item.text,item);
     else for(let index=item.nextPart??0;index<item.parts.length&&Object.hasOwn(this.state.data.notifications,key);index++){
      const part=item.parts[index];
      await this.send(part.text?.trim()??'',{...item,image:part.image});
      item.nextPart=index+1;
      this.state.save();
     }
    }catch{return;}
    delete this.state.data.notifications[key];this.state.save();
   }
  }finally{this.running=false;}
 }
}
export class NativeDelivery {
 constructor(native){this.native=native;this.pending=new Map();this.running=false;}
 track(request,route){this.pending.set(request.ticket,{request,route,delivered:false});}
 async resolve(ticket){this.pending.delete(ticket);await this.native.resolve(ticket);}
 async disconnect(route){for(const[t,x]of this.pending)if(x.route===route)this.pending.delete(t);await this.native.disconnect(route);}
 async flush(){if(this.running)return;this.running=true;try{for(const[t,x]of this.pending){if(x.request.expiresAt<Date.now()){await this.resolve(t);continue;}if(x.delivered)continue;try{await this.native.show(x.request,x.route);if(this.pending.get(t)===x)x.delivered=true;}catch{/* Retry presentation, never the answer, after connectivity recovers. */}}}finally{this.running=false;}}
}
