import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCity, step, deserialize, serialize, summary, bulldoze, moveHousehold, housingCapacity, homeOccupancy, employmentForHousehold, firmWorkerCount, householdWorkerCount, explainCell, GATEWAY, WAGES, MONTH, type City, type Household } from '../src/sim.ts';
import { deserializeV1 } from '../src/legacy-v1.ts';

const frozen = readFileSync(new URL('./fixtures/legacy-v1-day65.json', import.meta.url), 'utf8');
const advance = (c: City, days: number) => { for (let i = 0; i < days; i++) step(c); return c; };
const populated = (day = 180) => advance(createCity(61025), day);

test('frozen v1 migration preserves history, clocks, claims and IDs with explicit minimum legacy composition', () => {
  assert.equal(createHash('sha256').update(frozen).digest('hex'), '4e358e66acdfb55dcfd434aaf67be51ccea99c69fc5a2b9b44343035c16166d0');
  const old = deserializeV1(frozen), migrated = deserialize(frozen);
  assert.equal(migrated.version, 2); assert.equal(migrated.rulesVersion, 'household-1');
  for (const key of ['seed', 'rng', 'tick', 'nextId', 'accounts', 'ledger', 'goodsLedger', 'goods', 'lastEvent'] as const) assert.deepEqual(migrated[key], old[key]);
  assert.equal(migrated.households.length, old.households.length);
  assert.equal(migrated.migration.legacyHouseholds, 6); assert.equal(migrated.migration.arrivals, 6);
  for (const h of migrated.households) {
    const source = old.households.find(value => value.id === h.id)!;
    assert.deepEqual([h.members, h.workforce, h.dependents, h.profile, h.origin], [1, 1, 0, 'legacy-worker', 'legacy-v1']);
    assert.equal(h.wallet, source.wallet); assert.equal(h.home, source.home); assert.ok(!Object.hasOwn(h, 'employer'));
    assert.deepEqual(employmentForHousehold(migrated, h.id).map(e => [e.firmId, e.workers]), source.employer === null ? [] : [[source.employer, 1]]);
  }
  for (const f of migrated.firms) { assert.deepEqual(f.workDays, old.firms.find(value => value.id === f.id)!.workDays); assert.ok(!Object.hasOwn(f, 'employees')); }
  assert.equal(serialize(deserialize(frozen)), serialize(migrated));
  assert.equal(serialize(deserialize(serialize(migrated))), serialize(migrated));
  const corrupt = JSON.parse(frozen); corrupt.accounts.treasury++;
  assert.throws(() => deserialize(JSON.stringify(corrupt))); // Old validation happens before migration.
});

test('homes are empty on construction day and admit at most one independently funded household per later day', () => {
  const c = createCity(61025);
  let observedEmpty = false;
  for (let n = 0; n < 180; n++) {
    step(c);
    for (const b of c.buildings.filter(b => b.zone === 'R' && b.age === 0)) {
      assert.deepEqual(homeOccupancy(c, b.id), { households: 0, persons: 0 }); observedEmpty = true;
    }
    const today = c.ledger.filter(e => e.tick === c.tick && e.reason === 'New household arrival savings');
    assert.ok(today.length <= 1);
    assert.ok(today.every(e => e.from === 'outside' && e.amount === 150000));
    assert.doesNotThrow(() => deserialize(serialize(c)));
  }
  assert.ok(observedEmpty); assert.ok(c.households.some(h => h.profile === 'family'));
  assert.equal(c.migration.arrivals, c.households.length);
  const s = summary(c);
  assert.equal(s.population, c.households.reduce((n, h) => n + h.members, 0));
  assert.equal(s.workforce, c.households.reduce((n, h) => n + h.workforce, 0));
  assert.equal(s.population, s.workforce + s.dependents); assert.notEqual(s.population, s.households);
});

test('an actual home upgrade increases room without adding members or households to that home', () => {
  const c = populated(119);
  const home = c.buildings.find(b => b.zone === 'R' && homeOccupancy(c, b.id).households === 1 && c.households.some(h => h.home === b.id && householdWorkerCount(c, h.id) > 0 && c.tick - h.lastPurchaseTick <= 3))!;
  assert.ok(home); home.level = 1;
  const before = c.households.filter(h => h.home === home.id).map(h => [h.id, h.members]);
  step(c);
  assert.equal(home.level, 2);
  assert.deepEqual(c.households.filter(h => h.home === home.id).map(h => [h.id, h.members]), before);
  assert.deepEqual(housingCapacity(home), { households: 2, persons: 8 });
});

test('moves enforce both capacities and preserve household identity, savings, claims and admission count', () => {
  const c = populated(185), h = c.households.find(h => h.profile === 'family')!;
  const destination = c.buildings.find(b => b.zone === 'R' && b.id !== h.home && housingCapacity(b).households > homeOccupancy(c, b.id).households && housingCapacity(b).persons - homeOccupancy(c, b.id).persons >= h.members)!;
  const before = { ...h }, accounts = JSON.stringify(c.accounts), ledger = JSON.stringify(c.ledger), claims = JSON.stringify(c.firms.map(f => f.workDays)), arrivals = c.migration.arrivals;
  assert.equal(moveHousehold(c, h.id, destination.id).ok, true);
  assert.deepEqual({ ...h, home: before.home }, before);
  assert.equal(JSON.stringify(c.accounts), accounts); assert.equal(JSON.stringify(c.ledger), ledger); assert.equal(JSON.stringify(c.firms.map(f => f.workDays)), claims); assert.equal(c.migration.arrivals, arrivals);
  const repeated = serialize(c); assert.equal(moveHousehold(c, h.id, destination.id).ok, true); assert.equal(serialize(c), repeated);
  const full = c.buildings.find(b => b.zone === 'R' && b.id !== h.home && homeOccupancy(c, b.id).households > 0)!;
  assert.ok(full);
  // Fixture with precisely occupied capacity; no resident or money is changed.
  full.level = homeOccupancy(c, full.id).households;
  const blocked = serialize(c);
  assert.equal(moveHousehold(c, h.id, full.id).ok, false); assert.equal(serialize(c), blocked);
  assert.doesNotThrow(() => deserialize(serialize(c)));
});

test('home demolition displaces families without deleting savings or earned claims, then rehouses before immigration', () => {
  const c = populated(185), home = c.buildings.find(b => b.zone === 'R' && homeOccupancy(c, b.id).households > 0)!;
  const affected = c.households.filter(h => h.home === home.id), identities = affected.map(h => h.id), funds = affected.map(h => c.accounts[h.wallet]);
  const count = c.households.length, persons = summary(c).population, claims = JSON.stringify(c.firms.map(f => f.workDays)), arrivals = c.migration.arrivals;
  assert.equal(bulldoze(c, home.cell).ok, true);
  assert.equal(c.households.length, count); assert.equal(summary(c).population, persons);
  assert.ok(affected.every(h => h.home === null)); assert.ok(c.employment.every(e => !identities.includes(e.householdId)));
  assert.deepEqual(affected.map(h => c.accounts[h.wallet]), funds); assert.equal(JSON.stringify(c.firms.map(f => f.workDays)), claims);
  assert.equal(c.migration.arrivals, arrivals); assert.doesNotThrow(() => deserialize(serialize(c)));
  step(c);
  assert.ok(affected.every(h => h.home !== null && h.home !== home.id));
  assert.ok(affected.every(h => c.households.some(current => current === h)));
  assert.equal(c.migration.arrivals, arrivals); assert.doesNotThrow(() => deserialize(serialize(c)));
});

test('one family can split two workers across establishments and receives exact reserved wages for both', () => {
  const c = populated(120), h = c.households.find(h => h.workforce === 2)!, factory = c.firms.find(f => f.zone === 'I')!, shop = c.firms.find(f => f.zone === 'C')!;
  c.employment = c.employment.filter(e => e.householdId !== h.id && e.firmId !== shop.id);
  c.employment.push({ householdId: h.id, firmId: factory.id, occupation: 'manufacturing', rank: 'entry', workers: 1 }, { householdId: h.id, firmId: shop.id, occupation: 'retail', rank: 'entry', workers: 1 });
  assert.doesNotThrow(() => deserialize(serialize(c)));
  step(c);
  assert.equal(householdWorkerCount(c, h.id), 2); assert.equal(employmentForHousehold(c, h.id).length, 2);
  assert.equal(factory.workDays[h.wallet], 1); assert.equal(shop.workDays[h.wallet], 1);
  assert.equal(c.ledger.filter(e => e.tick === c.tick && e.reason.includes('purchase') && e.from === h.wallet).length, 1);
  advance(c, 29);
  const wages = c.ledger.filter(e => e.tick === 150 && e.reason === 'Monthly wages' && e.to === h.wallet);
  assert.deepEqual(wages.map(e => [e.from, e.amount]).sort(), [[factory.wallet, 60000], [shop.wallet, 42000]].sort());
  assert.ok(c.firms.every(f => Object.keys(f.workDays).length === 0)); assert.doesNotThrow(() => deserialize(serialize(c)));
});

test('disconnection clears worker allocations on the next daily tick without losing previously earned claims', () => {
  const c = populated(185), claims = JSON.stringify(c.firms.map(f => f.workDays)), population = summary(c).population;
  bulldoze(c, GATEWAY + 1); step(c);
  assert.equal(c.employment.length, 0); assert.equal(summary(c).population, population);
  assert.equal(JSON.stringify(c.firms.map(f => f.workDays)), claims);
  assert.equal(c.ledger.filter(e => e.tick === c.tick && e.reason.includes('purchase')).length, 0);
  assert.doesNotThrow(() => deserialize(serialize(c)));
});

test('usable vacant capacity suppresses extra development and the household admission cap cannot block replacement homes', () => {
  const c = createCity(1); c.tick = 10;
  // A valid bounded historical fixture: 128 existing minimum legacy households are displaced.
  for (let id = 1; id <= 128; id++) {
    const wallet = `household:${id}`;
    const h: Household = { id, home: null, members: 1, workforce: 1, dependents: 0, profile: 'legacy-worker', origin: 'legacy-v1', wallet, lastPurchaseTick: -1, needs: 0 };
    c.households.push(h); c.accounts[wallet] = 150000; c.accounts.outside -= 150000;
    c.ledger.push({ tick: 0, from: 'outside', to: wallet, amount: 150000, reason: 'Historical household savings' });
  }
  c.nextId = 129; c.migration = { arrivals: 128, legacyHouseholds: 128 };
  assert.doesNotThrow(() => deserialize(serialize(c)));
  advance(c, 3);
  assert.ok(c.buildings.some(b => b.zone === 'R'));
  assert.ok(c.households.some(h => h.home !== null));
  assert.equal(c.households.length, 128); assert.equal(c.migration.arrivals, 128);
  assert.doesNotThrow(() => deserialize(serialize(c)));
  const stable = populated();
  for (const f of stable.firms) { stable.accounts.outside += stable.accounts[f.wallet]; stable.accounts[f.wallet] = 0; }
  assert.equal(summary(stable).demand.R, 0); // Unfunded vacancies cannot commission endless empty housing.
});

test('v2 reader rejects overcapacity, duplicate worker authority, invalid composition and forged allocation totals', () => {
  const c = populated(), original = serialize(c);
  for (const mutate of [
    (x: any) => x.households[0].members = 0,
    (x: any) => x.households[0].members = 2.5,
    (x: any) => x.households[0].home = 99999,
    (x: any) => x.households[0].employer = null,
    (x: any) => x.firms[0].employees = [],
    (x: any) => x.employment.push({ ...x.employment[0] }),
    (x: any) => x.employment[0].workers = 1000,
    (x: any) => x.employment[0].occupation = 'invented',
    (x: any) => x.employment[0].rank = 'promoted',
    (x: any) => x.migration.arrivals--,
    (x: any) => x.buildings.find((b: any) => b.zone === 'R').housingType = 'unknown',
    (x: any) => { const home = x.buildings.find((b: any) => b.zone === 'R'); home.level = 1; for (const h of x.households) h.home = home.id; },
  ]) { const bad = JSON.parse(original); mutate(bad); assert.throws(() => deserialize(JSON.stringify(bad))); }
  assert.equal(serialize(c), original);
});

test('retained departed wallets reserve their IDs in v2 and in strict-v1 migration', () => {
  const legacy = deserializeV1(frozen), departed = [...legacy.households].sort((a, b) => b.id - a.id)[0];
  const record = (from: string, to: string, amount: number, reason: string) => {
    legacy.accounts[from] -= amount; legacy.accounts[to] += amount;
    legacy.ledger.push({ tick: legacy.tick, from, to, amount, reason });
  };
  // Reproduce v1's real emigration settlement while retaining its now-zero historical wallet.
  for (const firm of legacy.firms) {
    const days = firm.workDays[departed.wallet] ?? 0;
    if (days) {
      const wage = days * WAGES[firm.zone] / MONTH;
      delete firm.workDays[departed.wallet]; record(firm.wallet, departed.wallet, wage, 'Monthly wages');
      firm.monthlyExpense += wage;
      record(departed.wallet, 'treasury', Math.floor(wage / 10), 'Monthly household wage tax');
    }
    firm.employees = firm.employees.filter(id => id !== departed.id);
  }
  record(departed.wallet, 'outside', legacy.accounts[departed.wallet], 'Emigration savings');
  const oldHome = legacy.buildings.find(b => b.id === departed.home)!;
  legacy.cells[oldHome.cell] = { road: false, zone: null, building: null };
  legacy.buildings = legacy.buildings.filter(b => b.id !== oldHome.id);
  legacy.households = legacy.households.filter(h => h.id !== departed.id);
  const safeRaw = JSON.stringify(legacy), valid = deserialize(safeRaw);
  assert.equal(valid.accounts[departed.wallet], 0);
  assert.ok(!valid.households.some(h => h.id === departed.id));
  const activeMax = Math.max(...valid.buildings.map(b => b.id), ...valid.households.map(h => h.id), ...valid.firms.map(f => f.id));
  assert.ok(departed.id > activeMax);
  const forgedV2 = JSON.parse(serialize(valid)); forgedV2.nextId = departed.id;
  assert.throws(() => deserialize(JSON.stringify(forgedV2)));
  legacy.nextId = departed.id;
  assert.doesNotThrow(() => deserializeV1(JSON.stringify(legacy))); // Frozen old reader's hole remains unmodified.
  assert.throws(() => deserialize(JSON.stringify(legacy))); // Migration rejects; it never renumbers history.
  assert.equal(serialize(deserialize(safeRaw)), serialize(valid));
});

test('exhausted ID counters reject unsafe saves and never create entities or funding before a blocked allocation', () => {
  const c = createCity(61025), saved = JSON.parse(serialize(c));
  for (const nextId of [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1]) {
    assert.throws(() => deserialize(JSON.stringify({ ...saved, nextId })));
    const legacy = JSON.parse(frozen); legacy.nextId = nextId;
    assert.doesNotThrow(() => deserializeV1(JSON.stringify(legacy)));
    assert.throws(() => deserialize(JSON.stringify(legacy)));
  }
  c.nextId = Number.MAX_SAFE_INTEGER - 2;
  assert.doesNotThrow(() => deserialize(serialize(c)));
  const outside = c.accounts.outside, initialLedger = c.ledger.length, rng = c.rng;
  advance(c, 6);
  assert.equal(c.buildings.length, 0); assert.equal(c.households.length, 0); assert.equal(c.firms.length, 0);
  assert.equal(c.accounts.outside, outside); assert.equal(c.nextId, Number.MAX_SAFE_INTEGER - 2); assert.equal(c.rng, rng);
  assert.ok(c.ledger.slice(initialLedger).every(entry => entry.reason === 'Daily road upkeep'));
  assert.match(explainCell(c, 11 * 24 + 2).join(' '), /ID range exhausted/);
  assert.doesNotThrow(() => deserialize(serialize(c)));
});

test('funded historical wage claims cannot exceed a firm physical worker-day capacity', () => {
  const c = populated(181), factory = c.firms.find(f => f.zone === 'I')!;
  const forged = JSON.parse(serialize(c));
  for (const firm of forged.firms) firm.workDays = {};
  const target = forged.firms.find((firm: any) => firm.id === factory.id);
  for (const h of forged.households) target.workDays[h.wallet] = h.workforce;
  const claimed = Object.values(target.workDays).reduce((n: number, days) => n + (days as number), 0);
  const slots = c.buildings.find(b => b.id === factory.building)!.level + 3;
  assert.ok(claimed > slots); // Each household is individually within its one-day workforce bound.
  assert.ok(claimed * WAGES.I / MONTH <= c.accounts[factory.wallet]);
  assert.throws(() => deserialize(JSON.stringify(forged)));

  const legacy = deserializeV1(frozen), shop = legacy.firms.find(f => f.zone === 'C')!;
  for (const firm of legacy.firms) firm.workDays = {};
  for (const h of legacy.households) shop.workDays[h.wallet] = legacy.tick % MONTH;
  assert.ok(Object.values(shop.workDays).reduce((n, days) => n + days, 0) * WAGES.C / MONTH <= legacy.accounts[shop.wallet]);
  assert.doesNotThrow(() => deserializeV1(JSON.stringify(legacy)));
  assert.throws(() => deserialize(JSON.stringify(legacy)));
});
