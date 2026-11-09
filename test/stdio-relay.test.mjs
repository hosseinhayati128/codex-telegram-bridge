import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameMux, LineObserver } from '../framing.mjs';
import {parseWire} from '../wire.mjs';
test('fragmented UTF-8 and CRLF desktop bytes survive; injected frame stays at boundary',()=>{
 const raw=Buffer.from('{"method":"test","params":{"text":"سلام 😀"}}\r\n');const out=[],seen=[];
 const m=new FrameMux({write:b=>out.push(b),accept:m=>{seen.push(m);return true;}});
 m.push(raw.subarray(0,42));m.inject({id:1,result:{x:true}});m.push(raw.subarray(42));
 assert.deepEqual(Buffer.concat(out).subarray(0,raw.length),raw);assert.equal(parseWire(Buffer.concat(out).subarray(raw.length).toString()).id,1);assert.equal(seen[0].params.text,'سلام 😀');
});
test('large/malformed observational frame preserves bytes and disables only native observer',()=>{
 const out=[],observed=[];let oversized=0;
 const o=new LineObserver({onFrame:x=>observed.push(x),limit:10,onOverflow:()=>oversized++});
 const raw=Buffer.from('x'.repeat(32)+'\n{"id":1}\n');for(const b of raw){out.push(Buffer.from([b]));o.push(Buffer.from([b]));}
 assert.deepEqual(Buffer.concat(out),raw);assert.equal(oversized,1);assert.equal(observed.at(-1).id,1);
});
test('EOF preserves final partial bytes, rejects further injections; dropping duplicate response preserves next frame',()=>{
 const out=[];const m=new FrameMux({write:b=>out.push(b),accept:x=>x.id!==1});
 m.push(Buffer.from('{"id":1,"result":{}}\n{"method":"next"}\nTAIL'));m.end();
 assert.equal(Buffer.concat(out).toString(),'{"method":"next"}\nTAIL');assert.throws(()=>m.inject({id:2}),/closed/i);
});
