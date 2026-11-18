import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, type City } from '../src/sim.ts';
import { MAX_DISTRICTS, createDistrict, deleteDistrict, districtAt, paintDistrict, renameDistrict, validateDistricts } from '../src/districts.ts';
import { districtStats } from '../src/district-stats.ts';
import { mapOverlay, TOOL_OVERLAY } from '../src/map-overlay.ts';

const grown = () => { const c = createCity(61025); for (let i = 0; i < 40; i++) step(c); return c; };

test('a city without districts saves byte-identically; the last district removed drops the section', () => {
  const c = grown(), before = serialize(c);
  assert.equal('districts' in c, false); assert.equal(serialize(deserialize(before)), before);
  const d = createDistrict(c, '  ตลาด   เก่า ')!; assert.equal(d.name, 'ตลาด เก่า'); assert.equal(d.id, 1);
  assert.equal(deleteDistrict(c, d.id), true); assert.equal('districts' in c, false);
});

test('painting moves parcels between districts, never into two, and survives a save', () => {
  const c = grown(), a = createDistrict(c, 'เหนือ')!, b = createDistrict(c, 'ใต้')!;
  assert.equal(paintDistrict(c, a.id, [1, 2, 3, 2, -1, 1e9]), 3, 'duplicates and parcels off the map are ignored');
  assert.equal(paintDistrict(c, b.id, [3, 4]), 2);
  assert.deepEqual(c.districts!.list.map(d => d.cells), [[1, 2], [3, 4]]);
  assert.equal(districtAt(c, 3)?.id, b.id);
  assert.equal(paintDistrict(c, null, [1]), 1); assert.equal(districtAt(c, 1), undefined);
  assert.equal(renameDistrict(c, a.id, 'เหนือใหม่'), true); assert.equal(renameDistrict(c, a.id, '   '), false);
  const saved = serialize(c); assert.deepEqual(deserialize(saved).districts, c.districts); assert.equal(serialize(deserialize(saved)), saved);
});

test('at most eight districts; freed slots are reused', () => {
  const c = grown();
  for (let i = 0; i < MAX_DISTRICTS; i++) assert.ok(createDistrict(c, `ย่าน ${i + 1}`));
  assert.equal(createDistrict(c, 'เกิน'), null);
  deleteDistrict(c, 3); assert.equal(createDistrict(c, 'ใหม่')!.id, 3);
});

test('district readings count the households living on its parcels', () => {
  const c = grown(), d = createDistrict(c, 'ทั้งเมือง')!;
  paintDistrict(c, d.id, c.cells.map((_, i) => i));
  const [stats] = districtStats(c);
  assert.equal(stats.households, c.households.filter(h => h.home !== null).length);
  assert.equal(stats.people, c.households.filter(h => h.home !== null).reduce((n, h) => n + h.members, 0));
  assert.equal(stats.parcels, c.cells.length); assert.ok(stats.happiness !== null && stats.landValue !== null);
});

test('the district tool shows each district in its own colour with its name in the legend', () => {
  const c: City = grown(), a = createDistrict(c, 'เหนือ')!, b = createDistrict(c, 'ใต้')!;
  paintDistrict(c, a.id, [10, 11]); paintDistrict(c, b.id, [20]);
  assert.equal(TOOL_OVERLAY.district, 'districts');
  const overlay = mapOverlay(c, 'districts');
  assert.deepEqual(overlay.cells.map(cell => [cell.cell, cell.tone]), [[10, 'd1'], [11, 'd1'], [20, 'd2']]);
  assert.deepEqual(overlay.legend, [['d1', 'เหนือ'], ['d2', 'ใต้']]);
});

test('a malformed districts section is rejected', () => {
  const ok = { version: 1, list: [{ id: 1, name: 'ก', cells: [1, 2] }] };
  validateDistricts(ok, 10);
  for (const bad of [null, { version: 1, list: [] }, { version: 2, list: ok.list }, { version: 1, list: [{ id: 1, name: 'ก', cells: [2, 1] }] },
    { version: 1, list: [{ id: 1, name: 'ก', cells: [1] }, { id: 2, name: 'ข', cells: [1] }] }, { version: 1, list: [{ id: 9, name: 'ก', cells: [] }] },
    { version: 1, list: [{ id: 1, name: ' ก', cells: [] }] }, { version: 1, list: [{ id: 1, name: 'ก', cells: [10] }] }, { version: 1, list: [{ id: 2, name: 'ข', cells: [] }, { id: 1, name: 'ก', cells: [] }] }])
    assert.throws(() => validateDistricts(bad, 10), /Invalid districts save/, JSON.stringify(bad));
  const raw = JSON.parse(serialize(grown())); raw.districts = { version: 1, list: [{ id: 1, name: 'ก', cells: [1, 1] }] };
  assert.throws(() => deserialize(JSON.stringify(raw)), /Invalid districts save/);
});
