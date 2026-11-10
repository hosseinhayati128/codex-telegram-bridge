import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Attachments} from '../attachments.mjs';
import {Controller} from '../controller.mjs';
import {Desktop} from '../desktop.mjs';
import {State} from '../state.mjs';
import {formatCodexText} from '../telegram-format.mjs';

const id='10000000-0000-4000-8000-000000000001';
const title='Design stopwatch overlay 🔧';
const link='https://example.com/commit/adc94a7?view=full&lang=fa';
const citation=file=>':codex-file-citation{path='+JSON.stringify(file)+' purpose="output"}';
const entityText=(message,entity)=>message.text.slice(entity.offset,entity.offset+entity.length);

function fixture(t,api){
 const base=path.resolve(import.meta.dirname,'../private/test-telegram-format');
 fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(base,'case-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const cwd=path.join(root,'workspace'),stateRoot=path.join(root,'bridge');
 fs.mkdirSync(cwd);
 const state=new State(path.join(stateRoot,'private','state.json'));
 const config={stateRoot,codexHome:path.join(root,'codex'),transferRoot:path.join(root,'transfers'),chats:[{id,title,alias:'this'}]};
 const sent=[];
 api??={
  call:async(method,args)=>{sent.push({method,args});return {message_id:sent.length};},
  document:async(chatId,text,name)=>sent.push({method:'sendDocument',args:{chatId,text,name}}),
 };
 const files=new Attachments({config,state,api,chatId:'42'});
 return {root,cwd,state,config,sent,files};
}

test('Codex reply renders native Telegram entities and a scoped file-citation button',async t=>{
 const f=fixture(t),report=path.join(f.cwd,'گزارش بررسی (v2).xlsx'),example=path.join(f.cwd,'example.txt');
 fs.writeFileSync(report,'fixture');fs.writeFileSync(example,'fixture');
 const body=[
  'Pushed to \x60main\x60: [adc94a7 — project selection]('+link+').',
  '',
  '**از بررسی \x60runc\x60 شروع می‌کنیم.**',
  '',
  '\x60\x60\x60bash',
  'hostname',
  'docker version',
  citation(example),
  '\x60\x60\x60',
  '',
  '- نسخه را بررسی کن.',
  '',
  citation(report),
  citation('/home/h128/Documents/reports/sokan-shaparak-audit-checklist.xlsx'),
 ].join('\n');
 const d=new Desktop(f.config,f.state,(text,meta)=>f.files.notify(text,meta));
 d.read=async()=>({thread:{id,cwd:f.cwd},turns:[{id:'new',status:'completed',items:[{id:'reply',type:'agentMessage',phase:'final_answer',text:body}]}]});
 f.state.data.seen[id]='old:completed';
 await d.poll();
 assert.equal(f.sent.length,1);
 const {method,args}=f.sent[0],entities=args.entities;
 assert.equal(method,'sendMessage');
 assert.match(args.text,/وضعیت: انجام شد/);
 assert.ok(!args.text.includes('**')&&!args.text.includes('\x60'));
 assert.ok(args.text.includes('• نسخه را بررسی کن.'));
 assert.ok(entities.some(e=>e.type==='bold'&&entityText(args,e)===title));
 assert.ok(entities.some(e=>e.type==='code'&&entityText(args,e)==='runc'));
 const pre=entities.find(e=>e.type==='pre');
 assert.equal(pre.language,'bash');
 assert.equal(entityText(args,pre),'hostname\ndocker version\n'+citation(example));
 const web=entities.find(e=>e.type==='text_link');
 assert.equal(entityText(args,web),'adc94a7 — project selection');
 assert.equal(web.url,link);
 assert.ok(args.text.includes('📎 گزارش بررسی (v2).xlsx'));
 assert.ok(args.text.includes('📎 sokan-shaparak-audit-checklist.xlsx'));
 assert.ok(!args.text.includes(citation(report)));
 assert.equal(args.link_preview_options.is_disabled,true);
 const buttons=args.reply_markup.inline_keyboard;
 assert.deepEqual(buttons.map(row=>row[0].text),['📎 گزارش بررسی (v2).xlsx']);
 assert.match(buttons[0][0].callback_data,/^file:/);
});

test('formatting rejection falls back once to readable text and leaves unsafe targets inert',async t=>{
 const calls=[];
 const f=fixture(t,{call:async(method,args)=>{
  calls.push({method,args});
  if(args.entities)throw Object.assign(new Error('Telegram rejected formatting'),{telegramCode:400});
  return {message_id:1};
 }});
 await f.files.notify('**سلام** [official]('+link+') [unsafe](javascript:alert(1))',{threadId:id,cwd:f.cwd});
 assert.equal(calls.length,2);
 assert.ok(calls[0].args.entities.some(e=>e.type==='bold'));
 assert.deepEqual(calls[0].args.entities.filter(e=>e.type==='text_link').map(e=>e.url),[link]);
 assert.equal(calls[1].args.text,'سلام official ('+link+') unsafe');
 assert.equal(calls[1].args.entities,undefined);
});

test('oversize replies use the existing document delivery with readable links and citations',async t=>{
 const f=fixture(t);
 await f.files.notify('**سلام** [reference]('+link+')\n'+citation('/home/h128/reports/report.xlsx')+'\n'+'x'.repeat(4100),{threadId:id,cwd:f.cwd});
 assert.deepEqual(f.sent.map(r=>r.method),['sendDocument','sendMessage']);
 assert.ok(f.sent[0].args.text.startsWith('سلام reference ('+link+')\n📎 report.xlsx'));
 assert.ok(!f.sent[1].args.entities);
});

test('file citations in another chat’s artifacts stay readable without offering a download',async t=>{
 const f=fixture(t),other='10000000-0000-4000-8000-000000000002';
 const folder=path.join(f.config.codexHome,'visualizations','2026','11','10',other);
 fs.mkdirSync(folder,{recursive:true});
 const file=path.join(folder,'other-report.xlsx');
 fs.writeFileSync(file,'fixture');
 await f.files.notify(citation(file),{threadId:id,cwd:f.root});
 assert.equal(f.sent[0].args.text,'📎 other-report.xlsx');
 assert.equal(f.sent[0].args.reply_markup,undefined);
 assert.deepEqual(f.state.data.downloads,{});
});

test('/last reuses the formatter and keeps the menu button',async t=>{
 const f=fixture(t),c=new Controller({
  state:f.state,chats:f.config.chats,api:f.files.api,owner:{userId:42,chatId:42},
  desktop:{lastAnswer:async()=>'[Release]('+link+')'},
  native:{prepare:()=>null,active:new Map()},
 });
 await c.update({update_id:1,message:{from:{id:42},chat:{id:42,type:'private'},text:'/last'}});
 const {args}=f.sent.at(-1);
 assert.equal(args.text,title+'\n\nRelease');
 assert.ok(args.entities.some(e=>e.type==='text_link'&&e.url===link));
 assert.equal(args.reply_markup.inline_keyboard.length,1);
});

test('link labels render emphasis with ordered entity offsets and incomplete Markdown stays readable',()=>{
 const message=formatCodexText('🧪 **[ **Release** ]('+link+')**\n'+'['.repeat(20000));
 const web=message.entities.find(e=>e.type==='text_link'),bold=message.entities.find(e=>e.type==='bold');
 assert.equal(entityText(message,web),' Release ');
 assert.equal(entityText(message,bold),'Release');
 assert.ok(web.offset<bold.offset);
 assert.equal(message.entities[0],web);
 assert.ok(message.text.endsWith('['.repeat(20000)));
 assert.ok(formatCodexText('x'.repeat(17000)+' \\<!--\n**after**').text.endsWith('\nafter'));
});

test('local file URLs still get a single button and a skipped image keeps its original path',async t=>{
 const f=fixture(t),file=path.join(f.cwd,'report v2.txt'),url=pathToFileURL(file);
 fs.writeFileSync(file,'fixture');
 await f.files.notify('[report](file:'+url.pathname+') [same](file://localhost'+url.pathname+')',{threadId:id,cwd:f.cwd});
 assert.equal(f.sent[0].args.reply_markup.inline_keyboard.length,1);
 await f.files.notify('![Screenshot](<'+file+'>)',{threadId:id,cwd:f.cwd,image:{path:file,file:null},turnId:'new'});
 assert.equal(f.sent[1].args.text,'Screenshot\n'+file);
 assert.equal(f.sent[1].args.reply_markup,undefined);
});
