import test from 'node:test';import assert from 'node:assert/strict';import {McpClient} from '../mcp-client.mjs';
test('a closed adapter fails the next request immediately with a connection error',async()=>{
 const client=Object.create(McpClient.prototype);
 client.pending=new Map();
 client.fail();
 await assert.rejects(()=>client.request('tools/list',{}),{code:'APP_TOOLS_UNAVAILABLE'});
});
test('initialization detects sidebar-only versus paginated thread-list schema',async()=>{for(const history of [false,true]){const c=Object.create(McpClient.prototype),calls=[];c.child={stdin:{write:()=>{}}};c.request=async(method)=>{calls.push(method);return method==='tools/list'?{tools:[{name:'list_threads',inputSchema:{properties:{limit:{type:'number'},...(history?{mode:{type:'string'}}:{})}}}]}:{};};await c.initialize();assert.deepEqual(calls,['initialize','tools/list']);assert.equal(c.sidebarThreadList,!history);}});
