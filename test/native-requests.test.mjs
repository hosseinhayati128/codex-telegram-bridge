import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRequests } from '../native-requests.mjs';
const question = (id = 9007199254740993n) => ({ id, method: 'item/tool/requestUserInput', params: {threadId:'chat',turnId:'turn',itemId:'item',isBlocking:true,questions:[{id:'q',header:'آزمون',question:'کدام؟',options:[{label:'اول',description:'یک'},{label:'دوم',description:'دو'}]}]} });
function fixture() { const frames=[], events=[]; const r=new NativeRequests({generation:'g',threads:['chat'],send: m=>frames.push(m),publish: e=>events.push(e),clock:()=>100}); return {r,frames,events}; }
test('exact original question IDs, int64 and one atomic winner', () => {
  const {r,frames,events}=fixture(); r.server(question()); const t=events.at(-1).request;
  assert.throws(()=>r.answer(t.ticket,{kind:'answers',answers:{wrong:'x'}}),/answer/i);
  r.answer(t.ticket,{kind:'answers',answers:{q:'دوم'}});
  assert.equal(frames[0].id,9007199254740993n); assert.deepEqual(frames[0].result,{answers:{q:{answers:['دوم']}}});
  assert.equal(r.desktop({id:9007199254740993n,result:{answers:{q:{answers:['اول']}}}}),false);
  assert.throws(()=>r.answer(t.ticket,{kind:'answers',answers:{q:'اول'}}),/stale/i);
});
test('desktop answer wins; resolved and disconnected callbacks cannot act', () => {
  const {r,events}=fixture(); r.server(question(1)); const t=events.at(-1).request.ticket;
  assert.equal(r.desktop({id:1,result:{}}),true); assert.throws(()=>r.answer(t,{kind:'answers',answers:{q:'x'}}),/stale/i);
  r.server(question(2)); const second=events.at(-1).request.ticket;
  r.server({method:'serverRequest/resolved',params:{threadId:'chat',requestId:2}}); assert.throws(()=>r.answer(second,{}),/stale/i);
  r.server(question(3)); const third=events.at(-1).request.ticket; r.disconnect(); assert.throws(()=>r.answer(third,{}),/stale/i);
});
test('humanCommand never offers session and permission grant cannot expand', () => {
  const {r,events,frames}=fixture(); r.server({id:1,method:'item/commandExecution/requestApproval',params:{threadId:'chat',turnId:'turn',itemId:'c',startedAtMs:1,kind:'humanCommand',command:'echo ok',availableDecisions:['accept','acceptForSession','decline','cancel']}});
  const c=events.at(-1).request; assert.equal(c.actions.some(x=>x.value==='acceptForSession'),false);
  assert.throws(()=>r.answer(c.ticket,{kind:'action',index:99}),/action/i);
  r.server({id:2,method:'item/permissions/requestApproval',params:{threadId:'chat',turnId:'turn',itemId:'p',startedAtMs:1,cwd:'C:/fixture',permissions:{network:{enabled:true}}}});
  const p=events.at(-1).request; r.answer(p.ticket,{kind:'action',index:0,permissions:{fileSystem:{write:['C:/']}}});
  assert.deepEqual(frames[0].result,{permissions:{network:{enabled:true}},scope:'turn'});
});
test('file approval is available only with exact item snapshot, changes invalidate tickets',()=>{
 const {r,events}=fixture(); const req={id:1,method:'item/fileChange/requestApproval',params:{threadId:'chat',turnId:'turn',itemId:'f',startedAtMs:1}};
 r.server(req); assert.equal(events.length,0);
 r.server({method:'item/started',params:{threadId:'chat',turnId:'turn',item:{id:'f',type:'fileChange',changes:[{path:'a',kind:{type:'update'},diff:'-a\n+b'}]}}});
 const first=events.at(-1).request.ticket;
 r.server({method:'item/started',params:{threadId:'chat',turnId:'turn',item:{id:'f',type:'fileChange',changes:[{path:'a',kind:{type:'update'},diff:'-a\n+c'}]}}});
 assert.throws(()=>r.answer(first,{kind:'action',index:0}),/stale/i); assert.notEqual(events.at(-1).request.ticket,first);
});
test('secrets, unknown methods and unrelated chats stay on desktop; reconnect gets fresh tickets',()=>{
 const {r,events}=fixture(); const secret=question(1); secret.params.questions[0].isSecret=true; r.server(secret);
 r.server({...question(2),params:{...question(2).params,threadId:'other'}}); r.server({id:3,method:'account/login',params:{}}); assert.equal(events.filter(e=>e.type==='request').length,0);assert.equal(events.filter(e=>e.type==='desktop-only').length,1);
 r.server(question(4)); const old=events.at(-1).request.ticket; r.reissue(); assert.notEqual(events.at(-1).request.ticket,old); assert.throws(()=>r.answer(old,{}),/stale/i);
});
test('ordinary MCP form validates original bounds, keeps null bounds absent and excludes auth forms',()=>{
 const {r,frames,events}=fixture();r.server({id:1,method:'mcpServer/elicitation/request',params:{threadId:'chat',serverName:'test',mode:'form',message:'Choose a limit',requestedSchema:{type:'object',properties:{limit:{type:'integer',minimum:null,maximum:5}},required:['limit']}}});
 const request=events.at(-1).request;assert.equal(request.kind,'form');assert.throws(()=>r.answer(request.ticket,{kind:'answers',answers:{limit:'6'}}),/range/);r.answer(request.ticket,{kind:'answers',answers:{limit:'-1'}});assert.deepEqual(frames[0].result,{action:'accept',content:{limit:-1}});
});
test('uncertain failed remote send never reopens native request',()=>{
 const events=[]; const r=new NativeRequests({generation:'g',threads:['chat'],publish:e=>events.push(e),send:()=>{throw new Error('broken pipe');}});
 r.server(question(1)); const ticket=events.at(-1).request.ticket; assert.throws(()=>r.answer(ticket,{kind:'answers',answers:{q:'اول'}}),/broken pipe/);
 assert.throws(()=>r.answer(ticket,{kind:'answers',answers:{q:'اول'}}),/stale/i); assert.equal(r.desktop({id:1,result:{}}),false);
});
test('authentication message and secret field description stay on desktop with generic field ID',()=>{
 for(const patch of [{message:'Enter your account password to authenticate',field:{type:'string'}},{message:'Enter value',field:{type:'string',description:'Your secret API token'}}]){const{r,events}=fixture();r.server({id:1,method:'mcpServer/elicitation/request',params:{threadId:'chat',mode:'form',message:patch.message,requestedSchema:{type:'object',properties:{value:patch.field},required:['value']}}});assert.equal(events.some(e=>e.type==='request'),false);}
});
test('unsupported root schema validation is not weakened into an actionable form',()=>{const{r,events}=fixture();r.server({id:1,method:'mcpServer/elicitation/request',params:{threadId:'chat',mode:'form',message:'Choose',requestedSchema:{type:'object',properties:{value:{type:'string'}},not:{properties:{value:{const:'forbidden'}}}}}});assert.equal(events.some(e=>e.type==='request'),false);});
test('terminal bodies are released, late duplicates drop and more than 10000 lifetime requests remain functional',()=>{const{r,events}=fixture();for(let i=1;i<=10020;i++){r.server(question(i));r.desktop({id:i,result:{}});r.server({method:'serverRequest/resolved',params:{threadId:'chat',requestId:i}});}assert.ok(r.requests.size<2);assert.equal(r.desktop({id:10020,result:{}}),false);r.server(question(10021));assert.equal(events.at(-1).type,'request');assert.ok(r.tombstones.size<=10000);});
test('watching a newly selected chat adds future native requests without replacing existing tickets',()=>{const{r,events,frames}=fixture();r.server(question(1));const original=events.at(-1).request.ticket;r.setThreads(['chat','new']);r.server({...question(2),params:{...question(2).params,threadId:'new'}});assert.equal(events.at(-1).request.threadId,'new');r.answer(original,{kind:'answers',answers:{q:'اول'}});assert.equal(frames.length,1);});
