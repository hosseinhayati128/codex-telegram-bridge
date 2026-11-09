import {translator} from './i18n.mjs';
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {createInterface} from 'node:readline';
import {loadSecret} from './secrets.mjs';import {startBroker} from './broker.mjs';import {serverHandshake} from './ipc.mjs';import {TelegramApi,sendText} from './telegram.mjs';import {TelegramNative} from './telegram-native.mjs';import {State,atomicWrite} from './state.mjs';import {Desktop} from './desktop.mjs';import {Controller} from './controller.mjs';
import {NativeDelivery} from './delivery.mjs';
import {Attachments} from './attachments.mjs';
import {menuButton} from './bot-ui.mjs';
// The supervisor assigns its kill-on-close job before permitting child creation.
if(process.env.CODEX_TELEGRAM_SUPERVISED==='1')await new Promise((resolve,reject)=>{const reader=createInterface({input:process.stdin});const timer=setTimeout(()=>reject(new Error('Supervisor startup gate unavailable')),10000);reader.once('line',line=>{clearTimeout(timer);reader.close();line==='GO'?resolve():reject(new Error('Invalid supervisor gate'));});});
const root=import.meta.dirname,config=JSON.parse(fs.readFileSync(path.join(root,'bridge-config.json'),'utf8'));
const ubuntu=process.platform==='linux'?await import('./ubuntu/runtime.mjs'):null;
if(ubuntu){
 process.umask(0o077);
 ubuntu.verifyInstallation(root,config);
 config.requireLiveEndpoint=true;
 config.endpointValidator=ubuntu.desktopEndpoint;
}
const privateDir=path.join(config.stateRoot,'private');fs.mkdirSync(privateDir,{recursive:true});const lockFile=path.join(privateDir,'daemon-lock.json'),boot=randomUUID();
if(fs.existsSync(lockFile)){
 let prior;try{prior=JSON.parse(fs.readFileSync(lockFile,'utf8'));}catch{throw new Error('Unrecognized daemon lock; manual review required');}
 let running=false;try{process.kill(prior.pid,0);running=true;}catch(e){if(e.code!=='ESRCH')running=true;}
 if(running)throw new Error('Another bridge daemon is running');fs.renameSync(lockFile,lockFile+'.stale-'+Date.now());
}
fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid,boot}),{flag:'wx',flush:true});
process.on('exit',()=>{try{if(JSON.parse(fs.readFileSync(lockFile,'utf8')).boot===boot)fs.unlinkSync(lockFile);}catch{}});
const pairing=ubuntu?.readPairing(config);
const key=pairing?.key??loadSecret(config.stateRoot,'key'),api=new TelegramApi(pairing?.token??loadSecret(config.stateRoot,'token'));
const owner=pairing?.owner??JSON.parse(fs.readFileSync(path.join(privateDir,'owner.json'),'utf8'));
const botName=(config.botUsername??owner.botUsername)?.toLowerCase();
if(!/^[a-z0-9_]{5,32}$/.test(botName||'')||!owner.userId||String(owner.userId)!==String(owner.chatId)||owner.botUsername?.toLowerCase()!==botName)throw new Error('Existing private owner pairing is invalid');
let seed=pairing?.offset??0;
if(!pairing)try{seed=JSON.parse(fs.readFileSync(path.join(privateDir,'offset.json'),'utf8')).lastUpdateId+1;}catch{}
const state=new State(path.join(privateDir,'state.json'),{offset:seed});
const t=translator(()=>state.data.botLanguage);
const title=id=>config.chats.find(c=>c.id===id)?.title||id;
const attachments=new Attachments({config,state,api,chatId:String(owner.chatId)});
const notify=(text,meta={})=>{const keys=meta.threadId?attachments.buttons(meta.threadId,text,meta.cwd):[];return sendText(api,String(owner.chatId),text,keys.length?{reply_markup:{inline_keyboard:keys}}:{});};
const native=new TelegramNative({api,chatId:String(owner.chatId),title,language:()=>state.data.botLanguage});
const desktop=new Desktop(config,state,notify),delivery=new NativeDelivery(native),connections=new Map(),operations=new Map(),tickets=new Map();
desktop.onWatch=threadIds=>{for(const c of connections.values())if(c.enabled&&c.watchProtocol===1)try{c.channel.send({type:'watch-threads',threadIds});}catch{c.channel.close();}};
let queue=Promise.resolve(),telegramConnected=false,lastPoll=null,lastError=null,stopping=false,commandMenuReady=false,nextMenuSync=0;
const enqueue=fn=>{queue=queue.then(fn).catch(()=>{lastError='telegram-delivery-unavailable';});};
const status=()=>t`سرویس تلگرام: ${telegramConnected?t('متصل'):t('در حال اتصال مجدد')}\nچت‌های کدکس: ${desktop.connected?t('متصل'):t('در انتظار بازشدن/اتصال کدکس')}\nپاسخ بومی: ${[...connections.values()].some(c=>c.enabled)?t('متصل؛ آزمون داخل اپ جداگانه بررسی می‌شود'):t('در انتظار فعال‌سازی و ری‌استارت کدکس')}`;
const remote=op=>new Promise((resolve,reject)=>{
 const c=connections.get(op.route);if(!c?.enabled||c.generation!==op.generation){reject(new Error('Native backend no longer available'));return;}
 const operation=randomUUID(),timer=setTimeout(()=>{operations.delete(operation);reject(new Error('Native response delivery uncertain'));},8000);
 operations.set(operation,{resolve,reject,timer,route:op.route});try{c.channel.send({type:'answer',operation,ticket:op.ticket,input:op.input});}catch{clearTimeout(timer);operations.delete(operation);reject(new Error('Native response delivery uncertain'));}
});
const controller=new Controller({api,owner,chats:config.chats,state,native,desktop,attachments,remote,status});
const acceptConnection=async stream=>{
 try{const channel=await serverHandshake(stream,key),route=randomUUID();let registered=false;
  channel.on('message',m=>{
   if(!registered){if(m?.type!=='hello'||typeof m.generation!=='string'){channel.close();return;}registered=true;
    const enabled=m.nativeEnabled===true&&m.cliHash===config.expectedCliSha256;
    const endpoint=ubuntu&&!ubuntu.desktopEndpoint(m.appToolsPipe)?null:m.appToolsPipe;
    if(ubuntu&&!endpoint){channel.close();return;}
    connections.set(route,{channel,generation:m.generation,enabled,watchProtocol:m.watchProtocol,endpoint});
    if(enabled&&m.watchProtocol===1)channel.send({type:'watch-threads',threadIds:config.chats.map(c=>c.id)});
    if(endpoint)desktop.attach(endpoint).catch(()=>{});
    desktop.outbox.add('connection:'+m.generation,enabled?t('واسط بومی کدکس متصل شد. سؤال‌ها و تأییدهای پشتیبانی‌شده در همین ربات نمایش داده می‌شوند.'):t('نسخهٔ CLI با نسخهٔ آزموده‌شده برابر نیست؛ پاسخ بومی فعلاً غیرفعال است و خود کدکس به کار ادامه می‌دهد.'));
    return;
   }
   if(m?.type==='answer-result'){
    const op=operations.get(m.operation);if(op?.route===route){clearTimeout(op.timer);operations.delete(m.operation);op.resolve({state:m.state});}return;
   }
   if(m?.type!=='native'||!connections.get(route)?.enabled)return;
   const event=m.event;
   if(event?.type==='request'&&config.chats.some(c=>c.id===event.request?.threadId)&&event.request.generation===connections.get(route).generation){
    tickets.set(event.request.ticket,route);delivery.track(event.request,route);if(telegramConnected)enqueue(()=>delivery.flush());
   }else if(event?.type==='resolved'&&tickets.get(event.ticket)===route){tickets.delete(event.ticket);delivery.resolve(event.ticket).catch(()=>{});}
   else if(event?.type==='desktop-only'&&config.chats.some(c=>c.id===event.threadId))desktop.outbox.add('local-form:'+randomUUID(),t`${title(event.threadId)}\nاین فرم بومی در تلگرام قابل پاسخ نیست؛ در خود کدکس پاسخ بده.`);
  });
  channel.on('close',()=>{
   const endpoint=connections.get(route)?.endpoint;
   connections.delete(route);
   if(ubuntu&&endpoint&&![...connections.values()].some(c=>c.endpoint===endpoint))desktop.detach(endpoint).catch(()=>{});
   for(const[t,r]of tickets)if(r===route)tickets.delete(t);
   delivery.disconnect(route).catch(()=>{});
   for(const[id,op]of operations)if(op.route===route){clearTimeout(op.timer);operations.delete(id);op.reject(new Error('Backend disconnected; response uncertain'));}
  });
 }catch{stream.destroy();}
};
const broker=ubuntu?await ubuntu.startBroker(config,acceptConnection):startBroker(path.join(root,'PipeBroker.exe'),config.pipeName,acceptConnection);
broker.on('error',()=>process.exit(1));broker.on('exit',()=>{if(!stopping)process.exit(1);});
function health(){atomicWrite(path.join(privateDir,'health.json'),{version:1,release:root,pid:process.pid,boot,atUtc:new Date().toISOString(),telegramConnected,lastPoll,desktopConnected:desktop.connected,appToolsLinked:!!desktop.pipe,nativeConnections:[...connections.values()].filter(c=>c.enabled).length,pendingRequests:native.active.size,pendingFiles:controller.filePending,lastError,paused:!!state.data.paused,commandMenuReady});}
health();const heartbeat=setInterval(health,10000);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function pollTelegram(){let verified=false,backoff=1000,announced=false;
 while(!stopping){try{
  if(!verified){const me=await api.call('getMe');if(me.username?.toLowerCase()!==botName)throw new Error('Bot identity mismatch');const hook=await api.call('getWebhookInfo');if(hook.url)throw new Error('Existing Telegram webhook must be preserved');verified=true;}
  telegramConnected=true;
  if((!commandMenuReady||state.data.commandMenuLanguage!==state.data.botLanguage)&&Date.now()>=nextMenuSync){nextMenuSync=Date.now()+60000;controller.ui.registerCommands().then(ok=>{commandMenuReady=ok===true;}).catch(()=>{});}
  if(!announced){announced=true;enqueue(()=>controller.ui.panel(t`🟢 سرویس تلگرام Codex فعال است.\n\n${status()}\n\nبرای انتخاب چت یا تنظیمات، منوی اصلی را باز کن.${Object.values(state.data.journal).some(x=>x.state==='uncertain')?t('\nاز اجرای قبلی تحویل نامشخص باقی مانده؛ هیچ دستوری دوباره اجرا نشده است.'):''}`,[[menuButton(t)]]));}
  const updates=await api.call('getUpdates',{offset:state.data.offset,timeout:5,allowed_updates:['message','callback_query']});lastPoll=new Date().toISOString();lastError=null;backoff=1000;
  enqueue(()=>delivery.flush());for(const update of updates)await controller.update(update);
 }catch{telegramConnected=false;lastError='telegram-unavailable-or-delivery-uncertain';await sleep(backoff);backoff=Math.min(30000,backoff*2);}}
}
async function pollDesktop(){while(!stopping){await desktop.poll();await sleep(6500);}}
const shutdown=()=>{if(stopping)return;stopping=true;clearInterval(heartbeat);for(const c of connections.values())c.channel.close();if(ubuntu)broker.close();else broker.stdin.end();desktop.client?.close().catch(()=>{});setTimeout(()=>process.exit(0),2000).unref();};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
await Promise.all([pollTelegram(),pollDesktop()]);
