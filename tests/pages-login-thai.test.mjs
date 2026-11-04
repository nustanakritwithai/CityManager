import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const html=readFileSync(new URL('../patches/pages-login-thai/login.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const state='s'.repeat(43),challenge='c'.repeat(43),owner='11111111-1111-4111-8111-111111111111',origin='https://nustanakritwithai.github.io';
async function setup({auto=false,valid=true,allow=true,error=null,opener=true,holdNew=false}={}){
 const elements=new Map(),calls=[],messages=[],listeners=new Map();let resolveNew,confirmCount=0;
 const get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:false,value:''});return elements.get(id)};
 const win={opener:opener?{postMessage:(data,target)=>messages.push({data,target})}:null,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
 const context={URLSearchParams,location:{search:`?${auto?'auto=1&':''}state=${state}&challenge=${challenge}`},document:{cookie:'cm_csrf=test-only',getElementById:get},window:win,setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>2,clearTimeout:()=>{},crypto:{randomUUID:()=>owner},confirm:()=>{confirmCount++;return allow},fetch:async(path,init)=>{calls.push({path,init});if(path.endsWith('/v1/me'))return {ok:valid,json:async()=>({guest_id:owner})};if(error)return {ok:false,json:async()=>({error})};if(path.endsWith('/auth/guest')&&holdNew)await new Promise(resolve=>{resolveNew=resolve});if(path.endsWith('/auth/guest'))valid=true;if(path.endsWith('/recovery-prepare'))return {ok:true,json:async()=>({request_id:owner,recovery_code:'fake-code'})};if(path.endsWith('/recovery-confirm'))return {ok:true,json:async()=>({state:'confirmed'})};return {ok:true,json:async()=>({code:'fake-auth-code'})};}};
 vm.runInNewContext(script,context);for(let i=0;i<8;i++)await Promise.resolve();
 return {get,calls,messages,listeners,win,release:()=>resolveNew(),get confirmCount(){return confirmCount}};
}
test('Thai labels, accessible controls, responsive rules, and inline CSP-compatible resources',()=>{
 for(const text of ['lang="th"','เข้าสู่บัญชีเดิม','เริ่มบัญชีใหม่','ไม่ใช่การกู้บัญชีหรือเซฟเดิม','รหัสกู้คืน','id="confirm-code"','disabled','role="status"','name="viewport"','@media','อย่าปิดหรือรีโหลด','การยืนยันจากแท็บอื่นอาจแทนที่รหัสนี้ได้'])assert.ok(html.includes(text),text);
 for(const id of ['use','new','recover','code','confirm-code'])assert.match(html,new RegExp(`<button id="${id}"[^>]*type="button"`));
 assert.match(html,/<label for="recovery">/);assert.doesNotMatch(html,/<(?:script|link)[^>]+(?:src|href)=/i);assert.doesNotMatch(html,/\son\w+\s*=/i);
});
test('authorization and safe invalid request preserve origin and CSRF',async()=>{
 const r=await setup();await r.get('use').onclick();const a=r.calls.find(c=>c.path.endsWith('/pages/authorize'));assert.deepEqual(JSON.parse(a.init.body),{challenge});assert.equal(a.init.method,'POST');assert.equal(a.init.credentials,'same-origin');assert.equal(a.init.headers['x-csrf-token'],'test-only');assert.equal(r.messages[0].target,origin);assert.match(r.get('message').textContent,/ส่งรหัสอนุญาตไปยังเกมแล้ว.*ตรวจสอบผลในเกม/);assert.doesNotMatch(r.get('message').textContent,/เข้าสู่บัญชีสำเร็จ/);
 const invalid=await setup({opener:false});await invalid.get('use').onclick();assert.match(invalid.get('message').textContent,/คำขอเข้าใช้งานไม่ถูกต้อง/);assert.ok(!invalid.calls.some(c=>c.path.endsWith('/authorize')));
});
test('new account is explicit, cancel is safe, duplicate clicks are suppressed',async()=>{
 const cancel=await setup({allow:false});await cancel.get('new').onclick();assert.equal(cancel.confirmCount,1);assert.ok(!cancel.calls.some(c=>c.path.endsWith('/auth/guest')));assert.equal(cancel.get('message').textContent,'');
 const r=await setup({valid:false,holdNew:true});const a=r.get('new').onclick(),b=r.get('new').onclick();await b;assert.equal(r.confirmCount,1);assert.equal(r.calls.filter(c=>c.path.endsWith('/auth/guest')).length,1);r.release();await a;assert.ok(!r.calls.some(c=>c.path.endsWith('/authorize')));
});
test('recovery sequence retains request bodies; errors are text and Thai',async()=>{
 const r=await setup();r.get('recovery').value='saved-code';await r.get('recover').onclick();const recover=r.calls.find(c=>c.path.endsWith('/pages/recover'));assert.deepEqual(JSON.parse(recover.init.body),{recovery_code:'saved-code'});assert.equal(r.get('recovery').value,'');await r.get('code').onclick();assert.equal(r.get('secret').textContent,'fake-code');assert.equal(r.get('confirm-code').disabled,false);await r.get('confirm-code').onclick();assert.deepEqual(JSON.parse(r.calls.find(c=>c.path.endsWith('/recovery-confirm')).init.body),{request_id:owner,recovery_code:'fake-code'});assert.equal(r.get('secret').textContent,'');assert.equal(r.get('confirm-code').disabled,true);
 const bad=await setup({error:'<img src=x onerror=alert(1)>'});await bad.get('recover').onclick();assert.match(bad.get('message').textContent,/ดำเนินการไม่สำเร็จ/);assert.doesNotMatch(bad.get('message').textContent,/<img/);
});
test('auto handshake refuses replacement for an existing account',async()=>{
 const r=await setup({auto:true,valid:false});r.listeners.get('message')({origin,source:r.win.opener,data:{type:'citymanager-auth-intent',state,expectedGuest:owner}});for(let i=0;i<12;i++)await Promise.resolve();assert.equal(r.get('new').disabled,true);assert.match(r.get('message').textContent,/กู้บัญชีเดิม/);assert.ok(!r.calls.some(c=>c.path.endsWith('/authorize')||c.path.endsWith('/auth/guest')));
});
test('staging checks reviewed baseline and preserves all surrounding server code',()=>{
 const d=mkdtempSync(join(tmpdir(),'cm-auth-'));mkdirSync(join(d,'staged'));const stage=new URL('../patches/pages-login-thai/stage.mjs',import.meta.url);copyFileSync(stage,join(d,'stage.mjs'));copyFileSync(new URL('../patches/pages-login-thai/login.html',import.meta.url),join(d,'login.html'));const original=readFileSync(new URL('./fixtures/pages-login/existing-login-20261031.html',import.meta.url),'utf8').trim();const source=join(d,'source.js');writeFileSync(source,'before\nexport const LOGIN_HTML=`'+original+'`;\nafter\n');let p=spawnSync(process.execPath,[join(d,'stage.mjs'),source],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);const out=readFileSync(join(d,'staged/pages-auth.js'),'utf8');assert.equal(out,'before\nexport const LOGIN_HTML=`'+html.trimEnd()+'`;\nafter\n');p=spawnSync(process.execPath,[join(d,'stage.mjs'),source],{encoding:'utf8'});assert.notEqual(p.status,0,'does not overwrite staged file');writeFileSync(source,'export const LOGIN_HTML=`changed`;');p=spawnSync(process.execPath,[join(d,'stage.mjs'),source],{encoding:'utf8'});assert.notEqual(p.status,0);assert.match(p.stderr,/differs from the reviewed baseline/);
});
