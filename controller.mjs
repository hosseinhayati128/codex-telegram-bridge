import {translator} from './i18n.mjs';
import {isOwner,sendText} from './telegram.mjs';
import {ChatMenu} from './chat-menu.mjs';
import {BotUi,menuButton} from './bot-ui.mjs';
import {incomingAttachment,MAX_IN} from './attachments.mjs';import {randomBytes} from 'node:crypto';
const EFFORTS=['low','medium','high','xhigh','max','ultra'];
export class Controller {
 constructor(options){Object.assign(this,options);this.t=translator(()=>this.state.data.botLanguage);if(!['fa','en'].includes(this.state.data.botLanguage))this.state.data.botLanguage='fa';this.state.data.chatCatalog??=this.chats.map(c=>({...c}));this.state.data.effortByThread??={};this.state.data.effortMenus??={};this.state.data.updatesByThread??={};this.state.data.updatesMenus??={};this.menu=new ChatMenu(this);this.ui=new BotUi(this);this.fileTail=Promise.resolve();this.filePending=0;}
 text(text,extra){return sendText(this.api,String(this.owner.chatId),text,extra);}
 selected(){return this.chats.find(c=>c.alias===this.state.data.selected)||this.chats[0];}
 thinking(threadId){const value=this.state.data.effortByThread[threadId];return EFFORTS.includes(value)?value:undefined;}
 updatesLabel(threadId){return this.state.data.updatesByThread[threadId]==='progress'?this.t('همراه پیام‌های پیشرفت'):this.t('فقط سؤال‌ها، تأییدها و نتیجهٔ نهایی');}
 updatesOperation(u){const data=u.callback_query?.data;if(data?.startsWith('u:')){const m=/^u:([A-Za-z0-9_-]{16}):(quiet|progress)$/.exec(data),record=m&&this.state.data.updatesMenus[m[1]];if(!record||record.expiresAt<Date.now()||!this.chats.some(c=>c.id===record.threadId))throw new Error('Stale updates menu');return{kind:'set-updates',threadId:record.threadId,value:m[2]};}
  const text=u.message?.text?.trim();if(text==='/updates')return{kind:'updates-menu',threadId:this.selected().id};if(text?.startsWith('/updates ')){const value=text.slice(9).trim();return['quiet','progress'].includes(value)?{kind:'set-updates',threadId:this.selected().id,value}:{kind:'file-notice',message:this.t('برای انتخاب دکمه /updates را بفرست؛ /updates quiet و /updates progress هم معتبر است.')};}return null;
 }
 async showUpdates(threadId){const menus=this.state.data.updatesMenus;for(const[t,r]of Object.entries(menus))if(r.expiresAt<Date.now())delete menus[t];while(Object.keys(menus).length>=32)delete menus[Object.keys(menus)[0]];const ticket=randomBytes(12).toString('base64url');menus[ticket]={threadId,expiresAt:Date.now()+3600000};this.state.save();
  return this.api.call('sendMessage',{chat_id:String(this.owner.chatId),text:this.t`🔔 اعلان‌های «${this.chats.find(c=>c.id===threadId)?.title}»\n\nحالت فعلی: ${this.updatesLabel(threadId)}\n\nهمراه پیشرفت: پیام‌های قابل‌نمایش Codex هم از این به بعد فرستاده می‌شوند؛ معمولاً چند ثانیه پس از کامل‌شدن هر پیام. سؤال‌ها و تأییدها در هر دو حالت باقی می‌مانند.`,reply_markup:{inline_keyboard:[[{text:this.t('فقط سؤال، تأیید و نتیجه'),callback_data:`u:${ticket}:quiet`}],[{text:this.t('همراه پیام‌های پیشرفت'),callback_data:`u:${ticket}:progress`}],[menuButton(this.t)]]}});
 }
 effortOperation(u){const data=u.callback_query?.data;if(data?.startsWith('e:')){const m=/^e:([A-Za-z0-9_-]{16}):(default|low|medium|high|xhigh|max|ultra)$/.exec(data),record=m&&this.state.data.effortMenus[m[1]];if(!record||record.expiresAt<Date.now()||!this.chats.some(c=>c.id===record.threadId))throw new Error('Stale effort menu');return{kind:'set-effort',threadId:record.threadId,value:m[2]};}const text=u.message?.text?.trim();if(text==='/effort')return{kind:'effort-menu',threadId:this.selected().id};if(text?.startsWith('/effort ')){const value=text.slice(8).trim();return EFFORTS.includes(value)||value==='default'?{kind:'set-effort',threadId:this.selected().id,value}:{kind:'file-notice',message:this.t('effort معتبر: low, medium, high, xhigh, max, ultra یا default.')};}return null;}
 async showEffort(threadId){const menus=this.state.data.effortMenus;for(const[t,r]of Object.entries(menus))if(r.expiresAt<Date.now())delete menus[t];while(Object.keys(menus).length>=32)delete menus[Object.keys(menus)[0]];const ticket=randomBytes(12).toString('base64url');menus[ticket]={threadId,expiresAt:Date.now()+3600000};this.state.save();
  const keyboard=[];for(let i=0;i<EFFORTS.length;i+=2)keyboard.push(EFFORTS.slice(i,i+2).map(value=>({text:value,callback_data:`e:${ticket}:${value}`})));
  keyboard.push([{text:this.t('پیروی از تنظیم خود Codex'),callback_data:`e:${ticket}:default`}],[menuButton(this.t)]);
  return this.api.call('sendMessage',{chat_id:String(this.owner.chatId),text:this.t`🎚 سطح تلاش «${this.chats.find(c=>c.id===threadId)?.title}»\n\nتنظیم فعلی تلگرام: ${this.thinking(threadId)||this.t('پیروی از Codex')}\n\nانتخاب از پیام بعدی همین چت اعمال می‌شود. سطح‌های قابل استفاده به مدل همین چت بستگی دارند.`,reply_markup:{inline_keyboard:keyboard}});
 }
 fileOperation(u,media){if(media){if(!this.attachments)return{kind:'file-notice',message:this.t('دریافت فایل هنوز در این سرویس فعال نیست.')};if(u.message.reply_to_message||this.state.data.creationDraft?.state==='pending'||this.state.data.pendingCreation)return{kind:'file-notice',message:this.t('ابتدا فرم یا ساخت چت را تمام کن؛ فایل را بدون Reply به چت انتخاب‌شده بفرست.')};if(media.fileSize>MAX_IN)return{kind:'file-notice',message:this.t('سقف دریافت فایل ۲۰ مگابایت است؛ فایل کوچک‌تری بفرست.')};if(typeof media.fileId!=='string'||!media.fileId||media.fileId.length>1024)throw new Error('Invalid file');return{kind:'incoming-file',threadId:this.selected().id,attachment:media,caption:u.message.forward_origin||u.message.forward_from?'':String(u.message.caption||'').slice(0,8000),thinking:this.thinking(this.selected().id),updateId:u.update_id};}
  const data=u.callback_query?.data;if(data?.startsWith('file:')){const t=data.slice(5),r=this.state.data.downloads?.[t];if(!/^[A-Za-z0-9_-]{16}$/.test(t)||!r||r.used||r.expiresAt<Date.now()||!this.chats.some(c=>c.id===r.threadId))throw new Error('Stale file');return{kind:'outgoing-file',threadId:r.threadId,ticket:t};}const text=u.message?.text?.trim();if(text==='/files')return{kind:'files-menu',threadId:this.selected().id};if(text?.startsWith('/get ')){let file=text.slice(5).trim();if(file.startsWith('"')&&file.endsWith('"'))file=file.slice(1,-1);return{kind:'outgoing-file',threadId:this.selected().id,path:file};}return null;
 }
 enqueueFile(id,op){this.filePending++;this.fileTail=this.fileTail.then(async()=>{try{await this.runFile(id,op);}finally{this.filePending--;}}).catch(()=>{});}
 drainFiles(){return this.fileTail;}
 async runFile(id,op){let ticket=op.ticket;const active=()=>{if(this.state.data.paused)throw Object.assign(new Error('Transfer paused'),{code:'PAUSED'});};try{active();if(op.kind==='incoming-file'){const received=await this.attachments.receive(op);this.state.get(id).localFile=received.path;active();this.state.dispatching(id);await this.desktop.sendText(op.threadId,received.prompt,{thinking:op.thinking});this.state.finish(id,'submitted');await this.text(this.t('فایل دریافت و به همان چت ارسال شد.'));}
   else{const r=await this.desktop.read(op.threadId);active();if(!ticket){ticket=this.attachments.register(op.threadId,op.path,r.thread.cwd,{forceNew:true});this.attachments.consume(ticket);}this.state.get(id).fileTicket=ticket;this.state.dispatching(id);await this.attachments.send(ticket,op.threadId,r.thread.cwd);this.state.finish(id,'submitted');}
  }catch(error){const entry=this.state.get(id);if(entry?.state==='submitted')return;const paused=error.code==='PAUSED',record=this.state.data.downloads?.[ticket],uncertain=!paused&&entry?.state==='dispatching'&&(op.kind==='incoming-file'||record?.sent);if(paused&&record&&!record.sent)record.used=false;this.state.finish(id,uncertain?'uncertain':'failed');try{await this.text(paused?this.t('انتقال به‌علت /pause متوقف شد؛ فایل دریافت‌شده حفظ شده است. بعد از /resume می‌توانی دوباره ارسالش کنی.'):uncertain?this.t('تحویل فایل قطعی نیست؛ پیش از ارسال دوباره، چت را بررسی کن. فایل خودکار تکرار نمی‌شود.'):this.t('انتقال فایل انجام نشد؛ اندازه، مسیر مجاز یا تغییر فایل را بررسی کن. اگر فایل دریافت شده باشد، نسخهٔ محلی آن حفظ می‌شود.'));}catch{}}
 }
 resolveChat(value){const chat=this.state.data.chatCatalog.find(c=>c.alias===value||c.id===value)||this.chats.find(c=>c.alias===value||c.id===value);if(!chat||(!this.chats.some(c=>c.id===chat.id)&&!this.state.data.chatListActive?.includes(chat.id)))throw new Error('Unknown chat; refresh /threads');return {...chat};}
 rememberChats(rows){const catalog=this.state.data.chatCatalog;
  for(const row of rows){const known=catalog.find(c=>c.id===row.id);if(known)known.title=row.title;else{let n=1;while(catalog.some(c=>c.alias===`chat${n}`))n++;catalog.push({...row,alias:`chat${n}`});}const watched=this.chats.find(c=>c.id===row.id);if(watched)watched.title=row.title;}
  this.state.data.chatListActive=[...new Set([...(this.state.data.chatListActive||[]),...rows.map(c=>c.id)])].slice(-512);return rows.map(row=>catalog.find(c=>c.id===row.id));
 }
 async update(u){
  const id=u.update_id;if(!Number.isSafeInteger(id)||id<this.state.data.offset||this.state.get(id))return;
  const media=incomingAttachment(u.message);if(!isOwner(u,this.owner,{allowForwardedMedia:!!media})){this.state.begin(id,{kind:'ignored'});this.state.finish(id,'ignored');return;}
  let operation;
  try{
   const m=u.message;
   if(m?.date&&m.date*1000<Date.now()-120000)throw new Error(this.t('این پیام قدیمی است؛ برای اجرای دستور دوباره آن را بفرست.'));
   if(m&&typeof m.text!=='string'&&!media)throw new Error('Unsupported message');
   const ui=m?.reply_to_message||media?null:this.ui.prepare(u);
   if(this.state.data.paused&&!['panel','set-language','status','requests','resume'].includes(ui?.kind)&&(m?.reply_to_message||!['/resume','/status'].includes(m?.text?.trim())))throw new Error(this.t('کنترل از راه دور موقتاً متوقف است؛ /resume را بفرست.'));
   const selection=/^chat:([0-9a-f-]{36})$/.exec(u.callback_query?.data||'');
   if(m?.reply_to_message&&!media){operation=this.state.data.creationDraft?.messageId===m.reply_to_message.message_id?this.menu.prepare(u):this.native.prepare(u);if(!operation)throw new Error('Unknown reply owner');}
   else operation=this.fileOperation(u,media)||this.effortOperation(u)||this.updatesOperation(u)||ui||this.menu.prepare(u)||(selection?{kind:'select',chat:this.resolveChat(selection[1])}:this.native.prepare(u));
   if(['incoming-file','outgoing-file'].includes(operation?.kind)&&this.filePending>=4)operation={kind:'file-notice',message:this.t('چهار فایل در صف انتقال است؛ پس از پایان، فایل بعدی را بفرست.')};
   if(!operation){
    const text=m.text.trim(),chat=this.selected();
    if(text.startsWith('/use '))operation={kind:'select',chat:this.resolveChat(text.slice(5).trim())};
    else if(['/threads','/projects','/recent','/status','/last','/pause','/stop','/resume','/requests'].includes(text))operation={kind:text.slice(1),threadId:chat.id};
    else{const prompt=text.startsWith('/say ')?text.slice(5).trim():text;if(!prompt||prompt.startsWith('/')||prompt.length>8000)throw new Error(this.t('دستور معتبر نیست؛ /help را بفرست.'));operation={kind:'command',threadId:chat.id,text:prompt,thinking:this.thinking(chat.id)};}
   }
  }catch{this.state.begin(id,{kind:'rejected-input'});this.state.finish(id,'rejected');await this.text(this.t('این پیام یا دکمه قابل اجرا نیست؛ سؤال ممکن است بسته شده باشد. /status و /help را بررسی کن.'));return;}
  if(!this.state.begin(id,operation))return;
  if(u.callback_query)try{await this.api.call('answerCallbackQuery',{callback_query_id:u.callback_query.id,text:this.t('دریافت شد')});}catch{}
  let notice='';
  try{
   if(operation.kind==='command'){
    this.state.dispatching(id);await this.desktop.sendText(operation.threadId,operation.text,{thinking:operation.thinking});this.state.finish(id,'submitted');notice=this.t`دستور به «${this.chats.find(c=>c.id===operation.threadId).title}» فرستاده شد.`;
   }else if(['incoming-file','outgoing-file'].includes(operation.kind)){
    if(!this.attachments)throw new Error('Files unavailable');if(operation.ticket)this.attachments.consume(operation.ticket);this.state.finish(id,'queued');this.enqueueFile(id,operation);notice=this.t('فایل برای همان چت در صف انتقال قرار گرفت؛ می‌توانی از منوهای ربات استفاده کنی.');
   }else if(operation.kind==='create-chat'){
    this.menu.consumeDraft(operation.draftTicket);this.state.data.pendingCreation={state:'dispatching',projectId:operation.project.projectId};this.state.dispatching(id);const result=await this.desktop.createChat(operation.project,operation.prompt);const threadId=result.threadId||result.thread?.id;
    if(result.hostId&&result.hostId!=='local')throw new Error('Unexpected creation host');
    if(typeof threadId==='string'&&/^[0-9a-f-]{36}$/.test(threadId)){const chat=this.rememberChats([{id:threadId,title:result.title||result.thread?.title||this.t('چت جدید'),projectId:operation.project.projectId}])[0];await this.desktop.watchChat(chat);this.menu.cancelCreation();this.state.data.selected=chat.alias;this.state.data.seen[chat.id]='created:inProgress';this.state.get(id).createdThreadId=threadId;notice=this.t`چت جدید در ${operation.project.label} ساخته و انتخاب شد: ${chat.alias}. پیام‌های بعدی به همین چت می‌روند.`;}
    else if(typeof result.clientThreadId==='string'){this.state.get(id).pendingClientThreadId=result.clientThreadId;this.state.data.pendingCreation={clientThreadId:result.clientThreadId,projectId:operation.project.projectId};notice=this.t('ساخت چت در همان پروژه در حال آماده‌سازی است؛ پس از آماده‌شدن، از منوی پروژه انتخابش کن. تا انتخاب چت، متن عادی به چت قبلی فرستاده نمی‌شود.');}
    else throw new Error('Unrecognized creation acknowledgement');
    this.state.finish(id,'submitted');
   }else if(operation.kind==='native'){
    this.state.dispatching(id);const result=await this.remote(operation);this.state.finish(id,result.state==='submitted'?'submitted':'uncertain');
    notice=result.state==='submitted'?this.t('پاسخ به همان درخواست بومی تحویل شد؛ انجام کار تابع نتیجهٔ کدکس است.'):this.t('وضعیت تحویل پاسخ قطعی نیست؛ درخواست را در خود کدکس بررسی کن. پاسخ خودکار تکرار نمی‌شود.');
   }else{
    switch(operation.kind){
     case 'partial':notice=this.t('این پاسخ ثبت شد؛ سؤال‌های دیگر را هم پاسخ بده.');break;
     case 'select':this.menu.cancelCreation();if(!this.chats.some(c=>c.id===operation.chat.id))await this.desktop.watchChat(operation.chat);this.state.data.selected=operation.chat.alias;notice=this.t`چت انتخاب شد: ${this.selected().title}`;break;
     case 'set-language':this.state.data.botLanguage=operation.value;this.state.save();await this.ui.show('settings',operation.panelId);try{await this.ui.registerCommands();}catch{}break;
     case 'panel':await this.ui.show(operation.screen,operation.panelId);break;
     case 'threads':case 'projects':await this.menu.home();break;
     case 'recent':await this.menu.open();break;
     case 'menu':await this.menu.run(operation);break;
     case 'effort-menu':await this.showEffort(operation.threadId);break;
     case 'updates-menu':await this.showUpdates(operation.threadId);break;
     case 'set-updates':await this.desktop.configureUpdates(operation.threadId,operation.value);notice=this.t`اعلان‌های «${this.chats.find(c=>c.id===operation.threadId)?.title}»: ${this.updatesLabel(operation.threadId)}. انتخاب برای همین چت ذخیره شد.`;break;
     case 'set-effort':if(operation.value==='default')delete this.state.data.effortByThread[operation.threadId];else this.state.data.effortByThread[operation.threadId]=operation.value;notice=this.t`effort تلگرام برای «${this.chats.find(c=>c.id===operation.threadId)?.title}»: ${this.thinking(operation.threadId)||this.t('پیروی از Codex')}. از پیام بعدی همان چت اعمال می‌شود.`;break;
     case 'file-notice':notice=operation.message;break;
     case 'files-menu':{if(!this.attachments)throw new Error('Files unavailable');const r=await this.desktop.read(operation.threadId),text=await this.desktop.lastAnswer(operation.threadId),title=this.chats.find(c=>c.id===operation.threadId)?.title;this.attachments.buttons(operation.threadId,text,r.thread.cwd);const keys=this.attachments.list(operation.threadId);if(keys.length)await this.api.call('sendMessage',{chat_id:String(this.owner.chatId),text:this.t`📎 فایل‌های خروجی «${title}»\n\nبرای دریافت، نام فایل را بزن.`,reply_markup:{inline_keyboard:[...keys,[menuButton(this.t)]]}});else notice=this.t`فایل خروجی قابل دریافت برای «${title}» پیدا نشد. برای یک فایل از چت انتخاب‌شده می‌توانی /get و مسیر کامل را بفرستی.`;break;}
     case 'last':notice=`${this.chats.find(c=>c.id===operation.threadId)?.title}\n\n${await this.desktop.lastAnswer(operation.threadId)}`;break;
     case 'status':notice=this.t`${this.status()}\nچت انتخابی: ${this.selected().title}\neffort تلگرام: ${this.thinking(this.selected().id)||this.t('پیروی از Codex')}\nاعلان‌ها: ${this.updatesLabel(this.selected().id)}\nفایل‌های در صف: ${this.filePending}\nکنترل: ${this.state.data.paused?this.t('متوقف'):this.t('فعال')}\nعملیات با تحویل نامشخص: ${Object.values(this.state.data.journal).filter(x=>x.state==='uncertain').length}`;break;
     case 'pause':case 'stop':this.state.data.paused=true;notice=this.t('ارسال دستور و پاسخ از تلگرام متوقف شد؛ اعلان‌ها ادامه دارند. برای فعال‌کردن /resume را بفرست.');break;
     case 'resume':this.state.data.paused=false;notice=this.t('کنترل از تلگرام فعال شد.');break;
     case 'requests':notice=this.t`درخواست‌های بومی باز در تلگرام: ${this.native.active.size}. برای پاسخ، از همان پیام سؤال یا تأیید استفاده کن.`;break;
     default:throw new Error('Unknown operation');
    }
    this.state.finish(id,'handled');
    if(operation.panelId&&['pause','resume'].includes(operation.kind))try{await this.ui.show('control',operation.panelId);notice='';}catch{}
   }
  }catch{
   const uncertain=this.state.get(id)?.state==='dispatching';if(operation.kind==='create-chat'&&uncertain&&this.state.data.pendingCreation)this.state.data.pendingCreation.state='uncertain';this.state.finish(id,uncertain?'uncertain':'failed');
   notice=uncertain?this.t('تحویل دستور یا پاسخ قطعی نیست؛ پیش از ارسال دوباره، خود چت را بررسی کن. هیچ اجرای خودکاری تکرار نمی‌شود.'):this.t('کدکس فعلاً در دسترس نیست یا درخواست بسته شده است. /status را بررسی کن.');
  }
  if(notice)await this.text(notice,['select','status','last','pause','resume','stop','requests','set-effort','set-updates','files-menu'].includes(operation.kind)?{reply_markup:{inline_keyboard:[[menuButton(this.t)]]}}:{});
 }
}
