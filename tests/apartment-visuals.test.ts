import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apartmentLayout } from '../src/apartment-visuals.ts';

test('apartments have exactly 3/4/5 floors, warm flat roofs, bounded attached balconies and courtyards', () => {
  for (const level of [4,5,6]) {
    const l=apartmentLayout(level);
    assert.equal(l.floors,level-1);
    assert.equal(l.parts.filter(p=>/^Apartment floor /.test(p.name)).length,level-1);
    assert.equal(l.parts.filter(p=>p.name==='Apartment balcony deck').length,(level-2)*2);
    assert.equal(l.parts.some(p=>p.name==='Apartment side wing'),level>=5);
    assert.ok(Math.abs(l.roofY+.2-l.height)<1e-10);
    for(const p of l.parts) {
      for(const axis of [0,2]) assert.ok(Math.abs(p.position[axis])+p.size[axis]/2<=.8,`${level} ${p.name} inside parcel`);
      assert.ok(p.position[1]+p.size[1]/2<=l.height);
      assert.ok(p.position[1]-p.size[1]/2>=-1e-10);
    }
    for(const p of l.parts.filter(p=>p.name==='Apartment balcony deck')) assert.ok(p.position[2]-p.size[2]/2<=.28,'balcony attaches to facade');
    assert.ok(l.parts.some(p=>p.name==='Apartment courtyard greenery'));
    assert.equal(l.parts.some(p=>p.name==='Apartment courtyard lamp'),level===6);
    const main=l.parts.find(p=>p.name==='Apartment warm facade')!;
    const wing=l.parts.find(p=>p.name==='Apartment side wing');
    if(wing) assert.ok(wing.position[0]-wing.size[0]/2<=main.position[0]+main.size[0]/2,'wing physically connects to main block');
    if(level===6) {
      assert.ok(wing!.size[0]>=.6); assert.equal(l.parts.filter(p=>p.name==='Apartment wing window').length,4);
      const roof=l.parts.find(p=>p.name==='Apartment flat roof')!;
      for(const x of [-.4,-.03]) assert.ok(x-.16>=roof.position[0]-roof.size[0]/2&&x+.16<=roof.position[0]+roof.size[0]/2,'both tanks fully roof-supported');
    }
  }
});
test('all admitted houses remain ground-centred and R3 house group fits below first apartment', () => {
  for(const name of ['house-a','house-b','house-c','house-d','house-e','house-f','house-g','house-h','house-i']) {
    const b=readFileSync(new URL(`../public/assets/kenney-city/models/${name}.glb`,import.meta.url));
    const j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
    const a=j.accessors[j.meshes[0].primitives[0].attributes.POSITION];
    const span=Math.max(a.max[0]-a.min[0],a.max[2]-a.min[2]);
    assert.ok(Math.abs(a.min[1])<1e-6); assert.ok((a.max[1]-a.min[1])*1.55/span<2.7);
  }
});
