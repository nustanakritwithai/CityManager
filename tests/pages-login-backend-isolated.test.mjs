import fs from 'node:fs';import vm from 'node:vm';import crypto from 'node:crypto';import net from 'node:net';import assert from 'node:assert/strict';
import test from 'node:test';

// This test loads the older pinned market-server fixture's recovery handlers.
// The fixture predates the current /authorize expected_guest handshake, and
// does not establish current deployed-backend compatibility.
//
// No HTTP, browser, PostgreSQL, or live service is used. Router registration,
// request and response objects, rate-limit storage and the SQL store are synthetic.
// Guest, CSRF and all other Express middleware are deliberately bypassed.
// The in-memory store implements only SQL required by these cases, while a
// JavaScript queue serializes transactions and models rollback. It does not
// prove SQL validity, database isolation, locking, middleware or real transport.
// Token generation is deterministic; recovery code hashes use SHA-256.

test('fixture recovery routes and Thai page with synthetic transactions', async () => {
const path = new URL('./fixtures/market-server/src/pages-auth.js', import.meta.url);
let code=fs.readFileSync(path,'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');code+='\nthis.build=pagesAuthRouter;';
const routes=new Map();function Router(){return {use(){},get(p,...h){routes.set('GET '+p,h)},post(p,...h){routes.set('POST '+p,h)}}};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');let seq=0;const token=()=>crypto.createHash('sha256').update('synthetic-'+ ++seq).digest('base64url');const fail=(status,message)=>Object.assign(new Error(message),{status});
const ctx={Router,crypto,net,hash,token,fail,Buffer,Date};vm.runInNewContext(code,ctx,{filename:path.pathname});
const db={active:null,rotations:new Map(),sessions:[]};const pool={async query(q,v){if(q.startsWith('SELECT attempts'))return{rows:[]};if(q.startsWith('DELETE FROM pages_auth_rate_limits'))return{rows:[]};if(q.startsWith('INSERT INTO pages_auth_rate_limits'))return{rows:[{attempts:1}]};throw Error('unexpected pool SQL '+q)}};
let queue=Promise.resolve();async function tx(fn){let release;const previous=queue;queue=new Promise(r=>release=r);await previous;const snapshot=structuredClone(db);const c={async query(q,v){
 if(q.startsWith('SELECT 1 FROM accounts'))return{rowCount:1,rows:[{}]};
 if(q.startsWith('DELETE FROM pages_recovery_rotations'))return{rowCount:0,rows:[]};
 if(q.startsWith('SELECT code_hash FROM pages_recovery_codes'))return{rowCount:db.active?1:0,rows:db.active?[{code_hash:db.active}]:[]};
 if(q.startsWith('INSERT INTO pages_recovery_rotations')){let [account,id,codeHash,previousHash]=v;if(db.rotations.has(id))return{rowCount:0,rows:[]};db.rotations.set(id,{code_hash:codeHash,previous_code_hash:previousHash,expires_at:new Date(Date.now()+86400000),confirmed_at:null});return{rowCount:1,rows:[{request_id:id}]}}
 if(q.startsWith('SELECT code_hash,previous_code_hash')){let x=db.rotations.get(v[1]);return{rowCount:x?1:0,rows:x?[{...x}]:[]}}
 if(q.startsWith('INSERT INTO pages_recovery_codes')){db.active=v[1];return{rowCount:1,rows:[]}}
 if(q.startsWith('UPDATE pages_recovery_rotations')){db.rotations.get(v[1]).confirmed_at=new Date();return{rowCount:1,rows:[]}}
 if(q.startsWith('SELECT account_id FROM pages_recovery_codes'))return{rowCount:db.active===v[0]?1:0,rows:db.active===v[0]?[{account_id:'test-account'}]:[]};
 if(q.startsWith('UPDATE accounts SET expires_at'))return{rowCount:1,rows:[]};
 if(q.startsWith('INSERT INTO sessions')){db.sessions.push(v);return{rowCount:1,rows:[]}};
 throw Error('unexpected tx SQL '+q);
 }};try{return await fn(c)}catch(e){Object.assign(db,snapshot);throw e}finally{release()}}
const pass=(_req,_res,next)=>next();ctx.build({pool,tx,guest:pass,csrf:pass,cookieOptions:()=>({}),secureCookies:true});
async function call(route,body){const req={body,account:{id:'test-account'},cookies:{},socket:{remoteAddress:'127.0.0.1'},get(name){return {'origin':'https://citymanager.157-85-96-139.sslip.io','x-forwarded-for':'192.0.2.1'}[name]}};const out={};const res={json(data){out.status=200;out.data=data;return this},cookie(){return this}};let error;await routes.get('POST '+route).at(-1)(req,res,e=>{error=e});if(error){out.status=error.status;out.error=error.message}return out}
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;async function prepare(n){const r=await call('/recovery-prepare',{request_id:uuid(n)});assert.equal(r.status,200);return r.data};async function confirm(x){return call('/recovery-confirm',x)};
// An initial active recovery code and an uncommitted rotation leave that code valid.
let base=await prepare(1);assert.equal((await confirm(base)).status,200);let a=await prepare(2);assert.equal((await call('/recover',{recovery_code:base.recovery_code})).status,200);assert.equal((await call('/recover',{recovery_code:a.recovery_code})).status,401);
// Server commits, response lost; replay exact request and verify code remains active.
let first=await confirm(a);assert.equal(first.status,200);first=undefined;let retry=await confirm(a);assert.equal(retry.status,200);assert.equal(retry.data.state,'confirmed');assert.equal((await call('/recover',{recovery_code:a.recovery_code})).status,200);assert.equal((await call('/recover',{recovery_code:base.recovery_code})).status,401);
// Two tabs prepare against same active generation, simultaneous confirms serialize.
let b=await prepare(3),c=await prepare(4);let [x,y]=await Promise.all([confirm(b),confirm(c)]);assert.equal(x.status,200);assert.equal(y.status,409);assert.equal(y.error,'recovery rotation superseded');assert.equal((await confirm(b)).status,200);assert.equal((await call('/recover',{recovery_code:b.recovery_code})).status,200);assert.equal((await call('/recover',{recovery_code:c.recovery_code})).status,401);
// Later rotation supersedes prior confirmed request as well.
let d=await prepare(5);assert.equal((await confirm(d)).status,200);assert.equal((await confirm(b)).error,'recovery rotation superseded');assert.equal((await call('/recover',{recovery_code:d.recovery_code})).status,200);
// Replayed prepare is rejected; expired unconfirmed proposal does not alter active code.
assert.equal((await call('/recovery-prepare',{request_id:uuid(5)})).status,409);let e=await prepare(6);db.rotations.get(e.request_id).expires_at=new Date(0);assert.equal((await confirm(e)).error,'recovery preparation expired');assert.equal((await call('/recover',{recovery_code:d.recovery_code})).status,200);
console.log('PASS: actual fixture route handlers; prior code remains valid before commit; lost confirmation + exact retry; serialized competing tabs; superseded old confirmation; duplicate prepare; expiry; recover accepts only active code. Synthetic SQL store and serialized transaction model; no PostgreSQL, HTTP, browser or network.');
const html=fs.readFileSync(new URL('../patches/pages-login-thai/login.html', import.meta.url),'utf8');const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];let u=100;
async function tab({lose=false}={}){let lost=false;const els=new Map();const get=id=>{if(!els.has(id))els.set(id,{textContent:'',disabled:false,value:''});return els.get(id)};let calls=[];const win={opener:{postMessage(){}},addEventListener(){},removeEventListener(){}};const context={URLSearchParams,location:{search:''},document:{cookie:'cm_csrf=synthetic',getElementById:get},window:win,setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},crypto:{randomUUID:()=>uuid(++u)},confirm:()=>true,fetch:async(path,init)=>{if(path.endsWith('/v1/me'))return{ok:true,json:async()=>({guest_id:uuid(1)})};const body=JSON.parse(init.body);calls.push({path,body});const res=await call(path.substring(path.lastIndexOf('/')),body);if(lose&&!lost&&path.endsWith('/recovery-confirm')&&res.status===200){lost=true;throw new TypeError('synthetic response lost after commit')}return{ok:res.status===200,status:res.status,json:async()=>res.status===200?res.data:{error:res.error}}}};vm.runInNewContext(script,context);for(let i=0;i<10;i++)await Promise.resolve();return{get,calls}}
const ta=await tab({lose:true});await ta.get('code').onclick();const saved=ta.get('secret').textContent;assert.ok(saved);await ta.get('confirm-code').onclick();assert.match(ta.get('message').textContent,/ยังไม่ทราบผล/);assert.equal(ta.get('secret').textContent,saved);await ta.get('confirm-code').onclick();assert.equal(ta.get('secret').textContent,'');assert.match(ta.get('message').textContent,/ยืนยันรหัสกู้คืนแล้ว/);const confirmCalls=ta.calls.filter(x=>x.path.endsWith('/recovery-confirm'));assert.deepEqual(confirmCalls[0].body,confirmCalls[1].body);assert.equal((await call('/recover',{recovery_code:saved})).status,200);
const tb=await tab(),tc=await tab();await tb.get('code').onclick();await tc.get('code').onclick();const winner=tb.get('secret').textContent,loser=tc.get('secret').textContent;await Promise.all([tb.get('confirm-code').onclick(),tc.get('confirm-code').onclick()]);assert.match(tb.get('message').textContent,/ยืนยันรหัสกู้คืนแล้ว/);assert.match(tc.get('message').textContent,/ถูกแทนที่.*สร้างรหัสใหม่/);assert.equal(tc.get('secret').textContent,'');assert.equal(tc.get('confirm-code').disabled,true);assert.equal((await call('/recover',{recovery_code:winner})).status,200);assert.equal((await call('/recover',{recovery_code:loser})).status,401);console.log('PASS: candidate frontend linked to actual copied backend recovery handlers in-process: lost response exact retry and two competing tabs, messages and active code verified. Synthetic SQL/transaction and transport only.');

});
