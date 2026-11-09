const key=(action,text)=>({text,callback_data:'ui:'+action});
export const MENU_BUTTON=Object.freeze(key('home','⌂ منوی اصلی'));
const escape=text=>String(text).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);
const sections=['home','chats','settings','files','control','help'];
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
 constructor(controller){this.c=controller;this.data=controller.state.data;this.data.uiPanels??=[];}
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
  if(extra===undefined&&Object.hasOwn(scoped,action)&&this.c.chats.some(c=>c.id===threadId))return{kind:scoped[action],threadId};
  throw new Error('Unknown menu action or chat');
 }
 registerCommands(){return this.c.api.call('setMyCommands',{scope:{type:'chat',chat_id:String(this.c.owner.chatId)},commands:BOT_COMMANDS});}
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
   context='چت انتخاب‌شده: <b>'+title+'</b>',effort=escape(c.thinking(chat.id)||'تنظیم خود Codex'),updates=escape(c.updatesLabel(chat.id)),
   control=paused?'⏸ متوقف':'🟢 فعال',pauseHint=paused?'\n\nبرای استفاده از دکمه‌های این بخش، از «کنترل» ادامه را بزن.':'';
  let text,keys;
  switch(section){
   case 'home':
    text=`<b>Codex | منوی اصلی</b>\n\n${context}\nاعلان‌ها: ${updates}\nسطح تلاش: ${effort}\nکنترل: ${control}\n\n${paused?'برای ادامهٔ ارسال دستور، «کنترل و وضعیت» را باز کن.':'یک بخش را انتخاب کن.'}`;
    keys=[[key('chats','💬 چت‌ها'),key('settings','⚙ تنظیمات')],[key('files','📎 فایل‌ها'),key('control','⏯ کنترل و وضعیت')],[key('help','❔ راهنما')]];break;
   case 'chats':
    text=`<b>💬 چت‌ها</b>\n\n${context}\n\nبرای عوض‌کردن چت، پروژه یا فهرست اخیر را باز کن. برای ساخت چت جدید، وارد پروژه‌اش شو.${pauseHint}`;
    keys=paused?[]:[[key('projects','📁 پروژه‌ها'),key('recent','🕘 چت‌های اخیر')],[key('last:'+chat.id,'آخرین پاسخ')]];break;
   case 'settings':
    text=`<b>⚙ تنظیمات همین چت</b>\n\n${context}\nاعلان‌ها: ${updates}\nسطح تلاش: ${effort}${pauseHint}`;
    keys=paused?[]:[[key('updates:'+chat.id,'🔔 اعلان‌ها'),key('effort:'+chat.id,'🎚 سطح تلاش')]];break;
   case 'files':
    text=`<b>📎 فایل‌ها</b>\n\n${context}\n\nبرای ارسال، فایل یا عکس را با کپشن و بدون Reply بفرست. برای دریافت، دکمهٔ «فایل‌های خروجی» یا دستور <code>/get مسیرکامل</code> را استفاده کن.${pauseHint}`;
    keys=paused?[]:[[key('output:'+chat.id,'دریافت فایل‌های خروجی')]];break;
   case 'control':
    text=`<b>⏯ کنترل و وضعیت</b>\n\nکنترل: ${control}\n${escape(c.status())}\n\nبا توقف، ارسال دستور، پاسخ و فایل موقتاً بسته می‌شود. اعلان‌ها ادامه دارند.`;
    keys=[[key('status','وضعیت کامل'),key('requests','درخواست‌های باز')],[paused?key('resume','▶ ادامهٔ کنترل'):key('pause','⏸ توقف کنترل')]];break;
   case 'help':
    text='<b>❔ راهنمای Codex در تلگرام</b>\n\nچت را انتخاب کن و پیام عادی بفرست. برای سؤال یا تأیید، از دکمه یا Reply همان پیام استفاده کن. فرم ورود و رمز در خود Codex پاسخ داده می‌شود. برای ساخت چت، در پروژه دکمهٔ چت جدید را بزن.\n\n'+groups.map(([label,commands])=>'<b>'+label+'</b>\n'+commands.map(([command,description,args=''])=>'<code>/'+command+args+'</code> — '+description).join('\n')).join('\n\n');
    keys=[];break;
   default:throw new Error('Unknown panel');
  }
  if(section!=='home')keys.push([MENU_BUTTON]);
  return this.panel(text,keys,{messageId,html:true});
 }
}
