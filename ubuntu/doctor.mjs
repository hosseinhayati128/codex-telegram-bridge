import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {McpClient} from '../mcp-client.mjs';
import {desktopEndpoint,privateDirectory,verifyInstallation} from './runtime.mjs';

const report={platform:process.platform,ready:false,desktopMetadata:false};
let client;
try {
 if(process.platform!=='linux')throw new Error('Run the doctor on Ubuntu.');
 const root=fs.realpathSync(path.dirname(import.meta.dirname));
 const config=JSON.parse(fs.readFileSync(path.join(root,'bridge-config.json'),'utf8'));
 verifyInstallation(root,config);
 const privateDir=privateDirectory(root);
 const health=JSON.parse(fs.readFileSync(path.join(privateDir,'health.json'),'utf8'));
 const service=spawnSync(config.systemctl,['--user','show','--property=MainPID','--value','codex-telegram-bridge.service'],{encoding:'utf8',timeout:5000});
 report.serviceRunning=service.status===0&&Number(service.stdout.trim())===health.pid&&health.pid>0;
 report.serviceFresh=report.serviceRunning&&health.release===root&&Math.abs(Date.now()-Date.parse(health.atUtc))<45_000;
 report.telegram=health.telegramConnected===true&&Math.abs(Date.now()-Date.parse(health.lastPoll))<30_000;
 report.commandMenu=health.commandMenuReady===true;
 report.nativeConnections=Number(health.nativeConnections)||0;
 report.appToolsLinked=health.appToolsLinked===true;
 if(report.serviceFresh&&report.appToolsLinked){
  const endpoint=JSON.parse(fs.readFileSync(path.join(privateDir,'desktop-connection.json'),'utf8')).pipePath;
  if(!desktopEndpoint(endpoint))throw new Error('The desktop App Tools socket is unavailable.');
  client=new McpClient(config.appTools,endpoint);
  await client.initialize();
  const listing=await client.request('tools/list',{});
  const names=new Set(listing.tools?.map(tool=>tool.name));
  report.requiredTools=['list_projects','list_threads','read_thread','send_message_to_thread','create_thread'].every(name=>names.has(name));
  const result=await client.call('read_thread',{
   threadId:config.callerThreadId,hostId:'local',turnLimit:1,includeOutputs:false,maxOutputCharsPerItem:0,
  },config.callerThreadId);
  report.desktopMetadata=result.thread?.id===config.callerThreadId;
 }
 report.ready=report.serviceFresh&&report.telegram&&report.commandMenu&&report.nativeConnections>0&&report.requiredTools===true&&report.desktopMetadata;
}catch(error){report.error=error.message;}
finally{await client?.close();}
console.log(JSON.stringify(report,null,2));
if(!report.ready)process.exitCode=1;
