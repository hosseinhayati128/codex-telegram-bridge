import {spawnSync} from 'node:child_process';import path from 'node:path';
export function loadSecret(root,kind,binaryRoot=import.meta.dirname){
 const file=path.join(root,'private',kind==='key'?'ipc.dpapi':'telegram.dpapi');
 const r=spawnSync(path.join(binaryRoot,'SecretTool.exe'),[kind==='key'?'--read-key':'--read-token',file],{windowsHide:true,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']});
 if(r.status!==0)throw new Error('Cannot unlock local protected credential');
 if(kind==='key'){const key=Buffer.from(r.stdout,'base64');if(key.length!==32)throw new Error('Invalid protected IPC key');return key;}
 if(!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(r.stdout))throw new Error('Invalid protected Telegram token');return r.stdout;
}
