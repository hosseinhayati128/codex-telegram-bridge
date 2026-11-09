import {createHash} from 'node:crypto';
export function taskFingerprint(xml){return createHash('sha256').update(xml,'utf8').digest('hex');}
export function assertTaskOwned(xml,expected){if(typeof expected!=='string'||taskFingerprint(xml)!==expected)throw new Error('Startup task changed after installation; it was preserved');}
