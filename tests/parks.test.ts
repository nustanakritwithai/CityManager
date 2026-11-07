import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GATEWAY, SIZE, MONTH, access, buildPark, parkAt, buildPlant, buildRoad, bulldoze, createCity, homeOccupancy, deserialize, serialize, step, zoneCell, type City } from '../src/sim.ts';
import { PARK, MAX_PARKS } from '../src/parks.ts';
import { previewPlacement } from '../src/placement-preview.ts';
import { pocketPark } from '../src/scene-decor.ts';

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
  const charges: City['ledger'] = [];
  const observe = (days: number) => { for (let i = 0; i < days; i++) { step(c); charges.push(...c.ledger.filter(e => e.tick === c.tick && e.reason === `Monthly park upkeep #${id}`)); } };
  observe(MONTH - 1); assert.equal(charges.length, 0);
  observe(1); const entries = () => charges;
  assert.deepEqual(entries().map(e => [e.tick, e.amount, e.from, e.to]), [[30, PARK.upkeep, 'treasury', 'upkeep']]);
  c = deserialize(serialize(c)); observe(1); assert.equal(entries().length, 1);
  observe(MONTH - 1); assert.deepEqual(entries().map(e => e.tick), [30, 60]);
  const before = c.accounts.treasury; assert.equal(bulldoze(c, 0).ok, true);
  assert.equal(c.accounts.treasury, before + PARK.cost * .8); assert.equal(c.parks.length, 0);
  assert.equal(c.ledger.filter(e => e.reason === `Demolition refund park #${id}`).length, 1);
  const after = c.accounts.treasury; assert.equal(bulldoze(c, 0).ok, true); assert.equal(c.accounts.treasury, after);
  observe(60); assert.equal(entries().length, 2); assert.equal(sum(c), 0);
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
  const c = city(); buildPark(c, 0); const raw = JSON.parse(serialize(c)); assert.equal(raw.version, 27); assert.equal(raw.rulesVersion, 'chain-22'); assert.equal(raw.commercialBaseVersion, 22);
  for (const change of [
    (x: any) => { x.parks[0].width = 2; }, (x: any) => { x.parks[0].cells = [0, 1]; },
    (x: any) => { x.parks[0].level = 0; }, (x: any) => { x.parks[0].level = 2; },
    (x: any) => { x.parks[0].cell = GATEWAY; }, (x: any) => { x.parks[0].tick = 100; },
    (x: any) => { x.parks.push({ ...x.parks[0] }); }, (x: any) => { x.parks[0].id = x.nextId; },
    (x: any) => { x.ledger = x.ledger.filter((e: any) => !/^Build park/.test(e.reason)); },
    (x: any) => { delete x.parks; },
  ]) { const invalid = structuredClone(raw); change(invalid); assert.throws(() => deserialize(JSON.stringify(invalid)), /corrupt/i); }
  // The v15 fixture has no parks; it is also valid under v13 after removing the park section.
  const old = JSON.parse(readFileSync(new URL('./fixtures/retail-v15.json', import.meta.url), 'utf8'));
  assert.deepEqual(old.parks, []); delete old.parks; old.version = 13; old.rulesVersion = 'chain-8';
  const loaded = deserialize(JSON.stringify(old)); assert.deepEqual(loaded.parks, []);
  for (const key of ['accounts', 'buildings', 'households', 'firms', 'rng', 'tick', 'nextId']) assert.deepEqual((loaded as any)[key], old[key]);
  assert.deepEqual(loaded.ledger, old.ledger.filter((e: any) => e.tick > (loaded.history?.throughTick ?? -1)));
});



test('no-park cities keep accounting and owner distributions deterministic through saves and residential growth', () => {
  // Independent hashes were produced by main 31389949527c8d0b3eee4bfec5326d62df839721.
  // The only intended financial difference in this scenario is the three new service
  // bills; normalize their explicit amounts back out before comparing all state
  // except journals/checkpoint metadata, which have their own assertions below.
  const expected = new Map([
    [61025, { owner: 'household:4', amounts: [36420, 72720, 99690], hash: '28c0c38b3cb1829d21672c31345681f4e53404abf02f4d4cd11060a9cee2bd87' }],
    [20261023, { owner: 'household:2', amounts: [29310, 72720, 99570], hash: '4f4406287f83d464ff646df8ccb2931f72e93e9a47f1ea3e7e1e18f3251fcd9a' }],
  ]);
  for (const historicalSoil of [true, false]) for (const seed of [61025, 20261023]) {
    const c = createCity(seed);
    if (historicalSoil) delete c.farmSoilIndependentStartTick; // Frozen pre-change trajectory is checked separately from current uniform production.
    run(c, 59); const loaded = deserialize(serialize(c));
    if (historicalSoil) delete loaded.farmSoilIndependentStartTick;
    const payouts = c.ledger.filter(e => e.reason === 'Owner profit distribution').map(e => [e.tick, e.from, e.to, e.amount]);
    const bills = c.ledger.filter(e => e.reason === 'Monthly municipal services').map(e => e.amount);
    for (let d = 60; d <= 120; d++) {
      step(c); step(loaded);
      assert.deepEqual(c, loaded, `seed ${seed}, day ${d}`);
      payouts.push(...c.ledger.filter(e => e.tick === d && e.reason === 'Owner profit distribution').map(e => [e.tick, e.from, e.to, e.amount]));
      bills.push(...c.ledger.filter(e => e.tick === d && e.reason === 'Monthly municipal services').map(e => e.amount));
      if (d === 119 && historicalSoil) {
        assert.deepEqual(bills, [24000, 24000, 33000]);
        assert.deepEqual(payouts, expected.get(seed)!.amounts.map((amount, index) => [30 * (index + 1), 'firm:8', expected.get(seed)!.owner, amount]));
        const { farmSoilIndependentStartTick: _soil, ledger: _ledger, history: _history, goalRulesVersion: _goal, accounts, ...state } = c;
        const amount = bills.reduce((n, value) => n + value, 0);
        const normalized = { ...state, accounts: { ...accounts, treasury: accounts.treasury + amount, upkeep: accounts.upkeep - amount } };
        assert.equal(createHash('sha256').update(JSON.stringify(normalized)).digest('hex'), expected.get(seed)!.hash, `seed ${seed} pre-PR main trajectory after accounting for service bills`);
      }
      assert.deepEqual(c.parks, []); assert.equal(sum(c), 0);
      assert.ok(!c.ledger.some(e => /^Monthly park (wages|upkeep)/.test(e.reason)));
      const balances: Record<string, number> = { ...c.history?.accounts };
      for (const e of c.ledger) { balances[e.from] = (balances[e.from] ?? 0) - e.amount; balances[e.to] = (balances[e.to] ?? 0) + e.amount; }
      for (const key of new Set([...Object.keys(c.accounts), ...Object.keys(balances)])) assert.equal(balances[key] ?? 0, c.accounts[key] ?? 0, key);
    }
    for (const b of c.buildings.filter(b => b.zone === 'R' && b.level >= 4)) assert.ok(homeOccupancy(c, b.id).households >= 3, 'apartment tier is reached only from a full cottage');
  }
});
