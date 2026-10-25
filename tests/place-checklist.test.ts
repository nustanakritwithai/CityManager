import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, zoneCell, buildRoad, explainCell, serialize, GATEWAY, SIZE } from '../src/sim.ts';
import { parcelChecklist, roadFacts } from '../src/place-checklist.ts';

test('vacant parcel checklist fails exactly the simulator blockers and is read-only', () => {
  const city = createCity();
  const cell = city.cells.findIndex((c, i) => !c.road && !c.zone && c.building === null && i > SIZE * 20);
  zoneCell(city, cell, 'R');
  const before = serialize(city), list = parcelChecklist(city, cell)!, stopped = explainCell(city, cell).slice(1, -2);
  assert.equal(serialize(city), before);
  assert.equal(list.checks.filter(c => c.state === 'fail').length, stopped.length);
  assert.equal(list.eligible, stopped.length === 0);
  const road = list.checks.find(c => c.key === 'road')!;
  assert.equal(road.state, 'fail'); assert.equal(road.detail, 'ยังไม่มีถนนข้างแปลงที่เชื่อมถึงประตูภายนอก');
  assert.ok(list.checks.some(c => c.key === 'housing-demand'));
  assert.ok(!list.checks.some(c => c.key === 'owner' || c.key === 'fertility'), 'Only checks for this zone are listed');
});

test('checklist is null for roads and unzoned land', () => {
  const city = createCity();
  assert.equal(parcelChecklist(city, GATEWAY), null);
  assert.equal(parcelChecklist(city, city.cells.findIndex(c => !c.road && !c.zone)), null);
});

test('road facts measure the route to the gateway along roads', () => {
  const city = createCity();
  const gate = roadFacts(city, GATEWAY)!;
  assert.deepEqual([gate.gateway, gate.connected, gate.stepsToGateway], [true, true, 0]);
  assert.equal(gate.network, city.cells.filter(c => c.road).length);
  assert.equal(roadFacts(city, city.cells.findIndex(c => !c.road)), null);
  for (const [i, c] of city.cells.entries()) if (c.road && i !== GATEWAY) {
    const f = roadFacts(city, i)!; assert.equal(f.connected, f.stepsToGateway !== null); if (f.stepsToGateway !== null) assert.ok(f.stepsToGateway > 0);
  }
  const far = GATEWAY + 12 - SIZE * 8; buildRoad(city, far, far);
  if (city.cells[far].road) { const f = roadFacts(city, far)!; assert.equal(f.connected, false); assert.equal(f.stepsToGateway, null); }
});
