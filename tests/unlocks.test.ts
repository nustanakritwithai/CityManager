import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildCivic, civicSiteReason, type City } from '../src/sim.ts';
import { CIVIC_KINDS } from '../src/civic/sites.ts';
import { UNLOCK_POPULATION, cityPopulation, newlyUnlocked, peopleToUnlock, validateUnlocks } from '../src/unlocks.ts';
import { freshServerCityRaw } from '../src/fresh-server-city.ts';
import { deserializeParkSession } from '../src/park-runtime.ts';

const grown = () => { const c = createCity(61025); for (let i = 0; i < 40; i++) step(c); return c; };
const spot = (c: City, kind: 'airport' | 'clinic') => c.cells.map((_, i) => i).find(i => civicSiteReason({ ...c, unlocks: undefined } as City, i, kind) === null)!;

test('cities without the progression flag keep every place open, and their saves are unchanged', () => {
  const c = grown(), before = serialize(c);
  assert.equal('unlocks' in c, false);
  for (const kind of CIVIC_KINDS) assert.equal(peopleToUnlock(c, kind), 0);
  assert.equal(serialize(deserialize(before)), before);
});

test('a newly started city opens larger places as its population grows', () => {
  const fresh = deserializeParkSession(freshServerCityRaw('11111111-1111-4111-8111-111111111111')).city;
  assert.deepEqual(fresh.unlocks, { version: 1 });
  const c = grown(); c.unlocks = { version: 1 };
  const people = cityPopulation(c);
  assert.ok(people < UNLOCK_POPULATION.airport!);
  assert.equal(peopleToUnlock(c, 'airport'), UNLOCK_POPULATION.airport! - people);
  assert.equal(peopleToUnlock(c, 'clinic'), 0, 'kinds without a threshold are open from the start');
  const at = spot(c, 'airport'), before = serialize(c);
  const refused = buildCivic(c, at, 'airport');
  assert.equal(refused.ok, false); assert.match(refused.message, /ปลดล็อกเมื่อเมืองมีประชากร 200 คน/);
  assert.equal(serialize(c), before, 'a refused build changes nothing');
  assert.equal(buildCivic(c, spot(c, 'clinic'), 'clinic').ok, true);
  const saved = serialize(c); assert.deepEqual(deserialize(saved).unlocks, { version: 1 }); assert.equal(serialize(deserialize(saved)), saved);
});

test('crossing a threshold reports exactly the places that opened, smallest first', () => {
  const host = { unlocks: { version: 1 as const } };
  assert.deepEqual(newlyUnlocked(host, 10, 20), ['police', 'fire', 'library']);
  assert.deepEqual(newlyUnlocked(host, 20, 20), []);
  assert.deepEqual(newlyUnlocked(host, 49, 50), ['museum', 'cinema']);
  assert.deepEqual(newlyUnlocked({}, 0, 500), [], 'no flag, no news');
});

test('a malformed unlocks section is rejected on load', () => {
  for (const bad of [null, [], {}, { version: 2 }, { version: 1, extra: true }]) assert.throws(() => validateUnlocks(bad), /Invalid unlocks save/);
  const raw = JSON.parse(serialize(grown())); raw.unlocks = { version: 3 };
  assert.throws(() => deserialize(JSON.stringify(raw)), /Invalid unlocks save/);
});
