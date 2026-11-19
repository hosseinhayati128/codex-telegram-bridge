import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {appToolsAt} from '../ubuntu/runtime.mjs';
import {desktopEntry,launchFiles} from '../ubuntu/launch-files.mjs';
import {trustedPackageFile} from '../ubuntu/refresh.mjs';
import {Desktop} from '../desktop.mjs';

function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-startup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('adapter discovery prefers the stable package path and falls back to a live cache version',t=>{
 const dir=temp(t),home=path.join(dir,'home'),cached=path.join(home,'plugins/cache/openai-bundled/codex-app-tools/1.2/server.mjs'),packaged=path.join(dir,'pkg/codex-app-tools/server.mjs').replaceAll(path.sep,'/');
 for(const file of [cached,packaged]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'');}
 assert.equal(appToolsAt(home,[packaged]),packaged);
 fs.unlinkSync(packaged);assert.equal(appToolsAt(home,[packaged]),cached);
 fs.unlinkSync(cached);assert.equal(appToolsAt(home,[packaged]),undefined);
});

test('automatic qualification refuses a changed user-owned or non-package executable',{skip:process.platform!=='linux'},t=>{
 const file=path.join(temp(t),'codex');fs.writeFileSync(file,'custom');
 assert.throws(()=>trustedPackageFile(file,[]),/not a protected/);
 if(process.getuid?.()!==0)assert.throws(()=>trustedPackageFile(file,[file]),/not a protected/);
});

test('desktop entry preserves metadata and quotes only the launcher path',t=>{
 const dir=temp(t),source='[Desktop Entry]\nName=ChatGPT\nType=Application\nIcon=chatgpt\nExec=chatgpt %U\nMimeType=x-scheme-handler/codex;\n';
 const entry=desktopEntry(source,"/home/a b's/$literal/bridge/start-codex");
 assert.ok(entry.includes('Icon=chatgpt\n'));assert.ok(entry.includes('MimeType=x-scheme-handler/codex;'));
 assert.ok(entry.includes(' %U\n'));assert.ok(entry.includes('\\\\$literal'));
 assert.throws(()=>desktopEntry(source,'/bad\npath'),/control/);
 const file=path.join(dir,'chatgpt.desktop');fs.writeFileSync(file,entry);
 const validation=spawnSync('desktop-file-validate',[file],{encoding:'utf8'});
 if(!validation.error)assert.equal(validation.status,0,validation.stdout+validation.stderr);
});

test('launcher runs preflight before starting the app and stops if preflight fails',{skip:process.platform!=='linux'},t=>{
 const dir=temp(t),app=path.join(dir,'app'),called=path.join(dir,'called');fs.mkdirSync(path.join(dir,'ubuntu'));
 fs.writeFileSync(app,'#!'+process.execPath+'\nrequire("node:fs").writeFileSync('+JSON.stringify(called)+',JSON.stringify({cli:process.env.CODEX_CLI_PATH,args:process.argv.slice(2)}));\n',{mode:0o700});
 const files=launchFiles({root:dir,node:process.execPath,app,codexHome:dir+'/home'});
 const preflight=path.join(dir,'ubuntu/refresh.mjs');fs.writeFileSync(preflight,'process.exit(1);');
 assert.equal(spawnSync('/bin/sh',['-c',files.desktop,'start','literal arg']).status,1);assert.equal(fs.existsSync(called),false);
 fs.writeFileSync(preflight,'');assert.equal(spawnSync('/bin/sh',['-c',files.desktop,'start','literal arg']).status,0);
 assert.deepEqual(JSON.parse(fs.readFileSync(called,'utf8')),{cli:dir+'/codex-telegram-cli',args:['literal arg']});
});

test('refresh preserves pairing, chat settings, and proxy configuration and is idempotent',{skip:process.platform!=='linux'},t=>{
 const dir=temp(t),root=path.join(dir,'bridge'),data=path.join(dir,'data');fs.mkdirSync(path.join(root,'private'),{recursive:true,mode:0o700});fs.mkdirSync(path.join(root,'files'));
 const cli=path.join(dir,'custom-cli');fs.writeFileSync(cli,'unchanged',{mode:0o700});
 const config={platform:'linux',stateRoot:root,transferRoot:root+'/files',codexHome:dir+'/home',runtimeDir:'/run/user/'+process.getuid(),realCli:cli,expectedCliSha256:createHash('sha256').update('unchanged').digest('hex'),appTools:'/deleted/old-adapter.mjs',node:process.execPath,app:'/bin/true',systemctl:'/bin/true',chats:[{id:'kept',title:'kept'}]};
 const file=root+'/bridge-config.json';fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});fs.writeFileSync(root+'/private/ubuntu-pairing.json','pairing-sentinel',{mode:0o600});fs.writeFileSync(root+'/private/state.json','settings-sentinel',{mode:0o600});
 const module=pathToFileURL(path.resolve(import.meta.dirname,'../ubuntu/refresh.mjs')).href;
 const run=()=>spawnSync(process.execPath,['--input-type=module','-e','import {refreshInstallation} from '+JSON.stringify(module)+';console.log(JSON.stringify(await refreshInstallation('+JSON.stringify(root)+')));'],{env:{...process.env,XDG_DATA_HOME:data,HTTPS_PROXY:'http://127.0.0.1:10808'},encoding:'utf8',timeout:15000});
 const first=run();assert.equal(first.status,0,first.stderr);assert.equal(JSON.parse(first.stdout).configurationUpdated,true);
 const updated=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(updated.chats,config.chats);assert.equal(updated.expectedCliSha256,config.expectedCliSha256);
 assert.equal(fs.readFileSync(root+'/private/ubuntu-pairing.json','utf8'),'pairing-sentinel');assert.equal(fs.readFileSync(root+'/private/state.json','utf8'),'settings-sentinel');
 assert.equal(fs.readFileSync(root+'/start-codex','utf8').includes('/ubuntu/refresh.mjs'),true);
 assert.match(fs.readFileSync(data+'/applications/chatgpt.desktop','utf8'),/start-codex/);
 const second=run();assert.equal(second.status,0,second.stderr);assert.equal(JSON.parse(second.stdout).configurationUpdated,false);
});

test('a stale authenticated desktop socket cannot keep a cached client alive',async()=>{
 let closed=false;const d=new Desktop({stateRoot:'/tmp',chats:[],requireLiveEndpoint:true,endpointValidator:()=>false},{data:{},save(){}},async()=>{});
 d.pipe='/tmp/removed-desktop.sock';d.client={close:async()=>{closed=true;}};
 await assert.rejects(()=>d.connect(),/Waiting for Codex/);assert.equal(closed,true);assert.equal(d.pipe,null);
});
