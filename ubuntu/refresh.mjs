import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {CliRpc} from '../cli-rpc.mjs';
import {atomicWrite} from '../state.mjs';
import {appToolsAt,checkIsolation,sandboxArgs,verifyInstallation} from './runtime.mjs';
import {desktopEntry,launchFiles} from './launch-files.mjs';

const unit='codex-telegram-bridge.service';
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function trustedPackageFile(file,packageFiles){
 const real=fs.realpathSync(file),info=fs.statSync(real);
 if(!packageFiles.includes(real)||!info.isFile()||info.uid!==0||(info.mode&0o022))throw new Error('Changed CLI is not a protected ChatGPT package file. Run setup with --cli after reviewing this custom installation.');
 return real;
}

function writeOwned(file,text,mode){
 if(fs.existsSync(file)){
  const info=fs.lstatSync(file);
  if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o022))throw new Error('Refusing to replace an unsafe launcher: '+file);
  if(fs.readFileSync(file,'utf8')===text)return;
 }
 const temp=file+'.next-'+randomUUID();
 try{fs.writeFileSync(temp,text,{flag:'wx',mode,flush:true});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}

export async function refreshInstallation(root){
 if(process.platform!=='linux'||process.getuid()===0)throw new Error('Run as the Ubuntu desktop user.');
 const file=path.join(root,'bridge-config.json'),info=fs.lstatSync(file);
 if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o022))throw new Error('Unexpected configuration file permissions.');
 const original=fs.readFileSync(file,'utf8'),config=JSON.parse(original);
 verifyInstallation(root,config);
 const packageList=spawnSync('/usr/bin/dpkg-query',['-L','chatgpt'],{encoding:'utf8',timeout:5000});
 if(packageList.status!==0)throw new Error('The ChatGPT desktop package is unavailable.');
 const packageFiles=packageList.stdout.split('\n');
 const adapter=fs.existsSync(config.appTools)?config.appTools:appToolsAt(config.codexHome,packageFiles);
 if(!adapter)throw new Error('ChatGPT App Tools is missing. Repair the desktop package before launching.');
 config.appTools=fs.realpathSync(adapter);
 const fingerprint=hash(config.realCli);
 if(fingerprint!==config.expectedCliSha256){
  trustedPackageFile(config.realCli,packageFiles);
  checkIsolation(config);
  const cli=new CliRpc({executable:config.bubblewrap,args:sandboxArgs(config,config.realCli,['app-server','--listen','stdio://']),cwd:root});
  try{
   await cli.initialize();
   const result=await cli.request('model/list',{limit:1},10000);
   if(!Array.isArray(result.data)||!result.data.length)throw new Error('Updated CLI returned an invalid model catalog.');
  }finally{await cli.close();}
  if(hash(config.realCli)!==fingerprint)throw new Error('The CLI changed during qualification; try launching again after the update finishes.');
  config.expectedCliSha256=fingerprint;
 }
 const files=launchFiles({root,node:config.node,app:config.app,codexHome:config.codexHome});
 writeOwned(path.join(root,'codex-telegram-cli'),files.cli,0o700);
 writeOwned(path.join(root,'start-codex'),files.desktop,0o700);
 const applications=path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),'applications');
 fs.mkdirSync(applications,{recursive:true});
 const entry=path.join(applications,'chatgpt.desktop');
 const source=fs.existsSync(entry)?fs.readFileSync(entry,'utf8'):fs.readFileSync('/usr/share/applications/chatgpt.desktop','utf8');
 if(fs.existsSync(entry)&&!fs.existsSync(path.join(root,'private/chatgpt.desktop.before-bridge')))fs.copyFileSync(entry,path.join(root,'private/chatgpt.desktop.before-bridge'),fs.constants.COPYFILE_EXCL);
 writeOwned(entry,desktopEntry(source,path.join(root,'start-codex')),0o644);
 const changed=JSON.stringify(config)!==JSON.stringify(JSON.parse(original));
 if(changed){
  if(fs.readFileSync(file,'utf8')!==original)throw new Error('Bridge configuration changed during refresh; try again.');
  if(!fs.existsSync(path.join(root,'private/bridge-config.before-refresh.json')))fs.copyFileSync(file,path.join(root,'private/bridge-config.before-refresh.json'),fs.constants.COPYFILE_EXCL);
  atomicWrite(file,config);
 }
 const service=spawnSync(config.systemctl,['--user',changed?'restart':'start',unit],{encoding:'utf8',timeout:15000});
 if(service.status!==0)throw new Error('Cannot start the user bridge service. Run systemctl --user status '+unit+' in the desktop terminal.');
 return {configurationUpdated:changed,desktopEntry:entry,cliQualified:fingerprint===config.expectedCliSha256};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const root=fs.realpathSync(path.dirname(import.meta.dirname));
 refreshInstallation(root).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
