import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GATEWAY, SIZE, MONTH, access, buildPark, parkAt, buildPlant, buildRoad, bulldoze, createCity, homeOccupancy, deserialize, serialize, step, zoneCell, type City } from '../src/sim.ts';
import { PARK, MAX_PARKS } from '../src/parks.ts';
import { previewPlacement } from '../src/placement-preview.ts';
import { pocketPark } from '../src/scene-decor.ts';
import { SAVE_KEY, PARKS_BACKUP_KEY, readStoredCity, saveStoredCity } from '../src/save-storage.ts';

const run = (c: City, days: number) => { for (let d = 0; d < days; d++) step(c); };
const city = () => createCity(61025, { starter: false });
const sum = (c: City) => Object.values(c.accounts).reduce((a, b) => a + b, 0);

test('park builds off-road, occupies exactly one parcel and charges one construction transfer', () => {
  const c = city(), before = structuredClone(c), cells = structuredClone(c.cells);
  assert.equal(access(c, 0), false);
  assert.equal(previewPlacement(c, 'park', null, 0)?.ok, true);
  assert.equal(buildPark(c, 0).ok, true);
  assert.deepEqual(c.parks, [{ id: before.nextId, cell: 0, tick: 0, level: 1 }]);
  assert.deepEqual(c.cells, cells, 'the park has one canonical parcel, no adjacent occupancy or zones');
  assert.equal(c.accounts.treasury, before.accounts.treasury - PARK.cost);
  assert.equal(c.accounts.construction, before.accounts.construction + PARK.cost);
  assert.equal(c.ledger.length, before.ledger.length + 1);
  assert.equal(c.ledger.at(-1)?.reason, `Build park #${before.nextId}`);
  const after = structuredClone(c);
  assert.equal(buildPark(c, 0).ok, false);
  assert.deepEqual(c, after, 'repeated placement does not debit or consume another id');
  assert.equal(pocketPark(c, 0), false, 'municipal park is not decorative pocket park');
  assert.equal(parkAt(c, 1), undefined);
  assert.equal(buildPark(c, 1).ok, true, 'adjacent parcel remains independently usable');
  assert.equal(sum(c), 0);
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('park placement rejects invalid, occupied, zoned, unaffordable or exhausted sites without mutation', () => {
  for (const cell of [-1, 0.5, SIZE * SIZE, NaN, GATEWAY]) {
    const c = city(), before = structuredClone(c); assert.equal(buildPark(c, cell).ok, false); assert.deepEqual(c, before);
  }
  const zoned = city(); zoneCell(zoned, 0, 'R');
  const plant = city(); assert.equal(buildPlant(plant, GATEWAY + 1, 'water').ok, true);
  const poor = city(); poor.accounts.construction += poor.accounts.treasury; poor.accounts.treasury = 0;
  const capped = city(); capped.accounts.treasury += 1_000_000; capped.accounts.outside -= 1_000_000;
  capped.ledger.push({ tick: 0, from: 'outside', to: 'treasury', amount: 1_000_000, reason: 'Test construction budget' });
  for (let i = 0; i < MAX_PARKS; i++) assert.equal(buildPark(capped, i).ok, true);
  const maxId = city(); maxId.nextId = Number.MAX_SAFE_INTEGER;
  for (const [c, cell] of [[zoned, 0], [plant, GATEWAY + 1], [poor, 0], [capped, MAX_PARKS], [maxId, 0]] as const) {
    const before = structuredClone(c); assert.equal(buildPark(c, cell).ok, false); assert.deepEqual(c, before);
    assert.equal(previewPlacement(c, 'park', null, cell)?.ok, false);
  }
});

test('park blocks roads, zones and plants without relaxing their road requirements', () => {
  const c = city(); assert.equal(buildPark(c, 0).ok, true);
  for (const operation of [() => buildRoad(c, 0, 1), () => zoneCell(c, 0, 'R'), () => zoneCell(c, 0, null), () => buildPlant(c, 0, 'water')]) {
    const before = structuredClone(c); assert.equal(operation().ok, false); assert.deepEqual(c, before);
  }
  for (const tool of ['road', 'R', 'power', 'water']) assert.equal(previewPlacement(c, tool, null, 0)?.ok, false);
  assert.equal(buildPlant(c, 1, 'water').ok, false, 'only parks waive road access');
});

test('calendar maintenance charges once per month, including after reload; demolition ends upkeep', () => {
  let c = city(); assert.equal(buildPark(c, 0).ok, true); const id = c.parks[0].id;
  run(c, MONTH - 1); assert.equal(c.ledger.some(e => e.reason === `Monthly park upkeep #${id}`), false);
  run(c, 1); const entries = () => c.ledger.filter(e => e.reason === `Monthly park upkeep #${id}`);
  assert.deepEqual(entries().map(e => [e.tick, e.amount, e.from, e.to]), [[30, PARK.upkeep, 'treasury', 'upkeep']]);
  c = deserialize(serialize(c)); run(c, 1); assert.equal(entries().length, 1);
  run(c, MONTH - 1); assert.deepEqual(entries().map(e => e.tick), [30, 60]);
  const before = c.accounts.treasury; assert.equal(bulldoze(c, 0).ok, true);
  assert.equal(c.accounts.treasury, before - 2000); assert.equal(c.parks.length, 0);
  assert.equal(c.ledger.filter(e => e.reason === `Demolish park #${id}`).length, 1);
  const after = c.accounts.treasury; assert.equal(bulldoze(c, 0).ok, true); assert.equal(c.accounts.treasury, after);
  run(c, 60); assert.equal(entries().length, 2); assert.equal(sum(c), 0);
  assert.deepEqual(deserialize(serialize(c)), c);
});

test('park upkeep follows existing treasury clipping without negative funds or duplicate deductions', () => {
  let c = city(); buildPark(c, 0); run(c, 29);
  // Valid transfer of all but 55 satang to the existing construction account.
  const amount = c.accounts.treasury - 55; c.accounts.treasury -= amount; c.accounts.construction += amount;
  c.ledger.push({ tick: c.tick, from: 'treasury', to: 'construction', amount, reason: 'Test budget exhaustion' });
  step(c); const paid = c.ledger.filter(e => /^Monthly park upkeep/.test(e.reason));
  assert.equal(paid.length, 1); assert.equal(paid[0].amount, 45, 'daily gateway road upkeep is paid first');
  assert.equal(c.accounts.treasury, 0); assert.equal(sum(c), 0);
  c = deserialize(serialize(c)); step(c); assert.equal(c.ledger.filter(e => /^Monthly park upkeep/.test(e.reason)).length, 1);
});

test('v15 validates one-tile level-1 park ownership and construction evidence; old v13 remains intact', () => {
  const c = city(); buildPark(c, 0); const raw = JSON.parse(serialize(c)); assert.equal(raw.version, 22);
  for (const change of [
    (x: any) => { x.parks[0].width = 2; }, (x: any) => { x.parks[0].cells = [0, 1]; },
    (x: any) => { x.parks[0].level = 0; }, (x: any) => { x.parks[0].level = 2; },
    (x: any) => { x.parks[0].cell = GATEWAY; }, (x: any) => { x.parks[0].tick = 100; },
    (x: any) => { x.parks.push({ ...x.parks[0] }); }, (x: any) => { x.parks[0].id = x.nextId; },
    (x: any) => { x.ledger = x.ledger.filter((e: any) => !/^Build park/.test(e.reason)); },
    (x: any) => { delete x.parks; },
  ]) { const invalid = structuredClone(raw); change(invalid); assert.throws(() => deserialize(JSON.stringify(invalid)), /corrupt/i); }
  const oldCity = createCity(61025); run(oldCity, 60); const old = JSON.parse(serialize(oldCity));
  delete old.education; old.version = 13; old.rulesVersion = 'chain-8'; delete old.parks; delete old.factoryProgressionStartTick; delete old.farmLevelStartTick;
  const loaded = deserialize(JSON.stringify(old)); assert.deepEqual(loaded.parks, []);
  for (const key of ['accounts', 'ledger', 'buildings', 'households', 'firms', 'rng', 'tick', 'nextId']) assert.deepEqual((loaded as any)[key], old[key]);
});

test('first park save keeps exact pre-park bytes and backup failure preserves primary save', () => {
  const c = city(), old = JSON.parse(serialize(c)); delete old.parks; delete old.factoryProgressionStartTick; delete old.farmLevelStartTick; old.version = 13; old.rulesVersion = 'chain-8';
  const previous = JSON.stringify(old), map = new Map([[SAVE_KEY, previous]]);
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
  buildPark(c, 0); const next = serialize(c); saveStoredCity(storage, next, null);
  assert.equal(map.get(PARKS_BACKUP_KEY), previous); assert.equal(readStoredCity(storage, 'backup')?.raw, previous);
  saveStoredCity(storage, next, null); assert.equal(map.get(PARKS_BACKUP_KEY), previous);
  const failing = { getItem: (k: string) => k === SAVE_KEY ? previous : null, setItem: () => { throw Error('quota'); } };
  assert.throws(() => saveStoredCity(failing, next, null), /quota/); assert.equal(failing.getItem(SAVE_KEY), previous);
});

test('no-park city matches the pre-density engine until residential progression begins', () => {
  // Re-baselined when education became part of every new city. Without a graduate, day 120
  // does not raise housing. Any apartment that does appear must still be a full cottage.
  const baselines = [[61025, 'd319b45b4283300213db12f3b9eb52f6efa7688f86b6016b177150e3d17cd6a8'], [20261023, '709783b3251ed89b36daa99b2045cf3020a7085ba005df7edc4fc0992eaf447f']] as const;
  for (const [seed, expected] of baselines) { const c = createCity(seed); run(c, 119); const { parks, factoryProgressionStartTick: _factory, farmLevelStartTick: _farm, ...legacy } = c; assert.deepEqual(parks, []); assert.equal(createHash('sha256').update(JSON.stringify(legacy)).digest('hex'), expected); assert.ok(c.buildings.filter(b => b.zone === 'R').every(b => b.level <= 3)); run(c, 1); for (const b of c.buildings.filter(b => b.zone === 'R' && b.level >= 4)) assert.equal(homeOccupancy(c, b.id).households >= 3, true, 'apartment tier is reached only from a full cottage'); }
});
