import {translator} from './i18n.mjs';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {McpClient} from './mcp-client.mjs';import {atomicWrite} from './state.mjs';import {Outbox} from './delivery.mjs';
import {markdownImageParts,toolImagePart} from './images.mjs';
const publicProgress=i=>i.type==='agentMessage'&&['commentary','partial_answer'].includes(i.phase)&&typeof i.id==='string'&&typeof i.text==='string';
const progressSnapshot=(root,threadId,turns)=>Object.fromEntries(turns.map(t=>[t.id,t.items.filter(i=>publicProgress(i)||toolImagePart(root,threadId,t.id,i)).map(i=>i.id)]));
const terminalTurn=t=>['completed','failed','interrupted'].includes(t.status);
const finalMessage=i=>i.type==='agentMessage'&&i.phase==='final_answer'&&typeof i.text==='string'&&i.text.trim();
const replyId=(turn,item)=>`${turn.id}:${item.id}`;
const publishedReply=i=>finalMessage(i)&&typeof i.id==='string'&&i.id;
export class Desktop {
 constructor(config,state,notify,pinImage){Object.assign(this,{config,state,notify,pinImage});this.t=translator(()=>state.data.botLanguage);this.client=null;this.pipe=null;this.connected=false;this.opening=null;this.file=path.join(config.stateRoot,'private/desktop-connection.json');this.outbox=new Outbox(state,notify);state.data.capturedFinals??={};state.data.updatesByThread??={};state.data.progressCursors??={};state.data.replyCursors??={};for(const c of state.data.watchedChats||[])if(/^[0-9a-f-]{36}$/.test(c.id)&&typeof c.title==='string'&&typeof c.alias==='string'&&!config.chats.some(x=>x.id===c.id))config.chats.push({...c});}
 async configureUpdates(threadId,value){if(!this.config.chats.some(c=>c.id===threadId)||!['quiet','progress'].includes(value))throw new Error('Invalid updates preference');
  if(value==='progress'&&this.state.data.updatesByThread[threadId]!=='progress'){const r=await this.read(threadId,4);this.state.data.progressCursors[threadId]=progressSnapshot(this.config.stateRoot,threadId,r.turns);}
  this.state.data.updatesByThread[threadId]=value;
  if(value==='quiet')for(const[key,item]of Object.entries(this.state.data.notifications))if(item.kind==='progress'&&item.threadId===threadId)delete this.state.data.notifications[key];
  this.state.save();
 }
 queueReply(key,heading,entries,meta){
  const parts=[{text:heading}];
  for(const entry of entries)for(const part of typeof entry==='string'?markdownImageParts('\n\n'+entry):[{image:entry}]){
   if(part.image?.path&&this.pinImage)part.image.file=this.pinImage(part.image.path,meta)??null;
   const last=parts.at(-1);
   if(!last.image&&!part.image)last.text+=part.text;else parts.push(part);
  }
  this.outbox.add(key,parts[0].text,parts.length>1?{...meta,parts}:meta);
 }
 baselineReplies(threadId,turns){
  // Baseline IDs are false; IDs durably queued for delivery are true.
  return this.state.data.replyCursors[threadId]??=Object.fromEntries(turns.flatMap(t=>(t.items??[]).filter(publishedReply).map(i=>[replyId(t,i),false])));
 }
 queuePublishedReply(chat,t,item,cwd){
  const replies=this.state.data.replyCursors[chat.id],id=replyId(t,item);
  const key=`${chat.id}:${t.id}:reply:${item.id}`;
  replies[id]=true;
  try{
   this.queueReply(key,this.t`${chat.title}\nپاسخ Codex`,[item.text],{kind:'reply',threadId:chat.id,cwd,turnId:t.id});
  }catch(error){
   delete replies[id];
   delete this.state.data.notifications[key];
   throw error;
  }
 }
 captureActivity(chat,t,cwd,cursor,replies){
  const seen=new Set(cursor?.[t.id]||[]),entries=[],ids=[],items=t.items??[];
  const terminal=terminalTurn(t),alreadyFinal=this.state.data.capturedFinals[chat.id]?.includes(t.id);
  const flushProgress=()=>{
   if(!cursor)return;
   // Outbox.add persists consumed IDs with the notification.
   cursor[t.id]=[...seen];
   if(!entries.length)return;
   const batch=createHash('sha256').update(JSON.stringify(ids)).digest('hex');
   this.queueReply(`${chat.id}:${t.id}:progress:${batch}`,this.t`${chat.title}\nپیشرفت Codex`,entries,{kind:'progress',threadId:chat.id,cwd,turnId:t.id});
   entries.length=0;
   ids.length=0;
  };
  for(const [index,item] of items.entries()){
   // A following item closes a streamed message even while the turn is open.
   const closed=terminal||index<items.length-1;
   if(replies&&!terminal&&!alreadyFinal&&closed&&publishedReply(item)&&!Object.hasOwn(replies,replyId(t,item))){
    flushProgress();
    this.queuePublishedReply(chat,t,item,cwd);
   }
   if(!cursor||seen.has(item.id))continue;
   const image=toolImagePart(this.config.stateRoot,chat.id,t.id,item),visible=publicProgress(item);
   if(!image&&!(visible&&closed))continue;
   seen.add(item.id);
   if(!alreadyFinal&&(image||item.text.trim())){entries.push(image??item.text);ids.push(item.id);}
  }
  flushProgress();
 }
 async listProjects(){const client=await this.connect(),result=await client.call('list_projects',{},this.config.callerThreadId);if(!Array.isArray(result.projects))throw new Error('Invalid project list');
  return result.projects.filter(p=>p.projectKind==='local'&&p.hostId==='local'&&/^[0-9a-f-]{36}$/.test(p.projectId)&&typeof p.label==='string'&&typeof p.path==='string').map(p=>({projectId:p.projectId,projectKind:'local',hostId:'local',label:p.label,path:p.path}));
 }
 async listChatPage({projectId=null,continuation=null,exclude=[],take=5}={}){if(!Number.isSafeInteger(take)||take<1||take>5)throw new Error('Invalid page size');const client=await this.connect(),sidebar=client.sidebarThreadList===true,rows=[],seen=new Set(exclude),cursors=new Set(continuation?.cursors||[]),deadline=Date.now()+4000;let cursor=continuation?.cursor??null,buffer=[...(continuation?.buffer||[])],finished=continuation?.finished===true,batches=0,scannedRows=0;
  while(rows.length<take){while(buffer.length&&rows.length<take){const c=buffer.shift();if(!seen.has(c.id)){seen.add(c.id);rows.push(c);}}if(rows.length===take||finished)break;
   // Keep sparse-project scans resumable so one click cannot block bot updates.
   if(batches>=2||(batches>0&&Date.now()>=deadline))break;
   const page=await client.call('list_threads',sidebar?{limit:50}:{mode:'history',source:'codex',hostId:'local',archived:false,limit:projectId?50:5,...(cursor?{cursor}:{})},this.config.callerThreadId);if(!Array.isArray(page.threads))throw new Error('Invalid chat page');
   // shortcut: sidebar API exposes only pinned and 50 recent entries; use history pagination when available.
   const threads=sidebar?[...(page.pinnedThreads||[]),...page.threads].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)):page.threads;
   batches++;scannedRows+=threads.length;
   buffer=threads.filter(c=>c.kind==='codex'&&c.hostId==='local'&&/^[0-9a-f-]{36}$/.test(c.id)&&typeof c.title==='string'&&(!projectId||c.projectId===projectId)).map(c=>({id:c.id,title:c.title,projectId:c.projectId??null}));
   cursor=sidebar?null:page.nextCursor??null;finished=!cursor;if(cursor){if(typeof cursor!=='string'||cursors.has(cursor))throw new Error('Invalid chat-list cursor');cursors.add(cursor);}
  }
  return{rows,continuation:buffer.length||!finished?{cursor,buffer,finished,cursors:[...cursors]}:null,scannedRows,sidebarLimited:sidebar};
 }
 async createChat(expected,prompt){const project=(await this.listProjects()).find(p=>p.projectId===expected.projectId&&p.path===expected.path);if(!project||typeof prompt!=='string'||!prompt.trim()||prompt.length>8000)throw new Error('Invalid or changed local project');const client=await this.connect();this.assertLiveEndpoint(client);return client.call('create_thread',{prompt,target:{type:'project',projectId:project.projectId,environment:{type:'local'}}},this.config.callerThreadId);}
 watchChat(chat){if(!/^[0-9a-f-]{36}$/.test(chat.id)||typeof chat.title!=='string'||typeof chat.alias!=='string')throw new Error('Invalid selected chat');if(!this.config.chats.some(c=>c.id===chat.id))this.config.chats.push({...chat});this.state.data.watchedChats=this.config.chats.map(c=>({...c}));this.state.save();this.onWatch?.(this.config.chats.map(c=>c.id));}
 async attach(pipe){
  const valid=this.config.endpointValidator?this.config.endpointValidator(pipe):typeof pipe==='string'&&pipe.startsWith('\\\\.\\pipe\\');
  if(!valid||pipe===this.pipe)return;
  const old=this.client;
  this.client=null;this.connected=false;this.pipe=pipe;
  atomicWrite(this.file,{pipePath:pipe});
  if(old)await old.close();
 }
 async detach(pipe){
  if(!pipe||this.pipe!==pipe)return;
  const old=this.client;
  this.pipe=null;this.client=null;this.connected=false;
  if(old)await old.close();
 }
 async connect(){
  if(this.client)return this.client;
  if(this.opening)return this.opening;
  this.opening=(async()=>{
   if(!this.pipe&&!this.config.requireLiveEndpoint){
    try{this.pipe=JSON.parse(fs.readFileSync(this.file,'utf8')).pipePath;}catch{}
   }
   const endpoint=this.pipe;
   if(!endpoint)throw new Error('Waiting for Codex');
   const client=new McpClient(this.config.appTools,endpoint);
   try{
    await client.initialize();
    if(this.pipe!==endpoint)throw new Error('Codex endpoint changed');
    this.client=client;
    return client;
   }catch(error){await client.close();throw error;}
  })();
  try{return await this.opening;}finally{this.opening=null;}
 }
 assertLiveEndpoint(client){
  if(this.config.requireLiveEndpoint&&(client!==this.client||!this.pipe||!this.config.endpointValidator(this.pipe)))throw new Error('Codex endpoint changed');
 }
 async read(id,turnLimit=1){if(!this.config.chats.some(c=>c.id===id))throw new Error('Unauthorized chat');const c=await this.connect();const r=await c.call('read_thread',{threadId:id,hostId:'local',turnLimit,includeOutputs:false,maxOutputCharsPerItem:20000},this.config.callerThreadId);this.assertLiveEndpoint(c);if(r.thread?.id!==id)throw new Error('Mismatched chat');this.connected=true;return r;}
 async sendText(id,text,{thinking}={}){
  if(thinking!==undefined&&!['low','medium','high','xhigh','max','ultra'].includes(thinking))throw new Error('Invalid effort');
  const primeReplies=!this.state.data.replyCursors[id],r=await this.read(id,primeReplies?4:1);
  if(r.thread.status?.activeFlags?.length)throw new Error('Answer native pending request first');
  const c=await this.connect();
  if(this.state.data.paused)throw Object.assign(new Error('Remote control paused'),{code:'PAUSED'});
  this.assertLiveEndpoint(c);
  if(primeReplies&&!this.state.data.replyCursors[id]){
   this.baselineReplies(id,r.turns??[]);
   this.state.save();
  }
  return c.call('send_message_to_thread',{threadId:id,hostId:'local',prompt:text,...(thinking?{thinking}:{})},this.config.callerThreadId);
 }
 async lastAnswer(id){
  const r=await this.read(id,3);
  for(const turn of r.turns??[]){
   const terminal=terminalTurn(turn);
   const final=turn.items?.findLast((item,index,items)=>finalMessage(item)&&(terminal||index<items.length-1));
   if(final)return final.text;
  }
  return this.t('هنوز پاسخ نهایی کامل‌شده‌ای پیدا نشد.');
 }
 async poll(){try{for(const c of this.config.chats){
  const progressCursor=this.state.data.progressCursors[c.id],priorReplies=this.state.data.replyCursors[c.id];
  const r=await this.read(c.id,4),latest=r.turns?.[0];if(!latest)continue;
  const old=this.state.data.seen[c.id],captured=this.state.data.capturedFinals[c.id]??=[];
  const progress=this.state.data.updatesByThread[c.id]==='progress'&&progressCursor===this.state.data.progressCursors[c.id];
  if(progress&&!progressCursor)this.state.data.progressCursors[c.id]=progressSnapshot(this.config.stateRoot,c.id,r.turns);
  const replies=priorReplies===this.state.data.replyCursors[c.id]?this.baselineReplies(c.id,r.turns):null;
  for(const t of [...r.turns].reverse()){
   this.captureActivity(c,t,r.thread?.cwd,progress?progressCursor:null,replies);
   if(terminalTurn(t)&&!captured.includes(t.id)){
   if(old){
    const items=t.items??[],final=items.findLast(finalMessage);
    const queued=final&&this.state.data.replyCursors[c.id]?.[replyId(t,final)]===true;
    const entries=items.map(i=>i===final?(queued?null:i.text):toolImagePart(this.config.stateRoot,c.id,t.id,i)).filter(Boolean);
    if(!final)entries.push(this.t('نوبت پایان یافت؛ نتیجه را در چت بررسی کن.'));
    if(entries.length||t.status!=='completed')this.queueReply(`${c.id}:${t.id}`,this.t`${c.title}\nوضعیت: ${t.status}`,entries,{threadId:c.id,cwd:r.thread?.cwd,turnId:t.id});
   }captured.push(t.id);
  }}
  if(progress&&progressCursor)this.state.data.progressCursors[c.id]=Object.fromEntries(r.turns.map(t=>[t.id,progressCursor[t.id]||[]]));
  if(replies)this.state.data.replyCursors[c.id]=Object.fromEntries(Object.entries(replies).filter(([id])=>r.turns.some(t=>id.startsWith(t.id+':'))));
  this.state.data.capturedFinals[c.id]=captured.slice(-512);this.state.data.seen[c.id]=`${latest.id}:${latest.status}`;this.state.save();
 }}catch{this.connected=false;const old=this.client;this.client=null;if(old)await old.close();}await this.outbox.flush();}
}
