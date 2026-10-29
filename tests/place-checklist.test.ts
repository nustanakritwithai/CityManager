import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, zoneCell, buildRoad, explainCell, serialize, editRoadJunction, access, GATEWAY, SIZE } from '../src/sim.ts';
import { parcelChecklist, roadFacts } from '../src/place-checklist.ts';
import { gatewayRoadDistance } from '../src/road-network.ts';

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

test('a short utility network fails the matching checklist rows', () => {
  const city = createCity(61025);
  city.utilities.outside = { power: 0, water: 0 };
  const home = city.cells.findIndex((cell, i) => cell.zone === 'R' && cell.building === null && access(city, i));
  const homeStopped = explainCell(city, home).slice(1, -2);
  const homeList = parcelChecklist(city, home)!;
  assert.ok(homeStopped.some(line => line.startsWith('Not enough power:')));
  assert.ok(homeStopped.some(line => line.startsWith('Not enough water:')));
  assert.equal(homeList.checks.filter(check => check.state === 'fail').length, homeStopped.length);
  assert.equal(homeList.eligible, false);
  assert.equal(homeList.checks.find(check => check.key === 'power')?.state, 'fail');
  assert.equal(homeList.checks.find(check => check.key === 'water')?.state, 'fail');
  assert.equal(homeList.checks.find(check => check.key === 'road')?.state, 'pass');

  const farm = city.cells.findIndex((cell, i) => !cell.road && cell.zone === null && cell.building === null && access(city, i));
  assert.equal(zoneCell(city, farm, 'F').ok, true);
  const farmStopped = explainCell(city, farm).slice(1, -2);
  const farmList = parcelChecklist(city, farm)!;
  assert.equal(farmList.checks.filter(check => check.state === 'fail').length, farmStopped.length);
  assert.equal(farmList.checks.find(check => check.key === 'water')?.state, 'fail');
  assert.equal(farmList.checks.find(check => check.key === 'power'), undefined);

  const factory = city.cells.findIndex((cell, i) => cell.zone === 'I' && cell.building === null && access(city, i));
  const factoryStopped = explainCell(city, factory).slice(1, -2);
  const factoryList = parcelChecklist(city, factory)!;
  assert.ok(factoryStopped.some(line => line.startsWith('A new factory needs ')));
  assert.equal(factoryList.checks.filter(check => check.state === 'fail').length, factoryStopped.length);
  assert.match(factoryList.checks.find(check => check.key === 'industry')?.detail ?? '', /โรงไฟฟ้าหรือโรงสูบน้ำ/);
  assert.equal(factoryList.checks.find(check => check.key === 'power'), undefined);
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

test('cutting the gateway junction removes the distance through that link', () => {
  const city = createCity();
  const beyond = GATEWAY + 10;
  assert.equal(roadFacts(city, beyond)!.stepsToGateway, gatewayRoadDistance(city, beyond));
  assert.equal(editRoadJunction(city, GATEWAY, GATEWAY + 1, false).ok, true);
  const facts = roadFacts(city, beyond)!;
  assert.equal(facts.connected, false);
  assert.equal(facts.stepsToGateway, null);
  assert.equal(gatewayRoadDistance(city, beyond), null);
  assert.equal(roadFacts(city, GATEWAY)!.stepsToGateway, 0);
  assert.equal(roadFacts(city, GATEWAY)!.connected, true);
});
