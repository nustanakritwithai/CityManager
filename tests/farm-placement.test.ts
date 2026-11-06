import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, zoneCell, serialize, deserialize, explainCell, access, buildPark, buildPlant, GATEWAY, step } from '../src/sim.ts';
import { previewPlacement } from '../src/placement-preview.ts';
import { mapOverlay, TOOL_OVERLAY } from '../src/map-overlay.ts';

test('farm tool does not require or automatically show a colored fertility layer', () => {
  assert.equal(TOOL_OVERLAY.F, undefined);
  const city = createCity(61025);
  assert.equal(mapOverlay(city, 'fertility').legend.length, 3, 'soil overlay data remains intact for existing consumers');
});

test('unzoned parcels in all soil bands accept farms without changing resources or money', () => {
  const city = createCity(61025);
  for (const accepts of [(f: number) => f < 50, (f: number) => f >= 50 && f < 84, (f: number) => f >= 84]) {
    const cell = city.cells.findIndex((c, i) => !c.road && c.zone === null && !city.plants.some(p => p.cell === i) && accepts(city.resources.fertility[i]));
    assert.ok(cell >= 0);
    const before = structuredClone({ resources: city.resources, accounts: city.accounts, ledger: city.ledger });
    const preview = previewPlacement(city, 'F', null, cell)!;
    assert.equal(preview.ok, true);
    assert.match(preview.label, /วางได้ทุกสี/);
    assert.equal(zoneCell(city, cell, 'F').ok, true);
    assert.deepEqual({ resources: city.resources, accounts: city.accounts, ledger: city.ledger }, before);
    assert.deepEqual(deserialize(serialize(city)), city);
  }
});

test('farm zoning does not bypass road access, occupied parcels or map limits', () => {
  const city = createCity(61025);
  assert.equal(zoneCell(city, GATEWAY, 'F').ok, false);
  assert.equal(zoneCell(city, -1, 'F').ok, false);
  assert.equal(zoneCell(city, city.cells.length, 'F').ok, false);
  const plantCell = city.cells.findIndex((c, i) => !c.road && c.zone === null && access(city, i));
  assert.equal(buildPlant(city, plantCell, 'water').ok, true);
  const plant = city.plants[0];
  assert.equal(zoneCell(city, plant.cell, 'F').ok, false);
  const empty = city.cells.findIndex((c, i) => !c.road && c.zone === null && !city.plants.some(p => p.cell === i) && !access(city, i));
  assert.equal(zoneCell(city, empty, 'F').ok, true);
  assert.ok(explainCell(city, empty).some(s => s.startsWith('No connected road frontage')));
  assert.equal(zoneCell(city, empty, null).ok, true);
  assert.equal(buildPark(city, empty).ok, true);
  assert.equal(zoneCell(city, empty, 'F').ok, false);
  assert.equal(previewPlacement(city, 'F', null, empty)!.ok, false);
  for (let i = 0; i < 20; i++) step(city);
  const occupied = city.buildings.find(b => b.zone !== 'F')!;
  assert.ok(occupied);
  assert.equal(zoneCell(city, occupied.cell, 'F').ok, false);
  assert.equal(previewPlacement(city, 'F', null, occupied.cell)!.ok, false);
});

test('a low-fertility unzoned site grows and harvests a real farm after save reload', () => {
  let city = createCity(61025);
  for (let i = 0; i < city.cells.length; i++) if (city.cells[i].zone === 'F') zoneCell(city, i, null);
  const cell = city.cells.findIndex((c, i) => !c.road && c.zone === null && access(city, i) && city.resources.fertility[i] < 50);
  assert.ok(cell >= 0);
  assert.equal(zoneCell(city, cell, 'F').ok, true);
  city = deserialize(serialize(city));
  for (let day = 0; day < 90; day++) step(city);
  const building = city.buildings.find(b => b.cell === cell);
  assert.equal(building?.zone, 'F');
  const farm = city.firms.find(f => f.building === building!.id)!;
  assert.ok(city.cropLedger.some(e => e.kind === 'harvest' && e.to === farm.wallet && e.quantity > 0));
  assert.deepEqual(deserialize(serialize(city)), city);
});
