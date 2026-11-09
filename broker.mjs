import {spawn} from 'node:child_process';import {Duplex} from 'node:stream';import {createInterface} from 'node:readline';
export function startBroker(executable,name,onConnection){
 const child=spawn(executable,[name],{windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr.resume();const streams=new Map();child.stdin.on('error',()=>{for(const s of streams.values())s.destroy();});
 const reader=createInterface({input:child.stdout});reader.on('line',line=>{
  if(line[0]==='+'){const id=line.slice(1);const stream=new Duplex({read(){},write(b,e,cb){try{const text=b.toString('utf8').replace(/\n$/,'');if(child.stdin.destroyed||child.stdin.writableEnded)throw new Error('Broker closed');child.stdin.write(id+'\t'+Buffer.from(text).toString('base64')+'\n',cb);}catch(err){cb(err);}},destroy(err,cb){streams.delete(id);if(!child.stdin.destroyed&&!child.stdin.writableEnded)child.stdin.write('!'+id+'\n');cb(err);}});streams.set(id,stream);onConnection(stream);}
  else if(line[0]==='-'){const stream=streams.get(line.slice(1));stream?.destroy();streams.delete(line.slice(1));}
  else{const i=line.indexOf('\t'),stream=streams.get(line.slice(0,i));if(stream)stream.push(Buffer.concat([Buffer.from(line.slice(i+1),'base64'),Buffer.from('\n')]));}
 });
 child.on('exit',()=>{for(const s of streams.values())s.destroy();streams.clear();});return child;
}
