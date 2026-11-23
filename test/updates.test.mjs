import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {State} from '../state.mjs';import {Controller} from '../controller.mjs';import {Desktop} from '../desktop.mjs';
import {McpClient} from '../mcp-client.mjs';
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const msg=(id,text,phase='commentary')=>({id,type:'agentMessage',phase,text});
const turn=(id,items,status='inProgress')=>({id,status,items});
const input=(id,text,extra={})=>({update_id:id,message:{from:{id:1},chat:{id:1,type:'private'},date:Math.floor(Date.now()/1000),text,...extra}});
function fixture(){const root=path.resolve(import.meta.dirname,'../private/test-updates');fs.mkdirSync(root,{recursive:true});const state=new State(path.join(fs.mkdtempSync(path.join(root,'case-')),'state.json')),sent=[],chatMessages=[],chats=[{id:A,title:'A',alias:'this'},{id:B,title:'B',alias:'sogeking'}];let turns=[],offline=false;
 const config={stateRoot:path.dirname(state.file),chats,callerThreadId:A},notify=async(text,meta)=>{if(offline)throw Error('offline');sent.push({text,...meta});},d=new Desktop(config,state,notify);
 d.read=async id=>({thread:{id,cwd:process.cwd()},turns:id===A?turns:[]});
 d.sendText=async(...args)=>chatMessages.push(args);
 const c=new Controller({state,chats,desktop:d,owner:{userId:1,chatId:1},api:{call:async(method,args)=>{chatMessages.push({method,...args});return{message_id:chatMessages.length};}},native:{prepare:()=>null,active:new Map()},status:()=> 'ready'});
 return{state,config,d,c,sent,chatMessages,notify,setTurns:v=>turns=v,setOffline:v=>offline=v};}

test('updates is quiet by default; per-chat progress is saved without model dispatch',async()=>{const f=fixture();await f.c.update(input(1,'/updates progress'));assert.equal(f.state.data.updatesByThread[A],'progress');await f.c.update(input(2,'/use sogeking'));assert.equal(f.state.data.updatesByThread[B],undefined);await f.c.update(input(3,'/updates quiet'));assert.equal(f.state.data.updatesByThread[B],'quiet');assert.equal(new State(f.state.file).data.updatesByThread[A],'progress');assert.ok(f.chatMessages.every(x=>!Array.isArray(x)));await f.c.update(input(4,'/status'));assert.match(f.chatMessages.at(-1).text,/فقط سؤال/);});

test('updates menu freezes the original chat; foreign owner and stale callbacks cannot change it',async()=>{const f=fixture();await f.c.update(input(1,'/updates'));const key=f.chatMessages.at(-1).reply_markup.inline_keyboard.flat().find(b=>b.callback_data.endsWith(':progress')).callback_data;await f.c.update(input(2,'/use sogeking'));const cb=(id,data,who=1)=>({update_id:id,callback_query:{id:String(id),data,from:{id:who},message:{chat:{id:1,type:'private'}}}});await f.c.update(cb(3,key,2));assert.equal(f.state.data.updatesByThread?.[A],undefined);await f.c.update(cb(4,key));assert.equal(f.state.data.updatesByThread[A],'progress');assert.equal(f.state.data.updatesByThread[B],undefined);await f.c.update(cb(5,'u:AAAAAAAAAAAAAAAA:quiet'));assert.equal(f.state.data.updatesByThread[A],'progress');});

test('slash commands in replies remain owned by native requests',async()=>{const f=fixture();f.c.native.prepare=()=>({kind:'partial'});await f.c.update(input(1,'/updates progress',{reply_to_message:{message_id:12}}));assert.equal(f.state.get(1).payload.kind,'partial');assert.equal(f.state.data.updatesByThread?.[A],undefined);});

test('enable baselines history and batches only completed public progress in order',async()=>{const f=fixture();f.setTurns([turn('old',[msg('old-message','past')])]);await f.d.configureUpdates(A,'progress');f.setTurns([turn('new',[{id:'secret',type:'reasoning',text:'PRIVATE'},{id:'cmd',type:'commandExecution',text:'INTERNAL CODE'},msg('unknown','UNKNOWN',null),msg('one','first visible'),msg('two','second visible','partial_answer'),{id:'tool',type:'mcpToolCall',text:'TOOL OUTPUT'},msg('final','not done','final_answer')]),turn('old',[msg('old-message','past')])]);await f.d.poll();await f.d.poll();assert.equal(f.sent.length,1);assert.ok(f.sent[0].text.indexOf('first visible')<f.sent[0].text.indexOf('second visible'));for(const secret of ['PRIVATE','INTERNAL CODE','UNKNOWN','TOOL OUTPUT','not done','past'])assert.ok(!f.sent[0].text.includes(secret));assert.equal(f.sent[0].kind,'progress');assert.equal(f.sent[0].threadId,A);});

test('unfinished last commentary waits for its following item; streamed prefixes are not repeated',async()=>{const f=fixture();await f.d.configureUpdates(A,'progress');f.setTurns([turn('new',[msg('one','part')])]);await f.d.poll();assert.equal(f.sent.length,0);f.setTurns([turn('new',[msg('one','complete public message'),{type:'commandExecution',id:'cmd'}])]);await f.d.poll();await f.d.poll();assert.equal(f.sent.length,1);assert.match(f.sent[0].text,/complete public message/);});

test('progress precedes the terminal final and terminal last commentary is delivered once',async()=>{const f=fixture();f.state.data.seen[A]='before';await f.d.configureUpdates(A,'progress');f.setTurns([turn('new',[msg('one','progress'),msg('done','whole final','final_answer')],'completed')]);await f.d.poll();await f.d.poll();assert.equal(f.sent.length,2);assert.equal(f.sent[0].kind,'progress');assert.match(f.sent[1].text,/whole final/);f.setTurns([turn('interrupted',[msg('last','last visible')],'interrupted')]);await f.d.poll();assert.ok(f.sent.some(s=>s.text.includes('last visible')));});

test('restart retries captured progress without duplicates; quiet cancels only unsent progress',async()=>{const f=fixture();f.state.data.seen[A]='before';await f.d.configureUpdates(A,'progress');f.setOffline(true);f.setTurns([turn('new',[msg('one','progress'),msg('done','final','final_answer')],'completed')]);await f.d.poll();assert.equal(Object.keys(f.state.data.notifications).length,2);const recovered=new State(f.state.file),d=new Desktop(f.config,recovered,f.notify);d.read=f.d.read;f.setOffline(false);await d.poll();await d.poll();assert.equal(f.sent.length,2);f.setOffline(true);f.setTurns([turn('another',[msg('two','next progress'),msg('done2','next final','final_answer')],'completed')]);await d.poll();await d.configureUpdates(A,'quiet');assert.equal(Object.values(recovered.data.notifications).filter(n=>n.kind==='progress').length,0);f.setOffline(false);await d.poll();assert.equal(f.sent.length,3);assert.match(f.sent.at(-1).text,/next final/);});

test('legacy saved progress preference without cursor primes rather than dumping past messages',async()=>{const f=fixture();f.state.data.updatesByThread={ [A]:'progress' };f.setTurns([turn('old',[msg('past','past'),{type:'commandExecution'}])]);await f.d.poll();assert.equal(f.sent.length,0);f.setTurns([turn('new',[msg('future','future'),{type:'commandExecution'}])]);await f.d.poll();assert.equal(f.sent.length,1);});

test('desktop message reads use the actual adapter maximum of 20000 characters',async()=>{const f=fixture(),d=new Desktop(f.config,f.state,async()=>{});let args;d.connect=async()=>({call:async(name,a)=>{args=a;return{thread:{id:A},turns:[]};}});await d.read(A);assert.equal(args.includeOutputs,false);assert.equal(args.maxOutputCharsPerItem,20000);});

test('an oversized history read retries fewer turns without replaying omitted messages later',async()=>{
 const f=fixture(),d=new Desktop(f.config,f.state,f.notify);
 const client=Object.create(McpClient.prototype);
 const closed={type:'reasoning',id:'closed'};
 const older=turn('older',[msg('old-progress','old progress'),msg('old-reply','old reply','final_answer'),closed]);
 const turns=[turn('current',[]),turn('second',[]),turn('third',[]),older];
 let oversized=false;
 const limits=[];
 client.request=async(_method,{arguments:{threadId,turnLimit}})=>{
  if(threadId===A)limits.push(turnLimit);
  if(threadId===A&&oversized&&turnLimit===4)return{isError:true,content:[{type:'text',text:'The response exceeds the size limit.'}]};
  return{content:[{type:'text',text:JSON.stringify({thread:{id:threadId},turns:threadId===A?turns.slice(0,turnLimit):[]})}]};
 };
 d.connect=async()=>client;
 await d.configureUpdates(A,'progress');
 await d.poll();
 limits.length=0;
 oversized=true;
 turns[0].items.push(msg('answer','new reply','final_answer'),closed);
 await d.poll();
 assert.deepEqual(limits,[4,3]);
 assert.equal(d.connected,true);
 assert.deepEqual(f.sent.map(s=>s.text.split('\n').at(-1)),['new reply']);
 oversized=false;
 await d.poll();
 assert.deepEqual(f.sent.map(s=>s.text.split('\n').at(-1)),['new reply']);
});

test('an oversized single turn retries without tool previews and keeps its public reply',async()=>{
 const f=fixture(),d=new Desktop(f.config,f.state,f.notify),client=Object.create(McpClient.prototype),reads=[];
 client.request=async(_method,{arguments:args})=>{
  reads.push([args.turnLimit,args.maxOutputCharsPerItem]);
  if(args.maxOutputCharsPerItem)return{isError:true,content:[{type:'text',text:'The response exceeds the size limit.'}]};
  return{content:[{type:'text',text:JSON.stringify({thread:{id:A},turns:[turn('large',[msg('reply','complete public reply','final_answer')],'completed')]})}]};
 };
 d.connect=async()=>client;
 const result=await d.read(A,4);
 assert.deepEqual(reads,[[4,20000],[3,20000],[2,20000],[1,20000],[1,0]]);
 assert.equal(result.turns[0].items[0].text,'complete public reply');
 assert.equal(result.reducedTurnWindow,true);
});

test('an oversized watched chat cannot cancel an in-flight Recent Chats request',async()=>{
 const f=fixture(),d=new Desktop(f.config,f.state,f.notify),client=Object.create(McpClient.prototype);
 let finishMenu,readStarted,menuStarted,releaseRead,closed=false;
 const reading=new Promise(resolve=>readStarted=resolve),menuReading=new Promise(resolve=>menuStarted=resolve),readGate=new Promise(resolve=>releaseRead=resolve);
 client.request=async(_method,{name,arguments:args})=>{
  if(name==='list_threads'){
   menuStarted();
   await new Promise(resolve=>finishMenu=resolve);
   if(closed)throw new Error('Codex App Tools unavailable');
   return{content:[{type:'text',text:JSON.stringify({threads:[{id:A,title:'Recent chat',kind:'codex',hostId:'local'}]})}]};
  }
  if(args.threadId===A){
   readStarted();
   await readGate;
   return{isError:true,content:[{type:'text',text:'The response exceeds the size limit.'}]};
  }
  return{content:[{type:'text',text:JSON.stringify({thread:{id:B},turns:[]})}]};
 };
 client.close=async()=>{closed=true;};
 d.client=client;
 const polling=d.poll();
 await reading;
 const menu=d.listChatPage();
 await menuReading;
 releaseRead();
 await polling;
 finishMenu();
 assert.deepEqual((await menu).rows,[{id:A,title:'Recent chat',projectId:null}]);
 assert.equal(d.connected,true);
});

test('enabling while an older poll is in flight cannot replay progress from that stale snapshot',async()=>{const f=fixture();let release,calls=0;f.d.read=async id=>({thread:{id},turns:id!==A?[]:++calls===1?await new Promise(r=>release=r):[turn('current',[msg('baseline','baseline'),{type:'commandExecution'}])]});const polling=f.d.poll();await f.d.configureUpdates(A,'progress');release([turn('stale',[msg('before','before enabling'),{type:'commandExecution'}])]);await polling;assert.equal(f.sent.filter(s=>s.kind==='progress').length,0);});

test('crash at outbox persistence atomically retains captured IDs even when the next snapshot adds a message',async()=>{const f=fixture();await f.d.configureUpdates(A,'progress');let crash;const save=f.state.save.bind(f.state);f.state.save=()=>{save();if(!crash&&Object.values(f.state.data.notifications).some(n=>n.kind==='progress'))crash=fs.readFileSync(f.state.file);};f.setTurns([turn('new',[msg('one','FIRST'),msg('two','SECOND'),{type:'commandExecution'}])]);await f.d.poll();assert.ok(crash);f.sent.length=0;fs.writeFileSync(f.state.file,crash);const recovered=new State(f.state.file),d=new Desktop(f.config,recovered,f.notify);d.read=f.d.read;f.setTurns([turn('new',[msg('one','FIRST'),msg('two','SECOND'),msg('three','THIRD'),{type:'commandExecution'}])]);await d.poll();assert.equal(f.sent.length,2);assert.equal(f.sent.filter(s=>s.text.includes('FIRST')).length,1);assert.equal(f.sent.filter(s=>s.text.includes('SECOND')).length,1);assert.match(f.sent[1].text,/THIRD/);});

test('several terminal turns retain progress then final chronology across reconnect',async()=>{const f=fixture();f.state.data.seen[A]='before';await f.d.configureUpdates(A,'progress');f.setTurns([turn('two',[msg('p2','p2'),msg('f2','f2','final_answer')],'completed'),turn('one',[msg('p1','p1'),msg('f1','f1','final_answer')],'completed')]);await f.d.poll();assert.deepEqual(f.sent.map(s=>s.text.split('\n').at(-1)),['p1','f1','p2','f2']);});

test('a published reply in an open turn is delivered once in order',async()=>{
 const f=fixture(),reasoning={id:'private',type:'reasoning',text:'private reasoning'};
 const history=[msg('prior','old reply','final_answer'),reasoning];
 f.setTurns([turn('open',history)]);
 await f.d.configureUpdates(A,'progress');
 await f.d.poll();
 const before=msg('before','first progress');
 f.setTurns([turn('open',[...history,before,msg('live','draft','final_answer')])]);
 await f.d.poll();
 assert.deepEqual(f.sent.map(s=>s.text.split('\n').at(-1)),['first progress']);
 const items=[...history,before,msg('live','new reply','final_answer'),msg('after','later progress'),reasoning];
 f.setTurns([turn('open',items)]);
 await f.d.poll();
 assert.deepEqual(f.sent.map(s=>s.text.split('\n').at(-1)),['first progress','new reply','later progress']);
 assert.equal(await f.d.lastAnswer(A),'new reply');
 const restarted=new Desktop(f.config,new State(f.state.file),f.notify);
 restarted.read=f.d.read;
 f.setTurns([turn('open',items,'completed')]);
 await restarted.poll();
 assert.equal(f.sent.length,3);
});

test('quiet mode keeps an open-turn reply queued across restart',async()=>{
 const f=fixture(),reasoning={id:'private',type:'reasoning'};
 f.setTurns([turn('open',[])]);
 await f.d.configureUpdates(A,'progress');
 await f.d.poll();
 f.setOffline(true);
 f.setTurns([turn('open',[msg('p','progress'),msg('f','published reply','final_answer'),reasoning])]);
 await f.d.poll();
 await f.d.configureUpdates(A,'quiet');
 const restarted=new Desktop(f.config,new State(f.state.file),f.notify);
 restarted.read=f.d.read;
 f.setOffline(false);
 await restarted.poll();
 await restarted.poll();
 assert.deepEqual(f.sent.map(s=>s.text.split('\n').at(-1)),['published reply']);
});

test('the first dispatch baselines old replies before a new answer can appear',async()=>{
 const f=fixture(),reasoning={id:'private',type:'reasoning'};
 const history=[msg('old','old reply','final_answer'),reasoning];
 f.setTurns([turn('open',history)]);
 f.d.connect=async()=>({call:async()=>f.setTurns([turn('open',[...history,msg('new','first reply','final_answer'),reasoning])])});
 await Desktop.prototype.sendText.call(f.d,A,'hello');
 await f.d.poll();
 assert.deepEqual(f.sent.map(s=>s.text.split('\n').at(-1)),['first reply']);
});
