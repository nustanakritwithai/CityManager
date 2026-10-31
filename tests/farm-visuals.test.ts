import test from 'node:test';
import assert from 'node:assert/strict';
import { farmVisualParts, FARM_CROP_COLORS } from '../src/farm-visuals.ts';
import { CROPS } from '../src/goods.ts';
test('all six farm levels have distinct bounded, deterministic geometry', () => {
 const layouts=[];
 for(let level=1;level<=6;level++) {
  const parts=farmVisualParts(level,'rice'); layouts.push(JSON.stringify(parts));
  assert.deepEqual(parts,farmVisualParts(level,'rice'));
  for(const p of parts) for(const axis of [0,2]) assert.ok(Math.abs(p.position[axis])+p.size[axis]/2<=.840001,`${level} ${p.name} stays on parcel`);
  assert.equal(parts.filter(p=>p.name==='Greenhouse glass roof').length,level===6?2:level===5?1:0);
  assert.equal(parts.some(p=>p.name==='Farm yard lamp'),level===6);
  const silos=parts.filter(p=>p.name==='Large farm silo');
  assert.equal(silos.length,level===6?2:level===5?1:0);
  for(const silo of silos) {
   assert.ok(silo.size[1]>1,'High-tier silo is visibly taller than lower-tier storage');
   for(const part of parts.filter(p=>p.name.startsWith('Greenhouse')||p.name.startsWith('Renewable crop row'))) {
    const gap=part.position[2]-part.size[2]/2-(silo.position[2]+.19);
    assert.ok(gap>.1,'Silo including cap stays clear of greenhouse and crops');
   }
  }
  assert.equal(parts.some(p=>p.name==='Irrigation channel'),level===3||level===4);
 }
 assert.equal(new Set(layouts).size,6);
});
test('all levels represent actual selected crop with distinct crop color',()=>{
 assert.equal(new Set(Object.values(FARM_CROP_COLORS)).size,3);
 for(const crop of CROPS) for(let level=1;level<=6;level++) {
  const rows=farmVisualParts(level,crop).filter(p=>p.name.startsWith('Renewable crop row'));
  assert.ok(rows.length>=3); assert.ok(rows.every(p=>p.color===FARM_CROP_COLORS[crop]&&p.name.endsWith(crop)));
 }
});
test('renderer invalidates farms for actual crop choice without relying on fertility changes',async()=>{
 const { readFile }=await import('node:fs/promises');
 const renderer=await readFile(new URL('../src/renderer.ts',import.meta.url),'utf8');
 assert.match(renderer,/farmCrop\(city, farmFirm \?\? \{ building: b.id \}\)/);
 assert.match(renderer,/\$\{fertility\}:\$\{crop\}:\$\{lit\}/);
 assert.match(renderer,/this\.farm\(tile, city\.resources\.fertility\[i\], b\.level, crop!, lit && reach\)/);
});
