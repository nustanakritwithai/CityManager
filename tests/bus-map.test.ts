import test from 'node:test';import assert from 'node:assert/strict';
import {busCellNote,stopOrder} from '../src/bus/map-paint.ts';
import {publishBusMap} from '../src/bus/map-state.ts';
const stop=(id:number,cell:number,waiting:number,kind:'pole'|'shelter'='pole')=>({id,cell,side:'n',level:kind==='pole'?1:2,kind,x:0,z:0,y:0,headingX:0,headingZ:1,sx:1,sy:1,sz:1,waiting}) as any;
test('map stop numbers follow stop id and the hover note names the stop, its kind and riders',()=>{
 assert.deepEqual([...stopOrder([{id:34},{id:32},{id:33}])],[[32,1],[33,2],[34,3]]);
 publishBusMap({buses:[],loads:[],dwelling:[],lines:[],stops:[stop(33,294,5,'shelter'),stop(32,291,0)],depots:[{id:31,cell:313,level:1,open:true,x:0,z:0,y:0,headingX:1,headingZ:0,sx:1,sy:1,sz:1}],crowds:[],captions:[]} as any);
 try{
  assert.equal(busCellNote(294),'ป้ายรถเมล์ 2 · ศาลา · รอ 5 คน');
  assert.equal(busCellNote(291),'ป้ายรถเมล์ 1 · ป้ายเสา · รอ 0 คน');
  assert.equal(busCellNote(313),'อู่รถเมล์ · ระดับ 1');
  assert.equal(busCellNote(100),null);
 }finally{publishBusMap(null);}
});
