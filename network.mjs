import {spawnSync,spawn} from 'node:child_process';import path from 'node:path';
export function proxyEnvironment(base=process.env){const env={...base};if(env.HTTPS_PROXY||env.https_proxy)return env;
 const r=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-Command',"$p=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; if($p.ProxyEnable -eq 1){Write-Output $p.ProxyServer}"],{windowsHide:true,encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']});
 const value=(r.stdout||'').trim();let proxy=value;if(value.includes('=')){const pairs=Object.fromEntries(value.split(';').map(s=>s.split('=')));proxy=pairs.https||pairs.http;}
 if(proxy&&/^(?:https?:\/\/)?(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):\d+$/.test(proxy)){env.HTTPS_PROXY=/^https?:/.test(proxy)?proxy:'http://'+proxy;env.HTTP_PROXY=env.HTTPS_PROXY;env.NO_PROXY='localhost,127.0.0.1,::1';}return env;
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const child=spawn(process.execPath,['--use-env-proxy',path.join(import.meta.dirname,'daemon.mjs')],{env:proxyEnvironment(),windowsHide:true,stdio:'inherit'});child.on('error',()=>process.exit(1));child.on('exit',code=>process.exit(code??1));
}
