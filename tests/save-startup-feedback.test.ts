import test from 'node:test';
import assert from 'node:assert/strict';
import {startupSaveFailureMessage} from '../src/startup-save-feedback.ts';

test('startup conflict explains the two sources without choosing either or declaring corruption',()=>{
 const message=startupSaveFailureMessage('พบเซฟช่องเดิมกับสำเนาอัตโนมัติต่างกัน กรุณาเลือกโหลดชุดที่ต้องการก่อน');
 assert.match(message,/เซฟหลักกับสำเนาอัตโนมัติไม่ตรงกัน/);
 assert.match(message,/ต้องตรวจและเลือกชุดที่ต้องการก่อน/);
 assert.match(message,/เมืองชั่วคราว ไม่ใช่เซฟเดิม/);
 assert.match(message,/การส่งออกก่อนกู้คืนส่งออกเมืองชั่วคราว/);
 assert.match(message,/ห้ามล้างข้อมูลเว็บไซต์/);
 assert.doesNotMatch(message,/เสียหาย|เต็ม/);
});
test('known decoding and size failures are distinct; unknown errors never leak their contents',()=>{
 assert.match(startupSaveFailureMessage('Recovery copy could not be decoded; original save preserved'),/อ่านสำเนากู้คืนไม่ได้/);
 assert.match(startupSaveFailureMessage('City save exceeds the prototype limit'),/ขนาดเกินขีดจำกัด/);
 for(const error of ['SyntaxError: private-city-name guest-id-123', 'SecurityError: access denied', 'Unexpected token at user-address']){
  const message=startupSaveFailureMessage(error);
  assert.match(message,/ยังระบุสาเหตุเฉพาะไม่ได้/);
  assert.ok(!message.includes(error));assert.doesNotMatch(message,/guest-id-123|private-city-name|user-address/);
 }
});

test('successful recovery clears startup failure without inventing a saved timestamp; next Save is tracked',async()=>{
 const {createSaveFeedback}=await import('../src/save-feedback.ts');
 let state:import('../src/save-feedback.ts').SaveFeedbackState|undefined;
 const feedback=createSaveFeedback(value=>{state=value;},()=>1234);
 feedback.failed(startupSaveFailureMessage('unreadable'));
 const oldAttempt=feedback.begin();
 const {createCity}=await import('../src/sim.ts');
 const {createParkRuntime,serializeParkSession}=await import('../src/park-runtime.ts');
 const {createSaveGuard}=await import('../src/save-guard.ts');
 const {loadLocalCitySession}=await import('../src/local-city-save.ts');
 const city=createCity(61025),raw=serializeParkSession(city,createParkRuntime(city));
 let writes=0,applied=false;const guard=createSaveGuard({getItem:()=>null,setItem:()=>{writes++;}});
 await loadLocalCitySession(raw,undefined,guard,()=>{applied=true;});feedback.recovered();
 assert.equal(applied,true);assert.equal(guard.armed,true);assert.equal(writes,0);
 assert.equal(state!.failure,null);assert.equal(state!.lastSuccess,null);
 feedback.failed('older pending write was canceled',oldAttempt);
 assert.equal(state!.failure,null);assert.equal(state!.pending,0);
 const attempt=feedback.begin();feedback.succeeded(attempt);
 assert.equal(state!.failure,null);assert.equal(state!.lastSuccess,1234);
});

test('failed recovery keeps original warning; only successful recovery calls recovered',async()=>{
 const {createSaveFeedback}=await import('../src/save-feedback.ts');
 const {loadLocalCitySession}=await import('../src/local-city-save.ts');
 const {createSaveGuard}=await import('../src/save-guard.ts');
 let state:import('../src/save-feedback.ts').SaveFeedbackState|undefined;
 const feedback=createSaveFeedback(value=>{state=value;});
 const warning=startupSaveFailureMessage('unreadable');feedback.failed(warning);
 const guard=createSaveGuard({getItem:()=>'{broken',setItem:()=>{throw Error('must not write');}});
 await assert.rejects(async()=>{await loadLocalCitySession('{broken',undefined,guard,()=>{});feedback.recovered();});
 assert.equal(state!.failure,warning);assert.equal(state!.lastSuccess,null);assert.equal(guard.armed,false);
});


test('switching from a saved local branch clears its success before a different city fails',async()=>{
 const {createSaveFeedback}=await import('../src/save-feedback.ts');
 let latest;const feedback=createSaveFeedback(state=>{latest=state;},()=>123);const saved=feedback.begin();feedback.succeeded(saved);assert.equal(latest.lastSuccess,123);feedback.recovered();assert.equal(latest.lastSuccess,null);const next=feedback.begin();feedback.failed('other city quota',next);assert.equal(latest.lastSuccess,null);assert.equal(latest.failure,'other city quota');
});
