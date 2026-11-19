import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {CliRpc} from './cli-rpc.mjs';

const pending=new WeakMap();
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const resources=root=>({
 realCli:path.win32.join(root,'app','resources','codex.exe'),
 appTools:path.win32.join(root,'app','resources','plugins','openai-bundled','plugins','codex-app-tools','server.mjs'),
});

export function packageRuntime(pkg,programFiles=process.env.ProgramFiles){
 if(!programFiles||!pkg||pkg.Name!=='OpenAI.Codex'||pkg.PublisherId!=='2p2nqsd0c76g0'||
  pkg.SignatureKind!=='Store'||pkg.Status!=='Ok'||typeof pkg.InstallLocation!=='string')throw new Error('Codex Store package is unavailable');
 const root=path.win32.resolve(pkg.InstallLocation),parent=path.win32.join(programFiles,'WindowsApps');
 if(path.win32.dirname(root).toLowerCase()!==parent.toLowerCase()||
  !/^OpenAI\.Codex_[\d.]+_x64__2p2nqsd0c76g0$/i.test(path.win32.basename(root)))throw new Error('Unexpected Codex package location');
 return resources(root);
}

function discoverWindowsPackage(config){
 const parent=path.win32.join(process.env.ProgramFiles,'WindowsApps')+'\\';
 const original=path.win32.resolve(config.realCli??'');
 // Custom CLI installations continue to use their explicitly qualified configuration.
 if(!original.toLowerCase().startsWith(parent.toLowerCase())||!original.toLowerCase().endsWith('\\app\\resources\\codex.exe'))return null;
 const env={...process.env};
 for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
 const query="$ErrorActionPreference='Stop'; $p=@(Get-AppxPackage -Name OpenAI.Codex); if($p.Count -ne 1){exit 2}; $p[0] | Select-Object Name,PublisherId,InstallLocation,@{n='SignatureKind';e={$_.SignatureKind.ToString()}},@{n='Status';e={$_.Status.ToString()}} | ConvertTo-Json -Compress";
 const result=spawnSync(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
  ['-NoProfile','-NonInteractive','-Command',query],{windowsHide:true,encoding:'utf8',env,timeout:15000,maxBuffer:32768});
 if(result.status!==0)throw new Error('Cannot discover the installed Codex Store package');
 return packageRuntime(JSON.parse(result.stdout));
}

function regularFile(file){
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
  fs.realpathSync(file).toLowerCase()!==path.resolve(file).toLowerCase())throw new Error('Expected a regular unlinked package file');
}

async function qualifyWindowsCli(file,cwd){
 const env={...process.env};
 delete env.CODEX_WINDOWS_REGISTERED_CORE;
 delete env.CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY;
 delete env.CODEX_TELEGRAM_REAL_CLI;
 const sandbox=spawnSync(file,['sandbox','--',path.join(process.env.SystemRoot,'System32','cmd.exe'),'/d','/c','echo CODEX_BRIDGE_SANDBOX_OK'],
  {cwd,env,windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:65536});
 if(sandbox.status!==0||sandbox.stdout.trim()!=='CODEX_BRIDGE_SANDBOX_OK')throw new Error('Updated Codex CLI failed Windows sandbox qualification');
 const client=new CliRpc({executable:file,args:['app-server'],cwd,env});
 try{
  await client.initialize();
  const result=await client.request('model/list',{limit:1},10000);
  if(!Array.isArray(result.data)||!result.data.length)throw new Error('Updated Codex CLI returned an invalid model catalog');
 }finally{await client.close();}
}

export function refreshWindowsRuntime(config,{discover=discoverWindowsPackage,qualify=qualifyWindowsCli}={}){
 if(pending.has(config))return pending.get(config);
 const refresh=(async()=>{
  const candidate=await discover(config);
  if(!candidate)return false;
  regularFile(candidate.realCli);
  regularFile(candidate.appTools);
  const hash=sha(candidate.realCli),adapterHash=sha(candidate.appTools);
  const changed=config.realCli!==candidate.realCli||config.appTools!==candidate.appTools||config.expectedCliSha256!==hash;
  if(!changed)return false;
  if(config.expectedCliSha256!==hash)await qualify(candidate.realCli,config.stateRoot);
  regularFile(candidate.realCli);
  regularFile(candidate.appTools);
  if(sha(candidate.realCli)!==hash||sha(candidate.appTools)!==adapterHash)throw new Error('Codex package changed during qualification');
  // Keep installed receipts and rollback hashes intact by refreshing only the running configuration.
  Object.assign(config,candidate,{expectedCliSha256:hash});
  return true;
 })();
 pending.set(config,refresh);
 refresh.finally(()=>{if(pending.get(config)===refresh)pending.delete(config);}).catch(()=>{});
 return refresh;
}
