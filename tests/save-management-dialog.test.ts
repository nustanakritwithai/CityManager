import {test} from 'node:test';import assert from 'node:assert/strict';
import {installSaveManagement,saveManagementError,type SaveManagementActions} from '../src/save-management-dialog.ts';
class Element{
 children:Element[]=[];textContent='';disabled=false;hidden=false;id='';onclick:(()=>void|Promise<void>)|null=null;listeners=new Map<string,()=>void>();removed=false;
 append(...children:Element[]){this.children.push(...children);}setAttribute(){}addEventListener(type:string,fn:()=>void){this.listeners.set(type,fn);}showModal(){}close(){}remove(){this.removed=true;}focus(){}
 click(){return this.onclick?.()??this.listeners.get('click')?.();}
}
function fixture(overrides:Partial<SaveManagementActions>={}){
 const body=new Element();Object.defineProperty(globalThis,'document',{configurable:true,value:{body,createElement:()=>new Element()}});
 const calls:string[]=[];const button=new Element();
 const actions:SaveManagementActions={canOpen:()=>true,begin:()=>{calls.push('pause');return {tick:42,cityId:'city-id'};},remove:async()=>{calls.push('delete');},createFresh:async()=>{calls.push('create');},uncertain:()=>false,cancel:()=>{calls.push('cancel');},complete:()=>{calls.push('complete');},status:()=>{},...overrides};
 installSaveManagement(button as unknown as HTMLButtonElement,actions);button.click();const dialog=body.children[0];
 return {calls,button,dialog,confirm:dialog?.children[3],back:dialog?.children[4],cleanup:()=>{delete (globalThis as any).document;}};
}
test('cancel management pauses then closes without delete or create',()=>{const f=fixture();try{f.back.click();assert.deepEqual(f.calls,['pause','cancel']);assert.equal(f.dialog.removed,true);}finally{f.cleanup();}});
test('delete awaits server confirmation; repeated click does not duplicate; fresh creation is separate',async()=>{
 let done!:()=>void;const f=fixture({remove:()=>new Promise<void>(resolve=>{done=resolve;})});try{
 const deleting=f.confirm.click();assert.equal(f.confirm.disabled,true);assert.equal(f.back.disabled,true);await f.confirm.click();assert.equal(f.confirm.id,'save-management-delete');assert.equal(f.dialog.removed,false);
 done();await deleting;assert.equal(f.confirm.id,'save-management-create');assert.equal(f.dialog.removed,false);assert.ok(!f.calls.includes('create'));
 await f.confirm.click();assert.deepEqual(f.calls,['pause','create','complete']);assert.equal(f.dialog.removed,true);
 }finally{f.cleanup();}
});
test('uncertain failed delete never offers new world or cancellation; same action is retryable',async()=>{
 let attempts=0;const f=fixture({remove:async()=>{attempts++;throw Error('network');},uncertain:()=>true});try{
 await f.confirm.click();assert.equal(attempts,1);assert.equal(f.confirm.id,'save-management-delete');assert.equal(f.back.disabled,true);f.back.click();assert.ok(!f.calls.includes('cancel'));
 await f.confirm.click();assert.equal(attempts,2);assert.equal(f.dialog.removed,false);assert.ok(!f.calls.includes('create'));
 }finally{f.cleanup();}
});
test('pending save blocks opening management',()=>{const f=fixture({canOpen:()=>false});try{assert.equal(f.dialog,undefined);assert.deepEqual(f.calls,[]);}finally{f.cleanup();}});

test('known financial obligations explain why deletion is blocked',()=>{assert.match(saveManagementError(Error('market-reconciliation-required')),/รายการตลาด.*ค้างยืนยัน/);assert.match(saveManagementError(Error('market-contract-unverified')),/ตรวจข้อมูลรายการตลาดเดิมไม่ครบ/);assert.match(saveManagementError(Error('save-conflict')),/ไม่ได้ลบ/);});

test('delete acknowledged then readback mismatch cannot cancel into retired world; offers explicit reload',async()=>{
 let acknowledged=false;const calls:string[]=[];const f=fixture({remove:async()=>{acknowledged=true;throw Error('head-changed');},uncertain:()=>acknowledged,canReload:()=>acknowledged,reload:()=>calls.push('reload')});try{
 await f.confirm.click();assert.equal(f.confirm.id,'save-management-delete');assert.equal(f.back.textContent,'กลับหน้าเข้าเกม');f.back.click();assert.deepEqual(calls,['reload']);assert.ok(!f.calls.includes('cancel'));assert.equal(f.dialog.removed,false);
 }finally{f.cleanup();}
});

test('definite rejection disables repeated Delete and keeps cancellation non-destructive',async()=>{
 let rejected=false,requests=0;const f=fixture({remove:async()=>{requests++;rejected=true;throw Error('market-reconciliation-required');},rejected:()=>rejected});try{
 await f.confirm.click();assert.equal(f.confirm.disabled,true);assert.equal(f.back.disabled,false);assert.match(f.dialog.children[2].textContent,/รายการตลาด.*ค้างยืนยัน/);assert.match(f.dialog.children[2].textContent,/ไม่ส่งลบซ้ำ/);
 await f.confirm.click();assert.equal(requests,1);f.back.click();assert.ok(f.calls.includes('cancel'));assert.ok(!f.calls.includes('create'));
 }finally{f.cleanup();}
});

test('known fresh-create rejection after acknowledged delete only permits reload, never cancellation',async()=>{
 let deleted=false,rejected=false;const events:string[]=[];const f=fixture({remove:async()=>{deleted=true;},createFresh:async()=>{rejected=true;throw Error('save-conflict');},uncertain:()=>deleted,rejected:()=>rejected,canReload:()=>deleted,reload:()=>events.push('reload')});try{
 await f.confirm.click();assert.equal(f.confirm.id,'save-management-create');await f.confirm.click();assert.equal(f.confirm.disabled,true);assert.equal(f.back.textContent,'กลับหน้าเข้าเกม');
 assert.match(f.dialog.children[2].textContent,/กลับหน้าเข้าเกมเพื่อตรวจเมืองหลัก/);f.back.click();assert.deepEqual(events,['reload']);assert.ok(!f.calls.includes('cancel'));assert.equal(f.dialog.removed,false);
 }finally{f.cleanup();}
});
