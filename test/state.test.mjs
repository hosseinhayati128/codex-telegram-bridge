import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {State} from '../state.mjs';
const fixture=()=>{const root=path.resolve(import.meta.dirname,'../private/test-state');fs.mkdirSync(root,{recursive:true});return new State(path.join(fs.mkdtempSync(path.join(root,'case-')),'state.json'));};
test('command journal freezes target and never replays uncertain send after crash',()=>{
 const s=fixture();s.begin(10,{threadId:'a',text:'hello'});s.dispatching(10);s.data.selected='b';s.save();
 const recovered=new State(s.file);assert.equal(recovered.get(10).state,'uncertain');assert.equal(recovered.get(10).payload.threadId,'a');assert.equal(recovered.begin(10,{threadId:'b',text:'hello'}),false);assert.equal(recovered.data.offset,11);
});
test('prepared operation is uncertain after interruption; completion is durable and older updates are rejected',()=>{
 const s=fixture();s.begin(1,{kind:'native',ticket:'t'});const r=new State(s.file);assert.equal(r.get(1).state,'uncertain');assert.equal(r.begin(1,{}),false);
 r.begin(2,{text:'x'});r.dispatching(2);r.finish(2,'submitted');assert.equal(new State(s.file).get(2).state,'submitted');assert.equal(r.begin(0,{}),false);
});
