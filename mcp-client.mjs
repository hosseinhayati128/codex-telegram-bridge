import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';
export class McpClient {
 constructor(serverPath,pipe){this.nextId=1;this.pending=new Map();this.child=spawn(process.execPath,[serverPath],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,CODEX_APP_TOOLS_PIPE_PATH:pipe}});this.child.stderr.resume();this.child.stdin.on('error',()=>{});
  createInterface({input:this.child.stdout}).on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error('App Tools rejected request')):p.resolve(m.result);});
  this.child.on('error',()=>this.fail());this.child.on('exit',()=>this.fail());
 }
 fail(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Codex App Tools unavailable'));}this.pending.clear();}
 request(method,params){const id=this.nextId++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Codex App Tools timed out'));},12000);this.pending.set(id,{resolve,reject,timer});try{this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');}catch{clearTimeout(timer);this.pending.delete(id);reject(new Error('Codex App Tools write uncertain'));}});}
 async initialize(){await this.request('initialize',{protocolVersion:'2024-11-05',clientInfo:{name:'codex-telegram-bridge',version:'1.0.0'},capabilities:{}});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');}
 async call(name,args,threadId){const r=await this.request('tools/call',{name,arguments:args,_meta:{'openai/threadId':threadId}});if(r.isError)throw new Error('Codex App Tools rejected operation');const text=r.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')||'';try{return JSON.parse(text);}catch{return{text};}}
 async close(){this.fail();if(this.child.exitCode!==null)return;this.child.stdin.end();await new Promise(resolve=>{const timer=setTimeout(()=>{this.child.kill();resolve();},1500);this.child.once('exit',()=>{clearTimeout(timer);resolve();});});}
}
