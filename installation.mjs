import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {atomicWrite} from './state.mjs';
import {taskFingerprint,assertTaskOwned} from './task-ownership.mjs';
const source=import.meta.dirname,taskName='Codex Telegram Bridge';
export const RUNTIME_FILES=['CliShim.exe','Supervisor.exe','SecretTool.exe','PipeBroker.exe','InstallHost.exe','launcher.ini','stdio-relay.mjs','wire.mjs','framing.mjs','native-requests.mjs','secrets.mjs','ipc.mjs','broker.mjs','daemon.mjs','telegram.mjs','telegram-format.mjs','telegram-native.mjs','controller.mjs','bot-ui.mjs','chat-menu.mjs','attachments.mjs','images.mjs','desktop.mjs','mcp-client.mjs','state.mjs','network.mjs','installation.mjs','control.mjs','delivery.mjs','i18n.mjs','task-ownership.mjs','README.md'];
function helper(root,args){const r=spawnSync(path.join(root,'InstallHost.exe'),args,{encoding:'utf8',windowsHide:true,timeout:20000,stdio:['ignore','pipe','pipe']});if(r.status!==0)throw new Error('Current-user installation action failed ('+args[0]+', '+r.status+')');return r.stdout;}
const sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
export function prepareTransferStore(stateRoot){const root=path.join(process.env.LOCALAPPDATA,'CodexTelegramFiles'),recordFile=path.join(stateRoot,'private/transfer-store.json');
 const ps=code=>{const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];const r=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-Command',code],{env,windowsHide:true,encoding:'utf8',timeout:10000});if(r.status!==0)throw new Error('Cannot inspect transfer directory permissions');return r.stdout.trim();};
 const quote=s=>"'"+s.replaceAll("'","''")+"'",acl=()=>createHash('sha256').update(ps(`(Get-Acl -LiteralPath ${quote(root)}).Sddl`)).digest('hex');
 if(fs.existsSync(root)){if(!fs.existsSync(recordFile))throw new Error('Existing transfer directory preserved; no ownership receipt');const old=JSON.parse(fs.readFileSync(recordFile,'utf8'));if(old.root!==root||old.aclFingerprint!==acl())throw new Error('Transfer directory permissions changed; preserved');return root;}
 const sid=spawnSync('C:/Windows/System32/whoami.exe',['/user','/fo','csv','/nh'],{windowsHide:true,encoding:'utf8'}).stdout.match(/S-1-5-[\d-]+/)?.[0],groupSid=ps("(Get-LocalGroup -Name 'CodexSandboxUsers' -ErrorAction Stop).SID.Value");if(!sid||!/^S-1-5-[\d-]+$/.test(groupSid))throw new Error('Existing Codex sandbox group unavailable');fs.mkdirSync(root);
 const record={root,createdAtUtc:new Date().toISOString(),sandboxGroup:'CodexSandboxUsers',sandboxRights:'ReadAndExecute',stage:'created'};atomicWrite(recordFile,record);
 const r=spawnSync('C:/Windows/System32/icacls.exe',[root,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F','*'+groupSid+':(OI)(CI)RX'],{windowsHide:true,encoding:'utf8'});if(r.status!==0)throw new Error('Cannot protect dedicated transfer directory');atomicWrite(recordFile,{...record,stage:'permissions-applied'});atomicWrite(recordFile,{...record,stage:'ready',aclFingerprint:acl()});return root;
}
export function install(){
 const config=JSON.parse(fs.readFileSync(path.join(source,'bridge-config.json'),'utf8'));
 const evidence=fs.readdirSync(path.join(source,'receipts')).filter(n=>/^shim-.*\.json$/.test(n)).sort().reverse().map(n=>JSON.parse(fs.readFileSync(path.join(source,'receipts',n),'utf8'))).find(r=>r.success);
 if(!evidence||Object.entries(evidence.sourceHashes).some(([n,h])=>sha(path.join(source,n))!==h))throw new Error('Actual compiled shim must pass qualification for this source/build');
 const oldEnvironment=JSON.parse(helper(source,['env-get'])),oldTask=helper(source,['task-inspect',taskName]);
 if(oldEnvironment!==null||oldTask!=='ABSENT')throw new Error('Existing CLI override/startup task was preserved; inspect it before installation');
 const deploymentRoot=path.join(process.env.LOCALAPPDATA,'CodexTelegramBridge');if(fs.existsSync(deploymentRoot)&&fs.readdirSync(deploymentRoot).length)throw new Error('An existing installation directory was preserved');
 const release=path.join(deploymentRoot,'releases',new Date().toISOString().replaceAll(/[:.]/g,'-'));fs.mkdirSync(release,{recursive:true});fs.mkdirSync(path.join(deploymentRoot,'private'),{recursive:true});
 const files=RUNTIME_FILES;
 for(const n of files)fs.copyFileSync(path.join(source,n),path.join(release,n),fs.constants.COPYFILE_EXCL);
 const configured={...config,stateRoot:deploymentRoot};fs.writeFileSync(path.join(release,'bridge-config.json'),JSON.stringify(configured,null,2),{flag:'wx'});fs.writeFileSync(path.join(release,'supervisor.ini'),[config.node,deploymentRoot].join('\r\n'),{flag:'wx'});
 const sid=spawnSync('C:/Windows/System32/whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).stdout.match(/S-1-5-[\d-]+/)?.[0];if(!sid)throw new Error('Cannot identify current-user ACL');
 const acl=spawnSync('C:/Windows/System32/icacls.exe',[deploymentRoot,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],{encoding:'utf8',windowsHide:true});if(acl.status!==0)throw new Error('Cannot protect installation directory');
 // Protect the destination before copying the existing encrypted pairing state.
 const spike=path.resolve(source,'../telegram-spike/private');for(const n of ['telegram.dpapi','owner.json','offset.json','desktop-connection.json'])fs.copyFileSync(path.join(spike,n),path.join(deploymentRoot,'private',n),fs.constants.COPYFILE_EXCL);
 const secret=spawnSync(path.join(release,'SecretTool.exe'),['--create-key',path.join(deploymentRoot,'private/ipc.dpapi')],{windowsHide:true,stdio:'ignore'});if(secret.status!==0)throw new Error('Cannot create current-user protected IPC secret');
 prepareTransferStore(deploymentRoot);
 const desired=path.join(release,'CliShim.exe'),supervisor=path.join(release,'Supervisor.exe');
 const receipt={version:1,atUtc:new Date().toISOString(),deploymentRoot,release,source,taskName,supervisor,desiredEnvironment:desired,priorEnvironment:oldEnvironment,priorTask:oldTask,files:Object.fromEntries(fs.readdirSync(release).map(n=>[n,sha(path.join(release,n))])),nativeAppE2E:'pending-user-controlled-restart',qualification:evidence.atUtc,state:'prepared'};
 atomicWrite(path.join(deploymentRoot,'installation.json'),receipt);
 for(const action of ['status','start','stop','rollback'])fs.writeFileSync(path.join(deploymentRoot,`${action}-telegram-bridge.cmd`),`@echo off\r\n"${config.node}" "${path.join(release,'control.mjs')}" ${action}\r\npause\r\n`,{flag:'wx'});
 try{
  helper(source,['task-register',taskName,supervisor]);receipt.installedTaskFingerprint=taskFingerprint(helper(source,['task-inspect',taskName]));receipt.state='task-registered';atomicWrite(path.join(deploymentRoot,'installation.json'),receipt);
  helper(source,['env-set','--absent',desired]);receipt.state='restart-pending';atomicWrite(path.join(deploymentRoot,'installation.json'),receipt);
  helper(source,['task-start',taskName]);
 }catch(e){receipt.installError=e.message;atomicWrite(path.join(deploymentRoot,'installation.json'),receipt);try{rollback(deploymentRoot);receipt.state='install-failed-rolled-back';}catch{receipt.state='install-failed-needs-review';}atomicWrite(path.join(deploymentRoot,'installation.json'),receipt);throw e;}
 const xml=helper(source,['task-inspect',taskName]);if(!xml.includes(supervisor))throw new Error('Startup task readback differs');
 atomicWrite(path.join(source,'receipts/installation-'+receipt.atUtc.replaceAll(/[:.]/g,'-')+'.json'),receipt);return{installed:true,root:deploymentRoot,release,startupTask:true,cliOverridePendingRestart:true,appRestarted:false};
}
export function rollback(root=path.join(process.env.LOCALAPPDATA,'CodexTelegramBridge')){
 const receipt=JSON.parse(fs.readFileSync(path.join(root,'installation.json'),'utf8'));if(path.resolve(receipt.deploymentRoot)!==path.resolve(root))throw new Error('Installation receipt/root mismatch');
 const current=JSON.parse(helper(receipt.release,['env-get']));if(current!==receipt.desiredEnvironment&&current!==receipt.priorEnvironment)throw new Error('CLI override changed after installation; it was preserved');
 const xml=helper(receipt.release,['task-inspect',receipt.taskName]);if(xml!=='ABSENT')assertTaskOwned(xml,receipt.installedTaskFingerprint);
 fs.writeFileSync(path.join(root,'private/STOP'),'User requested rollback\n',{flush:true});
 if(current===receipt.desiredEnvironment)helper(receipt.release,['env-set',receipt.desiredEnvironment,receipt.priorEnvironment??'--absent']);
 if(xml!=='ABSENT')helper(receipt.release,['task-delete',receipt.taskName,receipt.supervisor,receipt.installedTaskFingerprint]);
 receipt.rolledBackAtUtc=new Date().toISOString();receipt.state='rolled-back';atomicWrite(path.join(root,'installation.json'),receipt);return{restored:true,historyDeleted:false,appRestarted:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){try{console.log(JSON.stringify(process.argv[2]==='install'?install():process.argv[2]==='rollback'?rollback():{usage:'installation.mjs install|rollback'},null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
