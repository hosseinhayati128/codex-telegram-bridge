const key=(action,text)=>({text,callback_data:'ui:'+action});
export const MENU_BUTTON=Object.freeze(key('home','⌂ منوی اصلی'));
export const menuButton=t=>key('home',t('⌂ منوی اصلی'));
const escape=text=>String(text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);
const sections=['home','chats','settings','language','files','control','help'];
const scoped={effort:'effort-menu',updates:'updates-menu',output:'files-menu',last:'last'};
const actions=['projects','recent','status','requests','pause','resume'];
const groups=[
 ['منو',[['menu','بازکردن منوی اصلی'],['start','شروع و نمایش منوی اصلی'],['help','راهنمای دستورها']]],
 ['چت‌ها',[['threads','پروژه‌ها و انتخاب چت'],['projects','فهرست پروژه‌ها'],['recent','چت‌های اخیر'],['use','انتخاب چت با نام کوتاه',' نام'],['last','آخرین پاسخ چت'],['say','ارسال متن به چت انتخابی',' متن'],['cancel','انصراف از ساخت چت']]],
 ['تنظیمات',[['effort','سطح تلاش Codex در این چت'],['updates','نوع اعلان‌های این چت']]],
 ['فایل‌ها',[['files','دریافت فایل‌های خروجی'],['get','دریافت یک فایل',' مسیرکامل']]],
 ['کنترل',[['status','وضعیت اتصال، چت و صف فایل'],['requests','درخواست‌های منتظر پاسخ'],['pause','توقف موقت ارسال دستور و پاسخ'],['resume','ادامهٔ کنترل از تلگرام']]],
];
export const BOT_COMMANDS=groups.flatMap(([group,commands])=>commands.map(([command,description])=>({command,description:group+' · '+description})));

export class BotUi {
 constructor(controller){this.c=controller;this.t=controller.t;this.data=controller.state.data;this.data.uiPanels??=[];}
 prepare(u){
  const text=u.message?.text?.trim(),cb=u.callback_query,data=cb?.data;
  if(text==='/menu'||text==='/start'||text==='/help')return{kind:'panel',screen:text==='/help'?'help':'home'};
  if(!data?.startsWith('ui:'))return null;
  const [,action,threadId,extra]=data.split(':');
  const id=cb.message?.message_id,panelId=this.data.uiPanels.includes(id)?id:undefined;
  if(extra===undefined&&threadId===undefined){
   if(sections.includes(action))return{kind:'panel',screen:action,panelId};
   if(actions.includes(action))return{kind:action,panelId};
  }
  if(extra===undefined&&action==='lang'&&['fa','en'].includes(threadId))return{kind:'set-language',value:threadId,panelId};
  if(extra===undefined&&Object.hasOwn(scoped,action)&&this.c.chats.some(c=>c.id===threadId))return{kind:scoped[action],threadId};
  throw new Error('Unknown menu action or chat');
 }
 groups(){return groups.map(([label,commands])=>[this.t(label),commands.map(([command,description,args=''])=>[command,this.t(description),this.t(args)])]);}
 async registerCommands(){const language=this.data.botLanguage,commands=this.groups().flatMap(([group,rows])=>rows.map(([command,description])=>({command,description:group+' · '+description})));const result=await this.c.api.call('setMyCommands',{scope:{type:'chat',chat_id:String(this.c.owner.chatId)},commands});if(result===true){this.data.commandMenuLanguage=language;this.c.state.save();}return result;}
 async panel(text,keyboard,{messageId,html=false}={}){
  const args={chat_id:String(this.c.owner.chatId),text,reply_markup:{inline_keyboard:keyboard},...(html?{parse_mode:'HTML'}:{})};
  if(this.data.uiPanels.includes(messageId)){
   try{return await this.c.api.call('editMessageText',{...args,message_id:messageId});}
   catch(e){if(e.notModified)return;if(e.telegramCode!==400)throw e;}
  }
  const sent=await this.c.api.call('sendMessage',args);
  if(Number.isSafeInteger(sent?.message_id)&&sent.message_id>0){
   this.data.uiPanels=[...this.data.uiPanels.filter(id=>id!==sent.message_id),sent.message_id].slice(-32);this.c.state.save();
  }
  return sent;
 }
 show(section,messageId){
  const c=this.c,chat=c.selected(),title=escape([...chat.title].slice(0,120).join('')),paused=!!this.data.paused,
   context=this.t('چت انتخاب‌شده: <b>')+title+'</b>',effort=escape(c.thinking(chat.id)||this.t('تنظیم خود Codex')),updates=escape(c.updatesLabel(chat.id)),
   control=paused?this.t('⏸ متوقف'):this.t('🟢 فعال'),pauseHint=paused?this.t('\n\nبرای استفاده از دکمه‌های این بخش، از «کنترل» ادامه را بزن.'):'';
  let text,keys;
  switch(section){
   case 'home':
    text=this.t`<b>Codex | منوی اصلی</b>\n\n${context}\nاعلان‌ها: ${updates}\nسطح تلاش: ${effort}\nکنترل: ${control}\n\n${paused?this.t('برای ادامهٔ ارسال دستور، «کنترل و وضعیت» را باز کن.'):this.t('یک بخش را انتخاب کن.')}`;
    keys=[[key('chats',this.t('💬 چت‌ها')),key('settings',this.t('⚙ تنظیمات'))],[key('files',this.t('📎 فایل‌ها')),key('control',this.t('⏯ کنترل و وضعیت'))],[key('help',this.t('❔ راهنما'))]];break;
   case 'chats':
    text=this.t`<b>💬 چت‌ها</b>\n\n${context}\n\nبرای عوض‌کردن چت، پروژه یا فهرست اخیر را باز کن. برای ساخت چت جدید، وارد پروژه‌اش شو.${pauseHint}`;
    keys=paused?[]:[[key('projects',this.t('📁 پروژه‌ها')),key('recent',this.t('🕘 چت‌های اخیر'))],[key('last:'+chat.id,this.t('آخرین پاسخ'))]];break;
   case 'language':
    text=this.t('🌐 زبان ربات / Bot language')+'\n\n'+this.t('زبان منوها و اعلان‌های ربات را انتخاب کن. زبان پیام‌های ChatGPT و محتوای چت تغییر نمی‌کند.');
    keys=[[key('lang:fa','فارسی'+(this.data.botLanguage==='fa'?' ✓':'')),key('lang:en','English'+(this.data.botLanguage==='en'?' ✓':''))]];break;
   case 'settings':
    text=this.t`<b>⚙ تنظیمات همین چت</b>\n\n${context}\nاعلان‌ها: ${updates}\nسطح تلاش: ${effort}${pauseHint}`;
    keys=paused?[]:[[key('updates:'+chat.id,this.t('🔔 اعلان‌ها')),key('effort:'+chat.id,this.t('🎚 سطح تلاش'))]];
    text+='\n'+this.t('زبان ربات: ')+(this.data.botLanguage==='en'?'English':'فارسی');keys.push([key('language',this.t('🌐 زبان ربات / Bot language'))]);break;
   case 'files':
    text=this.t`<b>📎 فایل‌ها</b>\n\n${context}\n\nبرای ارسال، فایل یا عکس را با کپشن و بدون Reply بفرست. برای دریافت، دکمهٔ «فایل‌های خروجی» یا دستور <code>/get مسیرکامل</code> را استفاده کن.${pauseHint}`;
    keys=paused?[]:[[key('output:'+chat.id,this.t('دریافت فایل‌های خروجی'))]];break;
   case 'control':
    text=this.t`<b>⏯ کنترل و وضعیت</b>\n\nکنترل: ${control}\n${escape(c.status())}\n\nبا توقف، ارسال دستور، پاسخ و فایل موقتاً بسته می‌شود. اعلان‌ها ادامه دارند.`;
    keys=[[key('status',this.t('وضعیت کامل')),key('requests',this.t('درخواست‌های باز'))],[paused?key('resume',this.t('▶ ادامهٔ کنترل')):key('pause',this.t('⏸ توقف کنترل'))]];break;
   case 'help':
    text=this.t('<b>❔ راهنمای Codex در تلگرام</b>\n\nچت را انتخاب کن و پیام عادی بفرست. برای سؤال یا تأیید، از دکمه یا Reply همان پیام استفاده کن. فرم ورود و رمز در خود Codex پاسخ داده می‌شود. برای ساخت چت، در پروژه دکمهٔ چت جدید را بزن.\n\n')+this.groups().map(([label,commands])=>'<b>'+label+'</b>\n'+commands.map(([command,description,args=''])=>'<code>/'+command+args+'</code> — '+description).join('\n')).join('\n\n');
    keys=[];break;
   default:throw new Error('Unknown panel');
  }
  if(section!=='home')keys.push([menuButton(this.t)]);
  return this.panel(text,keys,{messageId,html:true});
 }
}
