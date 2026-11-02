import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../patches/pages-login-thai/login.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const owner='11111111-1111-4111-8111-111111111111',state='s'.repeat(43),challenge='c'.repeat(43),origin='https://nustanakritwithai.github.io';
const reply=(body={},ok=true)=>({ok,json:async()=>body});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
async function setup({auto=false,holdInitialIdentity=false,handle=null,idPrefix='request'}={}){
 const elements=new Map(),calls=[],listeners=new Map(),holds=new Map();let count=0,allow=true;
 const get=id=>{if(!elements.has(id))elements.set(id,{disabled:false,textContent:'',value:''});return elements.get(id)};
 const opener={postMessage:()=>{}};
 const win={opener,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const initialIdentity=holdInitialIdentity?deferred():null;if(initialIdentity)holds.set('/citymanager-api/v1/me',initialIdentity);
 const ctx={URLSearchParams,location:{search:`?${auto?'auto=1&':''}state=${state}&challenge=${challenge}`},document:{cookie:'cm_csrf=fixture',getElementById:get},window:win,setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{},crypto:{randomUUID:()=>`${idPrefix}-${++count}`},confirm:()=>allow,fetch:async(path,init)=>{calls.push({path,body:init?.body});if(holds.has(path)){const held=holds.get(path);holds.delete(path);return held.promise}if(handle){const result=await handle(path,init);if(result)return result}if(path.endsWith('/v1/me'))return reply({guest_id:owner});if(path.endsWith('/recovery-prepare')){const id=JSON.parse(init.body).request_id;return reply({request_id:id,recovery_code:`code-${id}`})}return reply({code:'auth-code'})}};
 vm.createContext(ctx);vm.runInContext(script,ctx);for(let i=0;i<8;i++)await Promise.resolve();
 const hold=path=>{const d=deferred();holds.set('/citymanager-api/v1/'+path,d);return d};
 return {get,calls,listeners,win,hold,initialIdentity,force:code=>vm.runInContext(code,ctx),allow:value=>{allow=value},count:path=>calls.filter(c=>c.path.endsWith(path)).length};
}
test('confirm A blocks prepare B and all session-changing actions until A finishes',async()=>{
 const r=await setup();await r.get('code').onclick();const held=r.hold('pages/recovery-confirm');const confirming=r.get('confirm-code').onclick();
 for(const id of ['use','new','recover','code','confirm-code'])assert.equal(r.get(id).disabled,true,id);
 await r.get('code').onclick();await r.get('new').onclick();await r.get('recover').onclick();await r.get('use').onclick();
 assert.equal(r.count('/recovery-prepare'),1);assert.equal(r.count('/auth/guest'),0);assert.equal(r.count('/pages/recover'),0);assert.equal(r.count('/authorize'),0);assert.equal(r.get('secret').textContent,'code-request-1');
 held.resolve(reply());await confirming;assert.equal(JSON.parse(r.calls.find(c=>c.path.endsWith('/recovery-confirm')).body).recovery_code,'code-request-1');assert.equal(r.get('secret').textContent,'');assert.equal(r.get('confirm-code').disabled,true);
 await r.get('code').onclick();assert.equal(r.get('secret').textContent,'code-request-2');assert.equal(r.get('confirm-code').disabled,false);
});
test('confirm cannot use old code while a replacement prepare is pending',async()=>{
 const r=await setup();await r.get('code').onclick();const held=r.hold('pages/recovery-prepare');const preparing=r.get('code').onclick();await r.get('confirm-code').onclick();assert.equal(r.count('/recovery-confirm'),0);assert.equal(r.get('secret').textContent,'code-request-1');held.resolve(reply({request_id:'request-2',recovery_code:'code-request-2'}));await preparing;await r.get('confirm-code').onclick();assert.equal(JSON.parse(r.calls.find(c=>c.path.endsWith('/recovery-confirm')).body).recovery_code,'code-request-2');
});
test('failed confirm retains displayed code for an explicit retry',async()=>{
 const r=await setup();await r.get('code').onclick();const held=r.hold('pages/recovery-confirm');const confirming=r.get('confirm-code').onclick();held.resolve(reply({error:'invalid request'},false));await confirming;assert.equal(r.get('secret').textContent,'code-request-1');assert.equal(r.get('confirm-code').disabled,false);await r.get('confirm-code').onclick();assert.equal(r.count('/recovery-confirm'),2);assert.equal(JSON.parse(r.calls.at(-1).body).recovery_code,'code-request-1');
});
test('lost confirmation response keeps the same code and clearly reports uncertain outcome',async()=>{
 const r=await setup();await r.get('code').onclick();const held=r.hold('pages/recovery-confirm');const confirming=r.get('confirm-code').onclick();held.reject(new TypeError('Failed to fetch'));await confirming;assert.equal(r.get('secret').textContent,'code-request-1');assert.equal(r.get('confirm-code').disabled,false);assert.match(r.get('message').textContent,/ยังไม่ทราบผล/);await r.get('confirm-code').onclick();const confirmations=r.calls.filter(c=>c.path.endsWith('/recovery-confirm'));assert.equal(confirmations.length,2);assert.equal(confirmations[0].body,confirmations[1].body);
});
test('simulated commit before response loss retries the same request without claiming early success',async()=>{
 let active='prior',attempts=0;const handle=async(path,init)=>{if(!path.endsWith('/recovery-confirm'))return null;const body=JSON.parse(init.body);if(attempts++===0){active=body.recovery_code;throw new TypeError('connection lost after commit')}assert.equal(active,body.recovery_code);return reply({state:'confirmed'})};const r=await setup({handle});await r.get('code').onclick();await r.get('confirm-code').onclick();assert.equal(active,'code-request-1');assert.match(r.get('message').textContent,/ยังไม่ทราบผล/);assert.equal(r.get('secret').textContent,'code-request-1');await r.get('confirm-code').onclick();assert.equal(r.get('secret').textContent,'');assert.match(r.get('message').textContent,/ยืนยันรหัสกู้คืนแล้ว/);const calls=r.calls.filter(c=>c.path.endsWith('/recovery-confirm'));assert.equal(calls[0].body,calls[1].body);
});
test('unreadable confirmation response remains uncertain; expired code requires a new prepare',async()=>{
 const r=await setup();await r.get('code').onclick();const bad=r.hold('pages/recovery-confirm');const confirming=r.get('confirm-code').onclick();bad.resolve({ok:true,json:async()=>{throw new SyntaxError('unreadable response')}});await confirming;assert.match(r.get('message').textContent,/ยังไม่ทราบผล/);assert.equal(r.get('secret').textContent,'code-request-1');const expired=r.hold('pages/recovery-confirm');const retry=r.get('confirm-code').onclick();expired.resolve(reply({error:'recovery preparation expired'},false));await retry;assert.equal(r.get('secret').textContent,'');assert.equal(r.get('confirm-code').disabled,true);assert.match(r.get('message').textContent,/หมดอายุ.*สร้างรหัสใหม่/);
});
test('two simulated tabs: superseded confirmation does not present an unusable code as retryable',async()=>{
 let active='prior';const rotations=new Map();const handle=async(path,init)=>{if(path.endsWith('/recovery-prepare')){const id=JSON.parse(init.body).request_id,code=`code-${id}`;rotations.set(id,{code,previous:active});return reply({request_id:id,recovery_code:code})}if(path.endsWith('/recovery-confirm')){const body=JSON.parse(init.body),saved=rotations.get(body.request_id);if(saved.previous!==active)return reply({error:'recovery rotation superseded'},false);active=saved.code;return reply({state:'confirmed'})}return null};
 const a=await setup({handle,idPrefix:'tab-a'}),b=await setup({handle,idPrefix:'tab-b'});await a.get('code').onclick();await b.get('code').onclick();await a.get('confirm-code').onclick();await b.get('confirm-code').onclick();assert.equal(active,'code-tab-a-1');assert.equal(b.get('secret').textContent,'');assert.equal(b.get('confirm-code').disabled,true);assert.match(b.get('message').textContent,/ถูกแทนที่.*สร้างรหัสใหม่/);
});
test('documented limitation: another tab can later replace a confirmed code without updating the first tab',async()=>{
 let active='prior';const rotations=new Map();const handle=async(path,init)=>{if(path.endsWith('/recovery-prepare')){const id=JSON.parse(init.body).request_id,code=`code-${id}`;rotations.set(id,{code,previous:active});return reply({request_id:id,recovery_code:code})}if(path.endsWith('/recovery-confirm')){const body=JSON.parse(init.body),saved=rotations.get(body.request_id);if(saved.previous!==active)return reply({error:'recovery rotation superseded'},false);active=saved.code;return reply({state:'confirmed'})}return null};
 const a=await setup({handle,idPrefix:'tab-a'}),b=await setup({handle,idPrefix:'tab-b'});await a.get('code').onclick();await a.get('confirm-code').onclick();const earlierMessage=a.get('message').textContent;await b.get('code').onclick();await b.get('confirm-code').onclick();assert.equal(active,'code-tab-b-1');assert.equal(a.get('message').textContent,earlierMessage);assert.match(earlierMessage,/แท็บอื่น/);
});
test('cancelled creation keeps code; a failed or successful session switch invalidates it',async()=>{
 for(const action of ['new','recover'])for(const succeeds of [false,true]){const r=await setup();await r.get('code').onclick();if(action==='new'){r.allow(false);await r.get('new').onclick();assert.equal(r.get('secret').textContent,'code-request-1');assert.equal(r.count('/auth/guest'),0);r.allow(true)}const held=r.hold(action==='new'?'auth/guest':'pages/recover');const switching=r.get(action).onclick();assert.equal(r.get('secret').textContent,'');held.resolve(succeeds?reply():reply({error:'invalid request'},false));await switching;assert.equal(r.get('secret').textContent,'');assert.equal(r.get('confirm-code').disabled,true);if(!succeeds){assert.doesNotMatch(r.get('identity').textContent,new RegExp(owner));assert.match(r.get('identity').textContent,/ตรวจสอบบัญชีอีกครั้ง/)}await r.get('confirm-code').onclick();assert.equal(r.count('/recovery-confirm'),0)}
});
test('failed prepare preserves the previously displayed pending code',async()=>{
 const r=await setup();await r.get('code').onclick();const held=r.hold('pages/recovery-prepare');const preparing=r.get('code').onclick();held.resolve(reply({error:'invalid request'},false));await preparing;assert.equal(r.get('secret').textContent,'code-request-1');assert.equal(r.get('confirm-code').disabled,false);await r.get('confirm-code').onclick();assert.equal(JSON.parse(r.calls.find(c=>c.path.endsWith('/recovery-confirm')).body).recovery_code,'code-request-1');
});
test('stale responses cannot clear or confirm a newer recovery generation',async()=>{
 const r=await setup();await r.get('code').onclick();const held=r.hold('pages/recovery-confirm');const confirming=r.get('confirm-code').onclick();r.force("pendingRecovery={request_id:'new',recovery_code:'new-code'};sessionGeneration++;document.getElementById('secret').textContent='new-code'");held.resolve(reply());await confirming;assert.equal(r.get('secret').textContent,'new-code');assert.equal(r.get('confirm-code').disabled,false);assert.doesNotMatch(r.get('message').textContent,/ยืนยันรหัสกู้คืนแล้ว/);
 const p=await setup();const preparingHeld=p.hold('pages/recovery-prepare');const preparing=p.get('code').onclick();p.force("pendingRecovery={request_id:'new',recovery_code:'new-code'};sessionGeneration++;document.getElementById('secret').textContent='new-code'");preparingHeld.resolve(reply({request_id:'old',recovery_code:'old-code'}));await preparing;assert.equal(p.get('secret').textContent,'new-code');assert.equal(p.get('confirm-code').disabled,false);
});
test('all actions are mutually exclusive while each request is outstanding',async()=>{
 for(const [id,path] of [['use','pages/authorize'],['new','auth/guest'],['recover','pages/recover'],['code','pages/recovery-prepare'],['confirm-code','pages/recovery-confirm']]){const r=await setup();if(id==='confirm-code')await r.get('code').onclick();const held=r.hold(path);const started=r.get(id).onclick();const before=r.calls.length;for(const other of ['use','new','recover','code','confirm-code']){assert.equal(r.get(other).disabled,true,`${id} locks ${other}`);await r.get(other).onclick()}assert.equal(r.calls.length,before,`${id} admitted a competing request`);held.resolve(path==='pages/recovery-prepare'?reply({request_id:'request-1',recovery_code:'code-request-1'}):reply({code:'auth-code'}));await started}
});
test('late initial identity response cannot overwrite the identity after session recovery',async()=>{
 const r=await setup({holdInitialIdentity:true});await r.get('recover').onclick();assert.match(r.get('identity').textContent,new RegExp(owner));r.initialIdentity.resolve(reply({guest_id:'old-account'}));for(let i=0;i<8;i++)await Promise.resolve();assert.match(r.get('identity').textContent,new RegExp(owner));assert.doesNotMatch(r.get('identity').textContent,/old-account/);
});
test('handshake during a pending user action cannot change its lock or silently authorize',async()=>{
 const r=await setup({auto:true});const held=r.hold('pages/recovery-prepare');const preparing=r.get('code').onclick();r.listeners.get('message')({origin,source:r.win.opener,data:{type:'citymanager-auth-intent',state,expectedGuest:owner}});assert.equal(r.get('new').disabled,true);assert.equal(r.count('/authorize'),0);held.resolve(reply({request_id:'request-1',recovery_code:'code-request-1'}));await preparing;assert.equal(r.get('new').disabled,true);assert.equal(r.get('secret').textContent,'code-request-1');assert.equal(r.count('/authorize'),0);
});
test('documented limitation: reload after an uncertain confirm loses the in-memory pending request',async()=>{
 const first=await setup();await first.get('code').onclick();const held=first.hold('pages/recovery-confirm');const confirming=first.get('confirm-code').onclick();held.reject(new TypeError('connection lost'));await confirming;assert.match(first.get('message').textContent,/ยังไม่ทราบผล/);assert.equal(first.get('secret').textContent,'code-request-1');
 // A fresh VM represents a reload: it has no copy of the previous page's memory.
 const reloaded=await setup();assert.equal(reloaded.get('secret').textContent,'');assert.equal(reloaded.get('confirm-code').disabled,true);await reloaded.get('confirm-code').onclick();assert.equal(reloaded.count('/recovery-confirm'),0);
});
