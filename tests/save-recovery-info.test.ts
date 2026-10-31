import test from 'node:test';import assert from 'node:assert/strict';
import {recoverySummary,loadFailureMessage} from '../src/save-recovery-info.ts';
import {createCity,step} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession} from '../src/park-runtime.ts';
import {SAVE_KEY,AUTOSAVE_CHECKPOINT_KEY} from '../src/save-storage.ts';
test('candidate summaries show older and newer days without selecting or writing either',()=>{
 const city=createCity(61025),snapshot=()=>serializeParkSession(city,createParkRuntime(city));const old=snapshot();step(city);const newer=snapshot();
 for(const [primary,copy] of [[old,newer],[newer,old]]){
  const data=new Map([[SAVE_KEY,primary],[AUTOSAVE_CHECKPOINT_KEY,copy]]),before=[...data];
  const summary=recoverySummary({getItem:key=>data.get(key)??null});
  assert.match(summary,/วันที่ 0/);assert.match(summary,/วันที่ 1/);assert.match(summary,/v25/);assert.match(summary,/ยังไม่เลือกแทนให้คุณ/);assert.deepEqual([...data],before);
 }
});
test('invalid/missing/denied candidates remain isolated and never expose raw contents',()=>{
 const city=createCity(61025),valid=serializeParkSession(city,createParkRuntime(city));
 const data=new Map([[SAVE_KEY,'private_guest_secret'],[AUTOSAVE_CHECKPOINT_KEY,valid]]),before=[...data];
 const summary=recoverySummary({getItem:key=>data.get(key)??null});assert.match(summary,/อ่านหรือตรวจสอบไม่ได้/);assert.match(summary,/วันที่ 0/);assert.ok(!summary.includes('private_guest_secret'));assert.deepEqual([...data],before);
 assert.match(recoverySummary({getItem:()=>null}),/ไม่พบเซฟ/);
 for(const name of ['SecurityError','QuotaExceededError'])assert.match(recoverySummary({getItem:()=>{throw Object.assign(Error('private_guest_secret'),{name});}}),/อ่านหรือตรวจสอบไม่ได้/);
});
test('load failures are allowlisted and do not disclose identity or server details',()=>{
 assert.match(loadFailureMessage(Error('Park recreation: sidecar clock mismatch')),/โหลดไม่สำเร็จ.*sidecar clock mismatch/);
 assert.match(loadFailureMessage(Error('market guest identity mismatch')),/Guest.*ไม่ตรงกัน/);
 assert.match(loadFailureMessage(Error('ยังบันทึกการเลือกเมืองใหม่ไม่ได้ กรุณาเก็บเมืองเดิมไว้ก่อน')),/โหลดไม่สำเร็จ.*ยังบันทึกการเลือกเมืองใหม่ไม่ได้.*เก็บเมืองเดิมไว้ก่อน/);
 assert.match(loadFailureMessage(Object.assign(Error('private data'),{name:'SecurityError'})),/ไม่อนุญาต/);
 assert.match(loadFailureMessage(Object.assign(Error('private data'),{name:'QuotaExceededError'})),/ไม่เพียงพอ/);
 const unknown=loadFailureMessage(Error('private_guest_secret'));assert.match(unknown,/ยังอ่านหรือตรวจสอบชุดที่เลือกไม่ผ่าน/);assert.ok(!unknown.includes('private_guest_secret'));
});
