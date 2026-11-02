import test from 'node:test';import assert from 'node:assert/strict';
import { cellWorldPosition,worldPositionCell,mapLayout,cellMapPosition,mapPositionCell,formatCellCoordinate } from '../src/expanded-map-geometry.ts';
test('world picking and minimap clicks map every cell correctly at desktop and phone sizes',()=>{
 for(const size of [152,260,320,640]) for(let id=0;id<672;id++){
  const w=cellWorldPosition(id);assert.equal(worldPositionCell(w.x,w.z,true),id);
  const p=cellMapPosition(id,size,true), {cell}=mapLayout(size,true);assert.equal(mapPositionCell(p.x+cell/2,p.y+cell/2,size,true),id);
  if(id<576){assert.equal(worldPositionCell(w.x,w.z,false),id);const q=cellMapPosition(id,size,false),m=mapLayout(size,false);assert.equal(mapPositionCell(q.x+m.cell/2,q.y+m.cell/2,size,false),id);}
  else assert.equal(worldPositionCell(w.x,w.z,false),null);
 }
 assert.equal(mapPositionCell(0,0,320,true),null);assert.equal(mapPositionCell(320,320,320,true),null);
 assert.equal(worldPositionCell(-25,0,true),null);assert.equal(worldPositionCell(0,-33,true),null);
});

test('labels retain old row numbers and name northern rows explicitly',()=>{assert.equal(formatCellCoordinate(5),'6,1');assert.equal(formatCellCoordinate(653),'6,เหนือ 1');assert.equal(formatCellCoordinate(581),'6,เหนือ 4');});
