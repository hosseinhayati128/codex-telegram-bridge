import { randomBytes } from 'node:crypto';
import { cloneWire, fingerprint, idKey } from './wire.mjs';

const COMMAND='item/commandExecution/requestApproval', FILE='item/fileChange/requestApproval';
const USER='item/tool/requestUserInput', PERMISSIONS='item/permissions/requestApproval', MCP='mcpServer/elicitation/request';
const own=(o,k)=>Object.hasOwn(o,k);
const itemKey=p=>[p.threadId,p.turnId,p.itemId??p.item?.id].join('\0');
const secretContext=/password|secret|token|credential|verification|authoriz|authenticat|\blog[ -]?in\b|\bsign[ -]?in\b|\botp\b|گذرواژه|احراز|توکن|رمز عبور|کد.{0,12}ت[أا]یید/i;
function formQuestions(schema) {
  if (!schema || schema.type!=='object' || !schema.properties || schema.additionalProperties===true) return null;
  if(Object.keys(schema).some(k=>!['type','properties','required','additionalProperties','$schema','title','description'].includes(k)))return null;
  if(schema.required&&(!Array.isArray(schema.required)||schema.required.some(k=>!Object.hasOwn(schema.properties,k))))return null;
  if (Object.keys(schema.properties).length>12) return null;
  const required=new Set(schema.required||[]), questions=[];
  for(const [id,s] of Object.entries(schema.properties)) {
    if (secretContext.test(id+' '+(s.title||'')+' '+(s.description||'')+' '+(s.format||'')) || !['string','boolean','number','integer'].includes(s.type)) return null;
    // Unsupported validation remains on the original desktop, never silently weakened.
    if (Object.keys(s).some(k=>!['type','title','description','enum','enumNames','default','minimum','maximum','minLength','maxLength'].includes(k))) return null;
    if(s.enum && (!Array.isArray(s.enum)||s.enum.some(v=>typeof v==='object')))return null;
    questions.push({id,question:s.title||id,description:s.description||'',required:required.has(id),schema:cloneWire(s),options:s.enum?.map(v=>({label:String(v),description:''}))||(s.type==='boolean'?[{label:'true',description:''},{label:'false',description:''}]:null)});
  }
  return questions.length?questions:null;
}
function describe(message,snapshot) {
  const {method,params:p}=message;
  if(method===USER) {
    if(!p.questions?.length||p.questions.length>12||p.questions.some(q=>q.isSecret||typeof q.id!=='string'||typeof q.question!=='string'))return null;
    if(new Set(p.questions.map(q=>q.id)).size!==p.questions.length)return null;
    return {kind:'questions',questions:cloneWire(p.questions),details:{method,params:p},actions:[]};
  }
  if(method===COMMAND) {
    if(!p.command || typeof p.command!=='string')return null;
    const allowed=p.availableDecisions||['accept','decline','cancel'];
    const actions=[['accept','تأیید همین درخواست'],['decline','رد'],['cancel','لغو']].filter(([v])=>allowed.includes(v)).map(([value,label])=>({value,label}));
    return actions.length?{kind:'approval',actions,details:{method,params:p}}:null;
  }
  if(method===FILE) {
    if(!snapshot?.changes?.length)return null;
    return {kind:'approval',actions:[{value:'accept',label:'تأیید تغییرات نمایش‌داده‌شده'},{value:'decline',label:'رد'},{value:'cancel',label:'لغو'}],details:{method,params:p,fileChange:snapshot}};
  }
  if(method===PERMISSIONS) {
    if(!p.permissions||Object.keys(p.permissions).some(k=>!['network','fileSystem'].includes(k)))return null;
    return {kind:'permissions',actions:[{value:'grant',label:'اعطای همین مجوزها برای این نوبت'},{value:'deny',label:'رد مجوزها'}],details:{method,params:p}};
  }
  if(method===MCP) {
    if(!['form','openai/form','openaiForm'].includes(p.mode))return null;
    if(secretContext.test((p.message||'')+' '+(p.requestedSchema?.title||'')+' '+(p.requestedSchema?.description||'')+' '+JSON.stringify(p._meta||{})))return null;
    const questions=formQuestions(p.requestedSchema); if(!questions)return null;
    const visible=Object.fromEntries(['threadId','turnId','serverName','mode','message','requestedSchema'].filter(k=>own(p,k)).map(k=>[k,p[k]]));
    return {kind:'form',questions,actions:[{value:'decline',label:'رد فرم'},{value:'cancel',label:'لغو'}],details:{method,params:visible}};
  }
  return null;
}
function formContent(questions,answers) {
  const result={};
  for(const q of questions) {
    const text=answers[q.id]; if(text===''&&!q.required)continue;
    let value=text; const s=q.schema;
    if(s.type==='boolean'){if(!['true','false'].includes(text))throw new Error('Invalid boolean answer');value=text==='true';}
    if(['number','integer'].includes(s.type)){value=Number(text);if(!text.trim()||!Number.isFinite(value)||(s.type==='integer'&&!Number.isSafeInteger(value)))throw new Error('Invalid numeric answer');}
    if(s.enum&&!s.enum.includes(value))throw new Error('Answer is not an allowed option');
    if(typeof value==='number'&&((s.minimum!=null&&value<s.minimum)||(s.maximum!=null&&value>s.maximum)))throw new Error('Numeric answer outside allowed range');
    if(typeof value==='string'&&((s.minLength!=null&&[...value].length<s.minLength)||(s.maxLength!=null&&[...value].length>s.maxLength)))throw new Error('Answer length outside allowed range');
    Object.defineProperty(result,q.id,{value,enumerable:true,writable:true,configurable:true});
  }
  return result;
}

export class NativeRequests {
  constructor({generation,threads,send,publish=()=>{},clock=Date.now}) {
    Object.assign(this,{generation,send,publish,clock});this.threads=new Set(threads);this.requests=new Map();this.tombstones=new Map();this.tickets=new Map();this.items=new Map();
  }
  issue(r) {
    if(r.state!=='pending')return;
    this.invalidate(r,'replaced');
    const d=describe(r.message,this.items.get(itemKey(r.message.params))); if(!d){if(r.message.method!==FILE)this.publish({type:'desktop-only',threadId:r.message.params.threadId});return;}
    r.fingerprint=fingerprint(d.details); r.ticket=randomBytes(18).toString('base64url'); r.expiresAt=this.clock()+30*60_000;
    this.tickets.set(r.ticket,r);
    this.publish({type:'request',request:{...cloneWire(d),ticket:r.ticket,generation:this.generation,threadId:r.message.params.threadId,turnId:r.message.params.turnId??null,expiresAt:r.expiresAt,fingerprint:r.fingerprint}});
  }
  invalidate(r,source) { if(!r.ticket)return;this.tickets.delete(r.ticket);this.publish({type:'resolved',ticket:r.ticket,source});r.ticket=null; }
  retire(r,source,claimed=r.claimed){const key=idKey(r.message.id);this.invalidate(r,source);this.requests.delete(key);this.tombstones.set(key,{threadId:r.message.params.threadId,claimed,state:source});while(this.tombstones.size>10000)this.tombstones.delete(this.tombstones.keys().next().value);}
  server(message) {
    const p=message?.params||{};
    if(message.method==='serverRequest/resolved') {
      const r=this.requests.get(idKey(p.requestId));if(r&&r.message.params.threadId===p.threadId)this.retire(r,'server');return;
    }
    if(message.method==='item/started'&&p.item?.type==='fileChange'&&this.threads.has(p.threadId)){
      const key=itemKey(p),old=this.items.get(key);this.items.set(key,cloneWire(p.item));
      if(!old||fingerprint(old)!==fingerprint(p.item))for(const r of this.requests.values())if(r.state==='pending'&&r.message.method===FILE&&itemKey(r.message.params)===key)this.issue(r);
    }
    if(message.method==='turn/completed'){
      const turnId=p.turn?.id??p.turnId;
      for(const r of this.requests.values())if(r.message.params.threadId===p.threadId&&r.message.params.turnId===turnId)this.retire(r,'turn-completed');
      for(const key of this.items.keys())if(key.startsWith([p.threadId,turnId,''].join('\0')))this.items.delete(key);
    }
    if(!own(message,'id')||!message.method||!this.threads.has(p.threadId))return;
    if(![USER,COMMAND,FILE,PERMISSIONS,MCP].includes(message.method)){this.publish({type:'desktop-only',threadId:p.threadId});return;}
    const key=idKey(message.id);if(this.requests.has(key)||this.tombstones.has(key))return;if(this.requests.size>=2048){this.publish({type:'desktop-only',threadId:p.threadId});return;}
    const r={message:cloneWire(message),state:'pending',claimed:null,ticket:null};this.requests.set(key,r);this.issue(r);
  }
  desktop(message) {
    if(!own(message,'id')||message.method)return true;
    const key=idKey(message.id);if(this.tombstones.has(key))return false;const r=this.requests.get(key);if(!r)return true;
    r.claimed='desktop';this.retire(r,'desktop','desktop');return true;
  }
  answer(ticket,input) {
    const r=this.tickets.get(ticket);if(!r||r.state!=='pending'||r.expiresAt<this.clock())throw new Error('Stale or expired request');
    const p=r.message.params,d=describe(r.message,this.items.get(itemKey(p)));
    if(!d||fingerprint(d.details)!==r.fingerprint)throw new Error('Stale request details');
    let result;
    if(input.kind==='action'){
      const a=d.actions[input.index];if(!Number.isSafeInteger(input.index)||!a)throw new Error('Invalid action');
      result=d.kind==='permissions'?{permissions:a.value==='grant'?cloneWire(p.permissions):{},scope:'turn'}:d.kind==='form'?{action:a.value}:{decision:a.value};
    } else if(input.kind==='answers'&&['questions','form'].includes(d.kind)) {
      if(!input.answers||Object.keys(input.answers).sort().join('\0')!==d.questions.map(q=>q.id).sort().join('\0'))throw new Error('Answer IDs do not match');
      for(const q of d.questions){const a=input.answers[q.id];if(typeof a!=='string'||a.length>8000||(!a.trim()&&q.required!==false))throw new Error('Invalid answer');if(d.kind==='questions'&&q.options?.length&&!q.isOther&&!q.options.some(o=>o.label===a))throw new Error('Answer must be an original option');}
      result=d.kind==='form'?{action:'accept',content:formContent(d.questions,input.answers)}:{answers:Object.fromEntries(d.questions.map(q=>[q.id,{answers:[input.answers[q.id]]}]))};
    } else throw new Error('Invalid answer type');
    // Claim before enqueue. A pipe failure leaves this uncertain, never reopens it.
    const response={id:r.message.id,result};if(r.message.jsonrpc)response.jsonrpc=r.message.jsonrpc;
    r.claimed='remote';r.state='submitted';this.retire(r,'submitted','remote');
    this.send(response);
    return {state:'submitted',generation:this.generation};
  }
  expire() {for(const r of this.requests.values())if(r.ticket&&r.expiresAt<this.clock())this.invalidate(r,'expired');}
  setThreads(ids){if(!Array.isArray(ids)||ids.length>2048||ids.some(id=>typeof id!=='string'||!id||id.length>100))throw new Error('Invalid watched chats');this.threads=new Set(ids);for(const r of this.requests.values())if(!this.threads.has(r.message.params.threadId))this.retire(r,'unwatched');}
  reissue() {for(const r of this.requests.values())if(r.state==='pending')this.issue(r);}
  disconnect() {for(const r of this.requests.values())this.retire(r,'backend-disconnected');this.items.clear();}
}
