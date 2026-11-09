import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {rollback} from './installation.mjs';
const root=path.join(process.env.LOCALAPPDATA,'CodexTelegramBridge'),file=path.join(root,'installation.json'),i=JSON.parse(fs.readFileSync(file,'utf8'));
const helper=args=>{const r=spawnSync(path.join(i.release,'InstallHost.exe'),args,{windowsHide:true,encoding:'utf8',timeout:15000});if(r.status!==0)throw new Error('Current-user task control failed');};
switch(process.argv[2]){
 case 'status':{const h=JSON.parse(fs.readFileSync(path.join(root,'private/health.json'),'utf8'));console.log(JSON.stringify({...h,heartbeatFresh:Date.now()-Date.parse(h.atUtc)<90000,cliOverridePendingRestart:i.state==='restart-pending'},null,2));break;}
 case 'stop':fs.writeFileSync(path.join(root,'private/STOP'),'User requested bridge stop\n',{flush:true});console.log('Bridge stopping; Codex chats stay open.');break;
 case 'start':if(fs.existsSync(path.join(root,'private/STOP')))fs.unlinkSync(path.join(root,'private/STOP'));helper(['task-start',i.taskName]);console.log('Bridge startup requested.');break;
 case 'rollback':console.log(JSON.stringify(rollback(root),null,2));break;
 default:console.log('control.mjs status|stop|start|rollback');
}
