import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {atomicWrite} from './state.mjs';import {taskFingerprint,assertTaskOwned} from './task-ownership.mjs';
import {createUpdateStop,resumeOwnedTask} from './update-guards.mjs';
import {RUNTIME_FILES,prepareTransferStore} from './installation.mjs';
const source=import.meta.dirname,root=path.join(process.env.LOCALAPPDATA,'CodexTelegramBridge'),file=path.join(root,'installation.json'),previous=JSON.parse(fs.readFileSync(file,'utf8'));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),delay=ms=>new Promise(r=>setTimeout(r,ms));
function helper(args){const r=spawnSync(path.join(source,'InstallHost.exe'),args,{windowsHide:true,encoding:'utf8',timeout:15000});if(r.status!==0)throw new Error('Owned bridge update failed: '+args[0]+' ('+r.status+')');return r.stdout;}
const stamp=new Date().toISOString(),receipt={atUtc:stamp,kind:'owned-versioned-bridge-update',previousRelease:previous.release,appRestarted:false};let taskChanged=false,environmentChanged=false,quiesced=false,taskHash=previous.installedTaskFingerprint,next;
const stop=path.join(root,'private/STOP'),marker='Owned bridge update '+stamp+'\n';
try{
 assertTaskOwned(helper(['task-inspect',previous.taskName]),previous.installedTaskFingerprint);
 if(JSON.parse(helper(['env-get']))!==previous.desiredEnvironment)throw new Error('CLI override changed; preserved');
 if(fs.existsSync(stop))throw new Error('Bridge was explicitly stopped; preserved');
 if(Object.entries(previous.files).some(([n,h])=>sha(path.join(previous.release,n))!==h))throw new Error('Installed files changed; preserved');
 prepareTransferStore(root);
 const qualification=fs.readdirSync(path.join(source,'receipts')).filter(n=>/^shim-.*\.json$/.test(n)).sort().reverse().map(n=>JSON.parse(fs.readFileSync(path.join(source,'receipts',n),'utf8'))).find(r=>r.success);
 if(!qualification||Object.entries(qualification.sourceHashes).some(([n,h])=>sha(path.join(source,n))!==h))throw new Error('Current relay build needs actual CLI qualification');
 const release=path.join(root,'releases',stamp.replaceAll(/[:.]/g,'-'));fs.mkdirSync(release,{recursive:true});
 for(const n of RUNTIME_FILES)fs.copyFileSync(path.join(source,n),path.join(release,n),fs.constants.COPYFILE_EXCL);
 const config=JSON.parse(fs.readFileSync(path.join(previous.release,'bridge-config.json'),'utf8'));fs.writeFileSync(path.join(release,'bridge-config.json'),JSON.stringify(config,null,2),{flag:'wx'});fs.copyFileSync(path.join(previous.release,'supervisor.ini'),path.join(release,'supervisor.ini'),fs.constants.COPYFILE_EXCL);
 next={...previous,release,supervisor:path.join(release,'Supervisor.exe'),desiredEnvironment:path.join(release,'CliShim.exe'),previousRelease:previous.release,updatedAtUtc:stamp,qualification:qualification.atUtc,files:Object.fromEntries(fs.readdirSync(release).map(n=>[n,sha(path.join(release,n))]))};
 atomicWrite(path.join(source,'receipts','before-update-'+stamp.replaceAll(/[:.]/g,'-')+'.json'),previous);
 // Quiesce only our Telegram service. The desktop app and native backend stay open.
 const currentState=JSON.parse(fs.readFileSync(path.join(root,'private/state.json'),'utf8'));if(Object.values(currentState.journal).some(x=>['prepared','dispatching','queued'].includes(x.state)))throw new Error('A remote operation is still being dispatched; try after it settles');
 createUpdateStop(stop,marker);quiesced=true;
 const deadline=Date.now()+15000;while(['2','4'].includes(helper(['task-state',previous.taskName]).trim())){if(Date.now()>deadline)throw new Error('Own supervisor did not stop');await delay(400);}
 const updatedXml=helper(['task-update',previous.taskName,next.supervisor,taskHash]);taskChanged=true;taskHash=taskFingerprint(updatedXml);next.installedTaskFingerprint=taskHash;
 helper(['env-set',previous.desiredEnvironment,next.desiredEnvironment]);environmentChanged=true;atomicWrite(file,next);
 if(!resumeOwnedTask({stopFile:stop,marker,taskName:previous.taskName,expectedFingerprint:taskHash,run:helper}))throw new Error('User stop request preserved; updated service remains stopped');
 const readyBy=Date.now()+35000;let health;
 while(Date.now()<readyBy){try{health=JSON.parse(fs.readFileSync(path.join(root,'private/health.json'),'utf8'));if(health.release===release&&Date.parse(health.atUtc)>Date.parse(stamp)&&health.telegramConnected&&health.desktopConnected)break;}catch{}await delay(600);}
 if(!health||health.release!==release||Date.parse(health.atUtc)<=Date.parse(stamp)||!health.telegramConnected||!health.desktopConnected)throw new Error('Updated bridge did not become healthy');
 Object.assign(receipt,{success:true,release,nextVersionManifestMatches:Object.entries(next.files).every(([n,h])=>sha(path.join(release,n))===h),telegramConnected:health.telegramConnected,desktopConnected:health.desktopConnected,nativeConnections:health.nativeConnections,oldReleasePreserved:true});
}catch(error){receipt.success=false;receipt.error=error.message;process.exitCode=1;
 try{if(taskChanged||environmentChanged){if(!fs.existsSync(stop))try{createUpdateStop(stop,marker);}catch(e){if(e.code!=='EEXIST')throw e;}const deadline=Date.now()+15000;while(['2','4'].includes(helper(['task-state',previous.taskName]).trim())){if(Date.now()>deadline)throw new Error('Wait for own service stop');await delay(400);}if(environmentChanged)helper(['env-set',next.desiredEnvironment,previous.desiredEnvironment]);if(taskChanged){const restoredXml=helper(['task-update',previous.taskName,previous.supervisor,taskHash]);previous.installedTaskFingerprint=taskFingerprint(restoredXml);}atomicWrite(file,previous);}
  if(quiesced)receipt.priorServiceResumed=resumeOwnedTask({stopFile:stop,marker,taskName:previous.taskName,expectedFingerprint:previous.installedTaskFingerprint,run:helper});receipt.priorServiceRestored=true;
 }catch{receipt.priorServiceRestored=false;}
}finally{atomicWrite(path.join(source,'receipts','update-'+stamp.replaceAll(/[:.]/g,'-')+'.json'),receipt);console.log(JSON.stringify(receipt,null,2));}
