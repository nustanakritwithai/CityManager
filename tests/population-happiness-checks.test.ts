import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPopulationHappiness} from './population-happiness-checks.mjs';

const facts={target:60,workers:2,unreachableWorkers:0,commuteSeconds:24,delaySeconds:0};
const row={score:79};
const text='ความสุขในพื้นที่ 79 / 100 เป้าหมายปัจจุบัน 60 / 100 สวนใกล้บ้าน: ไม่มี โรงเรียนที่เปิดใกล้บ้าน: ไม่มี แบบจำลองเส้นทางทำงานของแรงงาน 2 คน · 0 คนไม่มีเส้นทางไป–กลับ · เวลาเฉลี่ยทางที่ช้ากว่าประมาณ 0.4 นาที · เวลาล่าช้าจากความหนาแน่นประมาณ 0 วินาที · งานดูแลสวนใช้เส้นทางเดินเท้าได้เมื่อรถไป–กลับไม่ได้ · แบบจำลองใช้แรงงานที่มีเส้นทางรถ 75% คำนวณการจราจรชั่วโมงเร่งด่วน และยังไม่ได้รวมรถโดยสารหรือรถไฟ';
const section=(text:string)=>({exists:true,direct:true,inDetails:false,text});
test('current modeled commute wording and exact household facts pass',()=>{
  assert.doesNotThrow(()=>assertPopulationHappiness(section(text),row,facts));
});
test('missing caveats and wrong exact values fail rather than silently accepting generic copy',()=>{
  for(const remove of ['แบบจำลองเส้นทางทำงาน','0 คนไม่มีเส้นทางไป–กลับ','0.4 นาที','0 วินาที','งานดูแลสวนใช้เส้นทางเดินเท้าได้เมื่อรถไป–กลับไม่ได้','75%','ยังไม่ได้รวมรถโดยสารหรือรถไฟ'])assert.throws(()=>assertPopulationHappiness(section(text.replace(remove,'')),row,facts),remove);
  for(const patch of [{workers:1},{unreachableWorkers:1},{target:59},{commuteSeconds:null},{delaySeconds:null}])assert.throws(()=>assertPopulationHappiness(section(text),row,{...facts,...patch}));
  assert.throws(()=>assertPopulationHappiness(section(text),{score:78},facts));
});
test('no-job and uninitialized explanations are checked only for their actual state',()=>{
  const noJob='ความสุขในพื้นที่ 79 / 100 เป้าหมายปัจจุบัน 60 / 100 สวนใกล้บ้าน: ไม่มี โรงเรียนที่เปิดใกล้บ้าน: ไม่มี ยังไม่มีงานที่ได้รับมอบหมายให้ประมาณเส้นทางเดินทาง';
  assert.doesNotThrow(()=>assertPopulationHappiness(section(noJob),row,{...facts,workers:0}));
  assert.throws(()=>assertPopulationHappiness(section(noJob),row,facts));
  assert.throws(()=>assertPopulationHappiness(section(text+' ยังไม่มีงานที่ได้รับมอบหมาย'),row,facts));
  assert.doesNotThrow(()=>assertPopulationHappiness(section('ความสุขในพื้นที่ ความสุขเริ่มคำนวณหลังผ่านหนึ่งวันจำลอง'),undefined,undefined));
  assert.throws(()=>assertPopulationHappiness(section('ความสุขในพื้นที่'),undefined,undefined));
});
