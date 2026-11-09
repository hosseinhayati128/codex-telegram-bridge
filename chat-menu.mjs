import {randomBytes} from 'node:crypto';import {sendText} from './telegram.mjs';
import {MENU_BUTTON} from './bot-ui.mjs';
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export class ChatMenu {
 constructor(controller){this.c=controller;this.data=controller.state.data;this.data.menuSessions??={};this.data.localProjects??=[];}
 prepare(u){
  const data=u.callback_query?.data,m=u.message,draft=this.data.creationDraft;
  if(data?.startsWith('m:')){
   if(data==='m:g')return{kind:'menu',action:'recent'};
   let match=/^m:h:(\d{1,4})$/.exec(data);if(match)return{kind:'menu',action:'home',page:Number(match[1])};
   match=new RegExp(`^m:(p|n):(${UUID})$`).exec(data);if(match){if(!this.data.localProjects.some(p=>p.projectId===match[2]))throw new Error('Stale project button');return{kind:'menu',action:match[1]==='p'?'project':'new',projectId:match[2]};}
   match=/^m:l:([A-Za-z0-9_-]{16}):(\d{1,6})$/.exec(data);if(match)return{kind:'menu',action:'page',ticket:match[1],page:Number(match[2])};
   throw new Error('Unknown menu button');
  }
  if(m?.text?.trim()==='/cancel')return{kind:'menu',action:'cancel'};
  if(m?.reply_to_message&&draft?.messageId===m.reply_to_message.message_id){
   if(draft.state!=='pending'||draft.expiresAt<Date.now()||typeof m.text!=='string'||!m.text.trim()||m.text.length>8000)throw new Error('Stale creation reply');
   return{kind:'create-chat',draftTicket:draft.ticket,project:{...draft.project},prompt:m.text};
  }
  if((draft?.state==='pending'||this.data.pendingCreation)&&m&&!m.reply_to_message&&(!m.text?.startsWith('/')||m.text.startsWith('/say ')))return{kind:'menu',action:'creation-help'};
  return null;
 }
 cancelCreation(){if(this.data.creationDraft?.state==='pending')this.data.creationDraft.state='cancelled';delete this.data.pendingCreation;}
 consumeDraft(ticket){const d=this.data.creationDraft;if(!d||d.ticket!==ticket||d.state!=='pending'||d.expiresAt<Date.now())throw new Error('Stale creation draft');d.state='consumed';}
 async send(text,keyboard){return sendText(this.c.api,String(this.c.owner.chatId),text,{reply_markup:{inline_keyboard:[...keyboard,[MENU_BUTTON]]}});}
 async home(page=0){const projects=await this.c.desktop.listProjects();this.data.localProjects=projects;const max=Math.max(0,Math.ceil(projects.length/5)-1);if(!Number.isSafeInteger(page)||page<0||page>max)throw new Error('Stale project page');this.c.state.save();
  const visible=projects.slice(page*5,page*5+5),keyboard=visible.map((p,i)=>[{text:`${i+1} · ${[...p.label].slice(0,51).join('')}`,callback_data:`m:p:${p.projectId}`}]);
  keyboard.push([{text:'🕘 پنج چت اخیر از همهٔ پروژه‌ها',callback_data:'m:g'}]);const arrows=[];if(page>0)arrows.push({text:'پروژه‌های قبلی',callback_data:`m:h:${page-1}`});if(page<max)arrows.push({text:'پروژه‌های بعدی',callback_data:`m:h:${page+1}`});if(arrows.length)keyboard.push(arrows);
  const labels=visible.map((p,i)=>`${i+1} · ${p.label}\n${p.path}`).join('\n\n');
  await this.send('📁 پروژه‌های محلی Codex\n\n'+(labels||'پروژهٔ محلی ثبت نشده است.')+'\n\nیک پروژه یا چت‌های اخیر را انتخاب کن.',keyboard);
 }
 async localProject(id){if(!this.data.localProjects.some(p=>p.projectId===id))throw new Error('Project was not offered');const projects=await this.c.desktop.listProjects();this.data.localProjects=projects;const project=projects.find(p=>p.projectId===id);if(!project)throw new Error('Project is no longer local');return project;}
 async open(projectId=null){const project=projectId?await this.localProject(projectId):null;const sessions=this.data.menuSessions;for(const[t,s]of Object.entries(sessions))if(s.expiresAt<Date.now())delete sessions[t];while(Object.keys(sessions).length>=16)delete sessions[Object.keys(sessions)[0]];
  const ticket=randomBytes(12).toString('base64url');sessions[ticket]={project,expiresAt:Date.now()+30*60000,pages:[],next:{cursor:null,buffer:[]},seenIds:[]};await this.page(ticket,0);
 }
 async page(ticket,index){const s=this.data.menuSessions[ticket];if(!s||s.expiresAt<Date.now()||!Number.isSafeInteger(index)||index<0||index>s.pages.length)throw new Error('Stale chat page');
  if(index===s.pages.length){if(s.next===null)throw new Error('No older page');const partial=s.scanning?.index===index?s.scanning.rows:[];
   const result=await this.c.desktop.listChatPage({projectId:s.project?.projectId??null,continuation:s.next,exclude:[...s.seenIds,...partial.map(c=>c.id)],take:5-partial.length});s.next=result.continuation;s.sidebarLimited=result.sidebarLimited===true;const combined=[...partial,...result.rows];
   if(combined.length<5&&s.next!==null){s.scanning={index,rows:combined,scannedRows:(s.scanning?.scannedRows||0)+(result.scannedRows||0)};this.c.state.save();
    const keys=[[{text:'ادامهٔ یافتن پنج چت',callback_data:`m:l:${ticket}:${index}`}]];if(index>0)keys.push([{text:'بازگشت به صفحهٔ قبلی',callback_data:`m:l:${ticket}:${index-1}`}]);keys.push([{text:'🏠 پروژه‌ها',callback_data:'m:h:0'}]);
    await this.send(`${s.project?s.project.label:'چت‌های محلی'}\nجست‌وجوی این صفحه هنوز کامل نشده است.\n${s.scanning.scannedRows} ردیف محلی بررسی شد؛ ${combined.length} چت از این صفحه پیدا شد.\nبرای ادامه، دکمهٔ زیر را بزن.`,keys);return;
   }
   delete s.scanning;if(combined.length||index===0){s.pages.push(combined);s.seenIds.push(...combined.map(c=>c.id));}else index--;
  }
  const rows=s.pages[index],visible=this.c.rememberChats(rows),keyboard=[];
  if(s.project)keyboard.push([{text:'➕ چت جدید در این پروژه',callback_data:`m:n:${s.project.projectId}`}]);
  keyboard.push(...visible.map(c=>[{text:[...c.title].slice(0,55).join(''),callback_data:`chat:${c.id}`} ]));
  const arrows=[];if(index>0)arrows.push({text:'پنج‌تای جدیدتر',callback_data:`m:l:${ticket}:${index-1}`});if(index<s.pages.length-1||s.next!==null)arrows.push({text:'پنج‌تای قدیمی‌تر',callback_data:`m:l:${ticket}:${index+1}`});if(arrows.length)keyboard.push(arrows);
  keyboard.push([{text:'🏠 پروژه‌ها',callback_data:'m:h:0'}]);this.c.state.save();
  await this.send(`${s.project?s.project.label:'چت‌های اخیر — همهٔ پروژه‌های محلی'}\nصفحهٔ ${index+1}${s.sidebarLimited?'\nنمایش چت‌های سنجاق‌شده و موارد محلی از ۵۰ ردیف اخیر برنامه.':''}\n\n${visible.map(c=>`${c.id===this.c.selected().id?'● ':''}${c.alias}: ${c.title}`).join('\n')||'چتی در این صفحه نیست.'}`,keyboard);
 }
 async askCreation(projectId){const project=await this.localProject(projectId);
  const draft={ticket:randomBytes(12).toString('base64url'),messageId:null,project:{...project},expiresAt:Date.now()+10*60000,state:'pending'};
  this.data.creationDraft=draft;this.c.state.save();
  const response=await this.c.api.call('sendMessage',{chat_id:String(this.c.owner.chatId),text:`چت جدید در پروژهٔ ${project.label}\n${project.path}\n\nپیام اول چت جدید را با Reply به همین پیام بفرست. تا قبل از پاسخ تو چتی ساخته نمی‌شود.\nانصراف: /cancel`,reply_markup:{force_reply:true,selective:true}});
  if(!Number.isSafeInteger(response.message_id))throw new Error('Creation prompt delivery is uncertain');draft.messageId=response.message_id;this.c.state.save();
 }
 async run(op){switch(op.action){
  case'home':return this.home(op.page);
  case'recent':return this.open();
  case'project':return this.open(op.projectId);
  case'page':return this.page(op.ticket,op.page);
  case'new':return this.askCreation(op.projectId);
  case'cancel':{const sent=!!this.data.pendingCreation;this.cancelCreation();this.c.state.save();return this.c.text(sent?'حالت ساخت چت جدید بسته شد؛ درخواست ساختِ قبلاً ارسال‌شده در کدکس لغو نمی‌شود.':'ساخت چت جدید لغو شد.');}
  case'creation-help':{
   if(this.data.pendingCreation?.state==='uncertain'||this.data.pendingCreation?.state==='dispatching')return this.c.text('نتیجهٔ ساخت چت قطعی نیست؛ قبل از ساخت دوباره، منوی پروژه را بررسی و چت موردنظر را انتخاب کن. /cancel فقط حالت انتظار ربات را می‌بندد.');
   if(this.data.creationDraft?.state==='pending'&&this.data.creationDraft.messageId===null)return this.c.text('تحویل پیام درخواستِ پیام اول قطعی نیست. برای گرفتن یک درخواست قابل پاسخ، دوباره دکمهٔ چت جدید را بزن؛ یا با /cancel به حالت عادی برگرد.');
   return this.c.text(this.data.pendingCreation?'چت جدید هنوز در حال آماده‌سازی است. از منو چت آماده‌شده را انتخاب کن؛ یا برای برگشت به پیام عادی /cancel را بفرست.':'برای ساخت چت جدید، به پیام درخواستِ پیام اول Reply کن. برای برگشت به ارسال پیام عادی /cancel را بفرست.');
  }
  default:throw new Error('Unknown menu operation');
 }}
}
