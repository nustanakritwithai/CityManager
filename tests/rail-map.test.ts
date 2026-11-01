import test from 'node:test';import assert from 'node:assert/strict';
import {publishRailMap,publishedRailMap,railMapRevision,uniqueRuns,railCellNote} from '../src/rail/map-state.ts';
test('rail map publishes runs once, describes stations and track, and only bumps on visible change',()=>{
 assert.deepEqual(uniqueRuns([{from:315,to:339},{from:339,to:315},{from:339,to:338},{from:338,to:339}]),[[315,339],[338,339]]);
 const map={links:[[315,339]] as [number,number][],stations:[{cell:315,index:1,waiting:4},{cell:312,index:2,waiting:0}],train:{x:3,z:13.01,moving:true},running:true};
 const before=railMapRevision();publishRailMap(map);const after=railMapRevision();assert.equal(after,before+1);
 publishRailMap({...map,train:{x:3,z:13.012,moving:true}});assert.equal(railMapRevision(),after,'Sub-pixel train drift does not redraw the map');
 publishRailMap({...map,train:{x:3,z:13.4,moving:true}});assert.equal(railMapRevision(),after+1);
 assert.equal(railCellNote(315),'สถานีรถไฟ 1 · รอ 4 คน');assert.equal(railCellNote(339),'รางรถไฟ');assert.equal(railCellNote(100),'');
 publishRailMap({...map,running:false,train:null});assert.equal(railCellNote(312),'สถานีรถไฟ 2 · ยังไม่เปิดบริการ');
 publishRailMap(null);assert.equal(publishedRailMap(),null);assert.equal(railCellNote(315),'');
});
