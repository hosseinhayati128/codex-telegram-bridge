import fs from 'node:fs';import {assertTaskOwned} from './task-ownership.mjs';
export function createUpdateStop(file,marker){fs.writeFileSync(file,marker,{flag:'wx',flush:true});}
export function resumeOwnedTask({stopFile,marker,taskName,expectedFingerprint,run}){
 assertTaskOwned(run(['task-inspect',taskName]),expectedFingerprint);
 if(!fs.existsSync(stopFile)||fs.readFileSync(stopFile,'utf8')!==marker)return false;
 fs.unlinkSync(stopFile);run(['task-start',taskName,expectedFingerprint]);return true;
}
