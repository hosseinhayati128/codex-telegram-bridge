import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Attachments} from '../attachments.mjs';
import {Desktop} from '../desktop.mjs';
import {saveToolImages} from '../images.mjs';
import {State} from '../state.mjs';
import {TelegramApi} from '../telegram.mjs';

const threadId='10000000-0000-4000-8000-000000000001';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/CFsAAAAASUVORK5CYII=','base64');
const reply=(text,id='final',phase='final_answer')=>({id,type:'agentMessage',phase,text});

function fixture(t,{rejectPhoto=false,rejectDocument=false,failFirstUpload=false}={}){
 const base=path.resolve(import.meta.dirname,'../private/test-image-forwarding');
 fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(base,'case-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const cwd=path.join(root,'workspace'),stateRoot=path.join(root,'bridge'),stateFile=path.join(stateRoot,'private','state.json');
 fs.mkdirSync(cwd);
 const file=path.join(cwd,'a screenshot (1).png');
 fs.writeFileSync(file,png);
 const config={stateRoot,transferRoot:path.join(root,'transfer'),codexHome:path.join(root,'codex'),chats:[{id:threadId,title:'Image test',alias:'this'}]};
 const requests=[];
 const api=new TelegramApi('123456:abcdefghijklmnopqrstuvwxyz',async(url,{body})=>{
  const method=new URL(url).pathname.split('/').at(-1);
  const media=typeof body==='string'?null:body.get(method==='sendPhoto'?'photo':'document');
  const entry={method,body:media?{name:media.name,chat:body.get('chat_id'),data:Buffer.from(await media.arrayBuffer())}:JSON.parse(body)};
  if(media&&failFirstUpload){failFirstUpload=false;throw new Error('Offline before upload');}
  if(rejectPhoto&&method==='sendPhoto')return new Response('Invalid dimensions',{status:400});
  if(rejectDocument&&method==='sendDocument')return new Response('Too large',{status:413});
  requests.push(entry);
  return Response.json({ok:true,result:{message_id:requests.length}});
 });
 const snapshot={thread:{id:threadId,cwd},turns:[]};
 const start=()=>{const state=new State(stateFile),files=new Attachments({config,state,api,chatId:'42'});
  const desktop=new Desktop(config,state,(text,meta)=>files.notify(text,meta),(ref,meta)=>files.pinImage(ref,meta));
  desktop.read=async()=>snapshot;
  return {desktop,state};
 };
 const initial=start();
 initial.state.data.seen[threadId]='baseline:completed';
 initial.state.save();
 return {root,cwd,file,stateRoot,stateFile,requests,start,snapshot,...initial};
}

test('connected chat forwards a tool screenshot and its Markdown duplicate once, in turn order',async t=>{
 const f=fixture(t);
 f.snapshot.turns=[{id:'new',status:'completed',items:[
  {type:'imageView',id:'view',path:f.file},
  reply(`before ![Screenshot](<${f.file}>) after`),
 ]}];
 await f.desktop.poll();
 await f.start().desktop.poll();
 assert.deepEqual(f.requests.map(r=>r.method),['sendMessage','sendPhoto','sendMessage','sendMessage']);
 assert.deepEqual(f.requests[1].body,{name:path.basename(f.file),chat:'42',data:png});
 assert.match(f.requests[2].body.text,/^before/);
 assert.match(f.requests[3].body.text,/after$/);
});

test('Markdown preserves surrounding text and falls back to a byte-exact document after photo rejection',async t=>{
 const f=fixture(t,{rejectPhoto:true});
 f.snapshot.turns=[{id:'new',status:'completed',items:[reply(`before\n\n![Screen](<${f.file}>)\n\nafter`)]}];
 await f.desktop.poll();
 assert.deepEqual(f.requests.map(r=>r.method),['sendMessage','sendDocument','sendMessage']);
 assert.match(f.requests[0].body.text,/before$/);
 assert.deepEqual(f.requests[1].body.data,png);
 assert.equal(f.requests[2].body.text,'after');
});

test('the live MCP image result is scoped to the watched thread and deduplicated across progress, final, and restart',async t=>{
 const f=fixture(t),base64=png.toString('base64'),watch=new Set([threadId]);
 const item={id:'mcp',type:'mcpToolCall',status:'completed',result:{content:[
  {type:'text',text:'PRIVATE TOOL TEXT'},
  {type:'image',mimeType:'image/png',data:base64},
 ]}};
 const event={method:'item/completed',params:{threadId,turnId:'new',item}};
 saveToolImages(f.stateRoot,{...event,params:{...event.params,threadId:'unwatched'}},watch);
 assert.equal(fs.existsSync(path.join(f.stateRoot,'private','tool-images')),false);
 saveToolImages(f.stateRoot,event,watch);
 await f.desktop.configureUpdates(threadId,'progress');
 const tool={type:'mcpToolCall',id:'mcp',status:'completed'};
 f.snapshot.turns=[{id:'new',status:'inProgress',items:[reply('First update','before','commentary'),tool]}];
 await f.desktop.poll();
 const recovered=f.start();
 f.snapshot.turns=[{id:'new',status:'completed',items:[reply('First update','before','commentary'),tool,
  reply('Second update','after','commentary'),reply('![same]('+f.file+') Final text'),
 ]}];
 await recovered.desktop.poll();
 assert.deepEqual(f.requests.map(r=>r.method),['sendMessage','sendPhoto','sendMessage','sendMessage','sendMessage']);
 assert.match(f.requests[0].body.text,/First update$/);
 assert.deepEqual(f.requests[1].body.data,png);
 assert.match(f.requests[2].body.text,/Second update$/);
 assert.equal(f.requests.at(-1).body.text,'Final text');
 assert.ok(!JSON.stringify(f.requests).includes('PRIVATE TOOL TEXT'));
 assert.ok(!fs.readFileSync(f.stateFile,'utf8').includes(base64));
});

test('a blocked or non-image path, code example, and remote URL never become an automatic upload',async t=>{
 const f=fixture(t),outside=path.join(f.root,'outside.png'),fake=path.join(f.cwd,'fake.png');
 fs.writeFileSync(outside,png);fs.writeFileSync(fake,'not an image');
 f.snapshot.turns=[{id:'new',status:'completed',items:[
  {type:'userMessage',id:'input',content:[{type:'localImage',path:f.file}]},
  {type:'imageView',id:'outside',path:outside},
  reply('Outside ![bad](<'+outside+'>) ![fake](<'+fake+'>) ![remote](https://example.com/test.png)\n\n'+
   '\x60\x60\x60\x60md\n\x60\x60\x60\n![nested code](<'+f.file+'>)\n\x60\x60\x60\x60\n\n'+
   '    ![indented code](<'+f.file+'>)\n\n\x60\x60 \x60 ![inline code](<'+f.file+'>) \x60\x60\n'+
   '- \x60\x60\x60md\n  ![list code](<'+f.file+'>)\n  \x60\x60\x60\x60\n\n<!-- ![comment](<'+f.file+'>) -->\nEnd'),
 ]}];
 await f.desktop.poll();
 assert.ok(f.requests.every(r=>r.method==='sendMessage'));
 assert.match(f.requests.at(-1).body.text,/End$/);
});

test('another chat’s visualization and inbox cannot be uploaded even inside a broad working directory',async t=>{
 const f=fixture(t),other='10000000-0000-4000-8000-000000000002';
 const folders=[path.join(f.root,'codex','visualizations','2026','11','10',other),path.join(f.root,'transfer','incoming',other)];
 const paths=folders.map(folder=>{
  fs.mkdirSync(folder,{recursive:true});
  const file=path.join(folder,'private.png');fs.writeFileSync(file,png);return file;
 });
 f.snapshot.thread.cwd=f.root;
 f.snapshot.turns=[{id:'new',status:'completed',items:[reply(paths.map(p=>'![Other chat](<'+p+'>)').join('\n'))]}];
 await f.desktop.poll();
 assert.ok(f.requests.length>0&&f.requests.every(r=>r.method==='sendMessage'));
});

test('oversize photo dimensions select a document and an upload retry resumes after already delivered text',async t=>{
 const f=fixture(t,{failFirstUpload:true}),wide=Buffer.from(png);
 wide.writeUInt32BE(10001,16);
 fs.writeFileSync(f.file,wide);
 f.snapshot.turns=[{id:'new',status:'completed',items:[reply('before ![wide](<'+f.file+'>) after')]}];
 await f.desktop.poll();
 assert.equal(f.requests.length,1);
 await f.start().desktop.poll();
 assert.deepEqual(f.requests.map(r=>r.method),['sendMessage','sendDocument','sendMessage']);
 assert.deepEqual(f.requests[1].body.data,wide);
 assert.equal(f.requests[2].body.text,'after');
});

test('explicit rejection of both media methods does not block later text',async t=>{
 const f=fixture(t,{rejectPhoto:true,rejectDocument:true});
 f.snapshot.turns=[{id:'new',status:'completed',items:[reply('before ![image](<'+f.file+'>) after')]}];
 await f.desktop.poll();
 assert.deepEqual(f.requests.map(r=>r.method),['sendMessage','sendMessage','sendMessage']);
 assert.equal(f.requests[2].body.text,'after');
 assert.equal(Object.keys(f.state.data.notifications).length,0);
});

test('an upload retry never sends newer bytes from an overwritten screenshot path',async t=>{
 const f=fixture(t,{failFirstUpload:true});
 f.snapshot.turns=[{id:'new',status:'completed',items:[reply('before ![image](<'+f.file+'>) after')]}];
 await f.desktop.poll();
 assert.equal(f.requests.length,1);
 fs.writeFileSync(f.file,Buffer.concat([png,Buffer.from([0])]));
 await f.start().desktop.poll();
 assert.ok(f.requests.every(r=>r.method==='sendMessage'));
 assert.equal(f.requests.at(-1).body.text,'after');
});
