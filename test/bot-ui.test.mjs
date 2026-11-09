import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Controller} from '../controller.mjs';
import {State} from '../state.mjs';
import {TelegramApi} from '../telegram.mjs';

const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const msg=(id,text,extra={})=>({update_id:id,message:{from:{id:1},chat:{id:1,type:'private'},date:Math.floor(Date.now()/1000),text,...extra}});
const cb=(id,data,messageId,who=1)=>({update_id:id,callback_query:{id:String(id),data,from:{id:who},message:{message_id:messageId,chat:{id:1,type:'private'}}}});
const keys=call=>call.args.reply_markup?.inline_keyboard.flat()||[];
function fixture(){
 const root=path.resolve(import.meta.dirname,'../private/test-bot-ui');fs.mkdirSync(root,{recursive:true});
 const state=new State(path.join(fs.mkdtempSync(path.join(root,'case-')),'state.json'));
 const calls=[],dispatches=[],chats=[{id:A,alias:'this',title:'A <b> & help'},{id:B,alias:'sogeking',title:'B'}];
 const api={call:async(method,args)=>{calls.push({method,args});return{message_id:calls.length};},document:async()=>{}};
 const desktop={listProjects:async()=>[],sendText:async(...args)=>dispatches.push(args),lastAnswer:async id=>'final for '+id};
 const c=new Controller({state,chats,api,desktop,owner:{userId:1,chatId:1},native:{prepare:()=>null,active:new Map()},status:()=> 'Telegram & Codex ready'});
 return{c,state,api,calls,dispatches,last:()=>calls.at(-1)};
}

test('/start and /menu open a grouped dashboard with escaped context, and /help lists commands by group',async()=>{
 const f=fixture();await f.c.update(msg(1,'/start'));
 assert.equal(f.last().args.parse_mode,'HTML');assert.match(f.last().args.text,/A &lt;b&gt; &amp; help/);
 assert.deepEqual(keys(f.last()).map(b=>b.callback_data),['ui:chats','ui:settings','ui:files','ui:control','ui:help']);
 await f.c.update(msg(2,'/menu'));assert.equal(keys(f.last()).length,5);
 await f.c.update(msg(3,'/help'));assert.match(f.last().args.text,/\/threads/);assert.match(f.last().args.text,/\/updates/);assert.match(f.last().args.text,/\/get/);assert.match(f.last().args.text,/\/resume/);
 assert.deepEqual(f.dispatches,[]);
});

test('navigation edits only a dashboard that the bot actually sent',async()=>{
 const f=fixture();await f.c.update(msg(1,'/menu'));
 await f.c.update(cb(2,'ui:settings',1));assert.equal(f.last().method,'editMessageText');assert.equal(f.last().args.message_id,1);
 assert.ok(keys(f.last()).every(b=>Buffer.byteLength(b.callback_data)<=64));
 await f.c.update(cb(3,'ui:home',999));assert.equal(f.last().method,'sendMessage');assert.equal(f.last().args.message_id,undefined);
 const restarted=new Controller({...f.c,state:new State(f.state.file)});
 await restarted.update(cb(4,'ui:chats',1));assert.equal(f.last().method,'editMessageText');
});

test('settings and latest answer buttons keep the displayed chat after a selection change',async()=>{
 const f=fixture();await f.c.update(msg(1,'/menu'));await f.c.update(cb(2,'ui:settings',1));
 const effort=keys(f.last()).find(b=>b.callback_data.startsWith('ui:effort:')).callback_data;
 await f.c.update(cb(3,'ui:chats',1));const last=keys(f.last()).find(b=>b.callback_data.startsWith('ui:last:')).callback_data;
 await f.c.update(msg(4,'/use sogeking'));await f.c.update(cb(5,effort,1));
 const high=keys(f.last()).find(b=>b.text==='high').callback_data;
 await f.c.update(cb(6,high,1));assert.equal(f.state.data.effortByThread[A],'high');assert.equal(f.state.data.effortByThread[B],undefined);
 await f.c.update(cb(7,last,1));assert.ok(f.last().args.text.startsWith('A <b> & help'));assert.ok(f.last().args.text.includes('final for '+A));
});

test('paused dashboard can show status and resume, while commands and native replies cannot dispatch',async()=>{
 const f=fixture();await f.c.update(msg(1,'/menu'));await f.c.update(cb(2,'ui:control',1));await f.c.update(cb(3,'ui:pause',1));
 assert.equal(f.state.data.paused,true);assert.ok(keys(f.last()).some(b=>b.callback_data==='ui:resume'));
 await f.c.update(cb(4,'ui:status',1));assert.match(f.last().args.text,/متوقف/);
 let native=0;f.c.native.prepare=()=>{native++;return{kind:'partial'};};
 await f.c.update(msg(5,'/resume',{reply_to_message:{message_id:50}}));assert.equal(native,0);assert.equal(f.state.data.paused,true);
 await f.c.update(msg(6,'do work'));assert.deepEqual(f.dispatches,[]);
 await f.c.update(cb(7,'ui:resume',1));assert.equal(f.state.data.paused,false);
});

test('foreign callbacks and forged chat IDs are rejected; /menu as a Reply remains a native answer',async()=>{
 const f=fixture();await f.c.update(cb(1,'ui:pause',1,2));assert.equal(f.calls.length,0);assert.equal(f.state.data.paused,undefined);
 await f.c.update(cb(2,'ui:effort:00000000-0000-0000-0000-000000000000',1));assert.equal(f.state.get(2).state,'rejected');
 f.c.native.prepare=()=>({kind:'partial'});await f.c.update(msg(3,'/menu',{reply_to_message:{message_id:50}}));assert.equal(f.state.get(3).payload.kind,'partial');
});

test('scoped Telegram registration uses valid distinct commands and no broad default scope',async()=>{
 const f=fixture();await f.c.ui.registerCommands();const {method,args}=f.last();
 assert.equal(method,'setMyCommands');assert.deepEqual(args.scope,{type:'chat',chat_id:'1'});
 assert.ok(args.commands.some(c=>c.command==='menu'));assert.ok(args.commands.some(c=>c.command==='updates'));
 assert.equal(new Set(args.commands.map(c=>c.command)).size,args.commands.length);
 assert.ok(args.commands.every(c=>/^[a-z_0-9]{1,32}$/.test(c.command)&&c.description.length>0&&c.description.length<=256));
});

test('an edit rejected by Telegram gets a new panel; an ambiguous write or unchanged panel does not',async()=>{
 const f=fixture();await f.c.update(msg(1,'/menu'));const call=f.api.call;
 f.api.call=async(method,args)=>{if(method==='editMessageText')throw Object.assign(Error('rejected'),{telegramCode:400});return call(method,args);};
 await f.c.update(cb(2,'ui:settings',1));assert.equal(f.last().method,'sendMessage');assert.ok(keys(f.last()).some(b=>b.callback_data.startsWith('ui:effort:')));
 f.api.call=async(method,args)=>{if(method==='editMessageText')throw Error('ambiguous');return call(method,args);};
 await assert.rejects(()=>f.c.ui.show('home',1),/ambiguous/);
 const count=f.calls.length;
 f.api.call=async(method,args)=>{if(method==='editMessageText')throw Object.assign(Error('unchanged'),{telegramCode:400,notModified:true});return call(method,args);};
 await f.c.ui.show('home',1);assert.equal(f.calls.length,count);
});

test('legacy projects and setting pickers offer a route to the main menu',async()=>{
 const f=fixture();for(const [id,command] of [[1,'/threads'],[2,'/effort'],[3,'/updates']]){
  await f.c.update(msg(id,command));assert.ok(keys(f.last()).some(b=>b.callback_data==='ui:home'));
 }
});

test('same-named projects have distinguishable choices and retain their paths',async()=>{
 const f=fixture();f.c.desktop.listProjects=async()=>[{projectId:A,label:'Meta',path:'C:/First/Meta'},{projectId:B,label:'Meta',path:'C:/Second/Meta'}];
 await f.c.update(msg(1,'/threads'));
 const projects=keys(f.last()).filter(k=>k.callback_data.startsWith('m:p:'));
 assert.equal(projects.length,2);assert.notEqual(projects[0].text,projects[1].text);
 assert.match(f.last().args.text,/C:\/First\/Meta/);assert.match(f.last().args.text,/C:\/Second\/Meta/);
});

test('Telegram allows scoped menu methods and exposes only sanitized edit rejection metadata',async()=>{
 const token='123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ',requests=[];
 const api=new TelegramApi(token,async(url,options)=>{const method=url.split('/').at(-1);requests.push({method,body:JSON.parse(options.body)});
  return{json:async()=>method==='editMessageText'?{ok:false,error_code:400,description:'Bad Request: message is not modified '+token}:{ok:true,result:[]}};
 });
 await api.call('setMyCommands',{scope:{type:'chat',chat_id:'1'},commands:[]});await api.call('getMyCommands',{scope:{type:'chat',chat_id:'1'}});
 await assert.rejects(()=>api.call('editMessageText',{}),e=>e.telegramCode===400&&e.notModified&&!e.message.includes(token));
 assert.equal(requests.length,3);
});
