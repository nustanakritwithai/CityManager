import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, serialize } from '../src/sim.ts';
import { createCity as createLegacy, serialize as serializeLegacy, step as stepLegacy } from '../src/legacy-v4.ts';
import { questionEntryCity } from './city-questions-entry.ts';
import { EXPANDED_MAP_CELLS, LEGACY_MAP_CELLS } from '../src/expanded-map-grid.ts';

for (const [name, fixture] of [
  ['new unexpanded city', () => createCity(61025)],
  ['mature legacy city', () => { const old = createLegacy(61025); for (let d = 0; d < 90; d++) stepLegacy(old); return deserialize(serializeLegacy(old)); }],
] as const) test(`question entry preserves ${name} while adding northern land`, () => {
  const original = fixture(), raw = serialize(original), valid = deserialize(raw), expanded = questionEntryCity(original);
  assert.equal(original.cells.length, LEGACY_MAP_CELLS); assert.equal(expanded.cells.length, EXPANDED_MAP_CELLS);
  assert.deepEqual(expanded.cells.slice(0, LEGACY_MAP_CELLS), valid.cells);
  assert.ok(expanded.cells.slice(LEGACY_MAP_CELLS).every(cell => !cell.road && cell.zone === null && cell.building === null));
  assert.deepEqual(expanded.resources.fertility.slice(0, LEGACY_MAP_CELLS), valid.resources.fertility);
  assert.equal(expanded.resources.version, 'fertility-2'); assert.equal(expanded.resources.fertility.length, EXPANDED_MAP_CELLS);
  const { cells: _cells, resources: _resources, ...before } = valid;
  const { cells: _newCells, resources: _newResources, ...after } = expanded;
  assert.deepEqual(after, before, 'every non-map field stays exact');
  assert.equal(serialize(original), raw, 'the acknowledged original is never rewritten');
  assert.deepEqual(deserialize(serialize(expanded)), expanded, 'expanded result remains loadable');
});
