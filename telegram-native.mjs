import {translator} from './i18n.mjs';
import {stringifyWire} from './wire.mjs';
export class TelegramNative {
 constructor({api,chatId,title,language=()=> 'fa'}){Object.assign(this,{api,chatId,title});this.t=translator(language);this.active=new Map();this.prompts=new Map();}
 async show(request,route){
  if(!/^[A-Za-z0-9_-]{24}$/.test(request.ticket)||request.expiresAt<Date.now())return;
  const r={...request,route,state:'rendering',messages:[],answers:Object.create(null)};this.active.set(r.ticket,r);
  const heading=this.t`${this.title(r.threadId)}\nدرخواست بومی Codex\nشناسهٔ بررسی: ${r.fingerprint}`;
  try{
   if(['questions','form'].includes(r.kind)){
    if(r.kind==='form'){
     const original=`${heading}\n\n${stringifyWire(r.details)}`;
     if([...original].length>3600)await this.api.document(this.chatId,original,'codex-form-details.txt');
     else{const result=await this.api.call('sendMessage',{chat_id:this.chatId,text:original});r.messages.push(result.message_id);}
     if(this.active.get(r.ticket)!==r){await this.clear(r);return;}
    }
    for(const [qi,q]of r.questions.entries()){
     if(this.active.get(r.ticket)!==r)return;
     const options=(q.options||[]).map((o,i)=>`${i+1}. ${o.label}${o.description?' — '+o.description:''}`).join('\n');
     const text=`${heading}\n\n${q.header||''}\n${q.question}\n${q.description||''}\n${options}\n\n${q.options?.length&&!q.isOther?this.t('یک گزینه را انتخاب کن.'):this.t('برای پاسخ متنی به همین پیام Reply کن.')}`;
     const keyboard=(q.options||[]).map((o,i)=>[{text:[...o.label].slice(0,55).join(''),callback_data:`n:${r.ticket}:q:${qi}:${i}`}]);
     if(q.required===false)keyboard.push([{text:this.t('خالی بگذار (اختیاری)'),callback_data:`n:${r.ticket}:s:${qi}`}]);
     let body=text;if([...text].length>3600){await this.api.document(this.chatId,text,'codex-question.txt');if(this.active.get(r.ticket)!==r)return;body=this.t`${heading}\n\nسؤال ${qi+1}: متن کامل و گزینه‌ها در فایل بالا؛ با Reply یا دکمه پاسخ بده.`;}
     const result=await this.api.call('sendMessage',{chat_id:this.chatId,text:body,reply_markup:keyboard.length?{inline_keyboard:keyboard}:{force_reply:true,selective:true}});
     r.messages.push(result.message_id);this.prompts.set(result.message_id,{ticket:r.ticket,questionId:q.id});
     if(this.active.get(r.ticket)!==r){await this.clear(r);return;}
    }
    if(r.actions.length&&this.active.get(r.ticket)===r){const result=await this.api.call('sendMessage',{chat_id:this.chatId,text:this.t('تصمیم دربارهٔ فرم بالا:'),reply_markup:{inline_keyboard:r.actions.map((a,i)=>[{text:this.t(a.label),callback_data:`n:${r.ticket}:a:${i}`}])}});r.messages.push(result.message_id);if(this.active.get(r.ticket)!==r){await this.clear(r);return;}}
   }else{
    const details=stringifyWire(r.details),text=`${heading}\n\n${details}`;let body=text;
    if([...text].length>3600){await this.api.document(this.chatId,text,'codex-approval-details.txt');if(this.active.get(r.ticket)!==r)return;body=this.t`${heading}\n\nجزئیات کامل درخواست در فایل بالا است. تصمیم فقط به همین درخواست مربوط است.`;}
    const result=await this.api.call('sendMessage',{chat_id:this.chatId,text:body,reply_markup:{inline_keyboard:r.actions.map((a,i)=>[{text:this.t(a.label),callback_data:`n:${r.ticket}:a:${i}`}])}});r.messages.push(result.message_id);
    if(this.active.get(r.ticket)!==r){await this.clear(r);return;}
   }
   r.state='pending';
  }catch{this.active.delete(r.ticket);await this.clear(r);throw new Error('Could not deliver full native request to Telegram; answer on desktop');}
 }
 current(ticket){const r=this.active.get(ticket);if(!r||r.state!=='pending'||r.expiresAt<Date.now())throw new Error('Stale native request; check Codex desktop');return r;}
 prepare(update){
  const cb=update.callback_query,m=update.message;
  if(cb){const match=/^n:([A-Za-z0-9_-]{24}):(a|q|s):(\d+)(?::(\d+))?$/.exec(cb.data||'');if(!match)throw new Error('Stale or unknown callback');
   const [,ticket,kind,first,second]=match,r=this.current(ticket),index=Number(first);
   if(kind==='a'){if(second!==undefined||!r.actions[index])throw new Error('Invalid action');r.state='submitting';return{kind:'native',route:r.route,generation:r.generation,ticket,input:{kind:'action',index}};}
   if(kind==='s'){const q=r.questions?.[index];if(second!==undefined||!q||q.required!==false)throw new Error('Invalid optional field');return this.collect(r,q,'');}
   const q=r.questions?.[index],option=q?.options?.[Number(second)];if(second===undefined||!option)throw new Error('Invalid answer option');return this.collect(r,q,option.label);
  }
  if(m?.reply_to_message){const p=this.prompts.get(m.reply_to_message.message_id);if(!p)throw new Error('Stale question reply; it was not sent as a new command');const r=this.current(p.ticket),q=r.questions.find(x=>x.id===p.questionId);if(!q)throw new Error('Stale question');return this.collect(r,q,m.text);}
  return null;
 }
 collect(r,q,value){if(typeof value!=='string'||value.length>8000||(!value.trim()&&q.required!==false))throw new Error('Invalid question answer');if(r.kind==='questions'&&q.options?.length&&!q.isOther&&!q.options.some(x=>x.label===value))throw new Error('Choose an original option');r.answers[q.id]=value;
  if(!r.questions.every(x=>Object.hasOwn(r.answers,x.id)))return{kind:'partial',ticket:r.ticket};
  r.state='submitting';return{kind:'native',route:r.route,generation:r.generation,ticket:r.ticket,input:{kind:'answers',answers:{...r.answers}}};
 }
 async clear(r){for(const id of r.messages){this.prompts.delete(id);try{await this.api.call('editMessageReplyMarkup',{chat_id:this.chatId,message_id:id,reply_markup:{inline_keyboard:[]}});}catch{}}}
 async resolve(ticket){const r=this.active.get(ticket);if(!r)return;this.active.delete(ticket);await this.clear(r);}
 async disconnect(route){await Promise.all([...this.active.values()].filter(r=>r.route===route).map(r=>this.resolve(r.ticket)));}
}
