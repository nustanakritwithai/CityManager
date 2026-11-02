import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserializeParkSession } from '../src/park-runtime.ts';
import { appendNorthLand, isCanonicalExpandedResourceMap } from '../src/expanded-map-migration.ts';

test('append-only migration preserves the validated legacy city and seed without mutating its source', () => {
  const raw = readFileSync(new URL('./fixtures/retail-v18-park-session.json', import.meta.url), 'utf8');
  const { city } = deserializeParkSession(raw);
  const original = JSON.stringify(city);
  const expanded = appendNorthLand(city);
  const { cells: newCells, resources: newResources, ...rest } = expanded;
  const { cells: oldCells, resources: oldResources, ...oldRest } = city;
  assert.deepEqual(rest, oldRest);
  assert.deepEqual(newCells.slice(0, 576), oldCells);
  assert.deepEqual(newResources.fertility.slice(0, 576), oldResources.fertility);
  assert.equal(newCells.length, 672);
  assert.ok(newCells.slice(576).every(cell => !cell.road && cell.zone === null && cell.building === null));
  assert.equal(newResources.version, 'fertility-2');
  assert.equal(newResources.seed, city.seed);
  assert.equal(isCanonicalExpandedResourceMap(newResources, city.seed), true);
  assert.equal(JSON.stringify(city), original);
  assert.deepEqual(JSON.parse(JSON.stringify(expanded)), expanded);
  assert.deepEqual(appendNorthLand(city), expanded);
  newCells[0].road = !newCells[0].road;
  assert.equal(JSON.stringify(city), original);
});

test('resource validation rejects changes to both old and newly derived cells', () => {
  const raw = readFileSync(new URL('./fixtures/retail-v18-park-session.json', import.meta.url), 'utf8');
  const { city } = deserializeParkSession(raw);
  const map = appendNorthLand(city).resources;
  for (const index of [0,575,576,671]) {
    const fertility = [...map.fertility]; fertility[index] = (fertility[index] + 1) % 101;
    assert.equal(isCanonicalExpandedResourceMap({ ...map, fertility }, city.seed), false);
  }
  const sparse = [...map.fertility]; delete sparse[600];
  assert.equal(isCanonicalExpandedResourceMap({ ...map, fertility: sparse }, city.seed), false);
  assert.equal(isCanonicalExpandedResourceMap({ ...map, seed: city.seed + 1 }, city.seed), false);
  assert.throws(() => appendNorthLand({ ...city, resources: { ...city.resources, fertility: city.resources.fertility.slice(1) } }), /Invalid legacy map/);
});
