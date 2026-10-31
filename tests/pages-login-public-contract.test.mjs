// Snapshot of the user's public login HTML, read-only observation 2026-10-31.
// Executes only in an isolated VM with fake DOM/fetch, never contacts the live service.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./fixtures/pages-login/existing-login-20261031.html',import.meta.url),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',origin='https://nustanakritwithai.github.io',state='s'.repeat(43),challenge='c'.repeat(43);
async function run({expected=null,valid=true,identity=owner,allowCreation=false}={}){
 let confirmed=false,confirmations=0;const elements=new Map(),calls=[],messages=[],listeners=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:false});return elements.get(id);};
 const opener={postMessage:(data,target)=>messages.push({data,target})};
 const context={URLSearchParams,location:{search:`?auto=1&state=${state}&challenge=${challenge}`},document:{cookie:'cm_csrf=test-only',getElementById:get},window:{opener,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)},setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>2,clearTimeout:()=>{},confirm:()=>{confirmations++;if(!allowCreation)throw Error('new-account confirmation must not be invoked');return confirmed;},fetch:async(path,init)=>{calls.push({path,init});if(path.endsWith('/v1/me'))return {ok:valid,json:async()=>({guest_id:identity})};if(path.endsWith('/auth/guest')&&allowCreation){valid=true;return {ok:true,json:async()=>({guest_id:identity})};}if(path.endsWith('/pages/authorize'))return {ok:true,json:async()=>({code:'fake-code'})};throw Error('unexpected auth mutation '+path);}};
 vm.runInNewContext(script,context);listeners.get('message')({origin,source:opener,data:{type:'citymanager-auth-intent',state,expectedGuest:expected}});
 for(let n=0;n<12;n++)await Promise.resolve();return {calls,messages,elements,confirm:value=>{confirmed=value;},get confirmations(){return confirmations;}};
}
test('deployed auto=1 with no local identity authorizes remembered Guest without creating account',async()=>{const r=await run();const authorization=r.calls.find(c=>c.path.endsWith('/pages/authorize'));assert.ok(authorization);assert.deepEqual(JSON.parse(authorization.init.body),{challenge,expected_guest:owner});assert.equal(authorization.init.headers['x-csrf-token'],'test-only');assert.ok(r.messages.some(m=>m.data.type==='citymanager-auth-code'));assert.ok(!r.calls.some(c=>c.path.endsWith('/auth/guest')));});
test('deployed auto=1 refuses missing or mismatched remembered Guest without replacement',async()=>{for(const options of [{valid:false},{expected:other}]){const r=await run(options);assert.ok(!r.calls.some(c=>c.path.endsWith('/pages/authorize')||c.path.endsWith('/auth/guest')));assert.match(r.elements.get('message').textContent,/Recover the original Guest/);}});

test('first-time login requires explicit create confirmation and then Continue; never auto-signs up',async()=>{
 const r=await run({valid:false,allowCreation:true});
 assert.equal(r.elements.get('new').disabled,false);assert.equal(r.confirmations,0);assert.ok(!r.calls.some(c=>c.path.endsWith('/auth/guest')));
 await r.elements.get('new').onclick();assert.equal(r.confirmations,1);assert.ok(!r.calls.some(c=>c.path.endsWith('/auth/guest')),'cancel preserves absent account');
 r.confirm(true);await r.elements.get('new').onclick();assert.equal(r.confirmations,2);assert.equal(r.calls.filter(c=>c.path.endsWith('/auth/guest')).length,1);
 assert.ok(!r.calls.some(c=>c.path.endsWith('/pages/authorize')),'creation alone does not authorize game');
 await r.elements.get('use').onclick();const authorized=r.calls.find(c=>c.path.endsWith('/pages/authorize'));assert.deepEqual(JSON.parse(authorized.init.body),{challenge,expected_guest:owner});
 assert.equal(r.messages.filter(m=>m.data.type==='citymanager-auth-code').length,1);
 const existing=await run({expected:owner,valid:false});assert.equal(existing.elements.get('new').disabled,true,'known owner cannot replace Guest through the UI');
});
