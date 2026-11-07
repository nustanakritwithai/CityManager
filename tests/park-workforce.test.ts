import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, step, buildPark, bulldoze, buildRoad, GATEWAY, access, serialize, deserialize, householdWorkerCount, parkEmploymentForHousehold, parkStaffingStatus, treasurySpendable, summary, type City } from '../src/sim.ts';
import { PARK, PARK_STAFF, parkPayroll, parkWorkers } from '../src/parks.ts';
import { householdLabor } from '../src/context-data.ts';
import { householdCardData } from '../src/building-card-data.ts';
import { previewPlacement } from '../src/placement-preview.ts';

const run = (c: City, days: number) => { for (let i = 0; i < days; i++) step(c); };
function isolated(): City {
  const c = createCity(61025); run(c, 45);
  for (let i = 0; i < c.cells.length; i++) if (c.cells[i].road && i !== GATEWAY) assert.equal(bulldoze(c, i).ok, true);
  assert.ok(c.households.length > 0); return c;
}
function keepTreasury(c: City, amount: number) {
  const spent = c.accounts.treasury - amount; assert.ok(spent >= 0);
  c.accounts.treasury -= spent; c.accounts.construction += spent;
  if (spent) c.ledger.push({ tick: c.tick, from: 'treasury', to: 'construction', amount: spent, reason: 'Synthetic budget spent' });
}
function unique(c: City) {
  for (const h of c.households) {
    const jobs = [...c.employment, ...c.ownerLabor, ...parkEmploymentForHousehold(c, h.id)].filter(a => a.householdId === h.id);
    assert.equal(householdWorkerCount(c, h.id), jobs.reduce((n, a) => n + a.workers, 0));
    for (const skill of ['general', 'manufacturing', 'retail'] as const) assert.ok(jobs.filter(a => a.skill === skill).reduce((n, a) => n + a.workers, 0) <= h.workerSkills[skill]);
  }
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
  const balances = Object.fromEntries(Object.keys(c.accounts).map(k => [k, c.history?.accounts[k] ?? 0]));
  for (const e of c.ledger) { balances[e.from] -= e.amount; balances[e.to] += e.amount; }
  assert.deepEqual(balances, c.accounts);
}

test('real residual workers staff one-tile parks without park or home road access', () => {
  const c = isolated(), cells = structuredClone(c.cells);
  for (let i = 0; i < 3; i++) assert.equal(buildPark(c, i).ok, true);
  step(c); assert.deepEqual(c.cells, cells);
  for (const p of c.parks) { assert.equal(access(c, p.cell), false); assert.equal(parkWorkers(p), 1); assert.equal(parkStaffingStatus(c, p).staffedCapacity, 1); }
  assert.equal(c.employment.length, 0, 'business jobs retain their road prerequisite');
  unique(c); assert.deepEqual(deserialize(serialize(c)), c);
  const h = c.households.find(h => parkEmploymentForHousehold(c, h.id).length)!;
  assert.equal(householdLabor(c, h.id)?.employed, householdWorkerCount(c, h.id));
  assert.equal(householdCardData(c, h.id)?.workforce.employed, householdWorkerCount(c, h.id));
  assert.equal(summary(c).employed, 3);
});

test('existing firm/owner jobs keep priority and no skill-count worker is hired twice', () => {
  const c = createCity(61025); run(c, 120);
  for (let i = 0; i < 6; i++) assert.equal(buildPark(c, i).ok, true);
  for (let i = 0; i < 65; i++) { step(c); unique(c); assert.doesNotThrow(() => deserialize(serialize(c))); }
  assert.ok(c.ownerLabor.length + c.employment.length > 0);
});

test('no applicant and inadequate shared budget produce real vacancies and zero capacity', () => {
  const empty = createCity(61025, { starter: false }); buildPark(empty, 0); step(empty);
  assert.equal(parkStaffingStatus(empty, empty.parks[0]).status, 'no-applicants');
  assert.equal(parkStaffingStatus(empty, empty.parks[0]).staffedCapacity, 0);
  const c = isolated(); step(c); buildPark(c, 0); buildPark(c, 1);
  assert.equal(parkStaffingStatus(c, c.parks[0]).status, 'recruiting');
  keepTreasury(c, PARK_STAFF.dailyWage);
  step(c); assert.deepEqual(c.parks.map(parkWorkers), [1, 0]);
  assert.equal(treasurySpendable(c), 0);
  assert.equal(parkStaffingStatus(c, c.parks[1]).status, 'inadequate-budget');
  assert.equal(parkStaffingStatus(c, c.parks[1]).vacancies, 1);
  assert.equal(buildRoad(c, 2, 2).ok, false); assert.equal(previewPlacement(c, 'road', 2, 2)?.ok, false);
  const claims = parkPayroll(c.parks[0]); step(c);
  assert.deepEqual(c.parks.map(parkWorkers), [0, 0]); assert.equal(parkPayroll(c.parks[0]), claims);
  unique(c); assert.doesNotThrow(() => deserialize(serialize(c)));
});

test('monthly wages debit treasury once, credit real wallets, tax once, and exclude maintenance', () => {
  const c = isolated(); buildPark(c, 0); const p = c.parks[0];
  run(c, 15); const wages = c.ledger.filter(e => e.reason === `Monthly park wages #${p.id}`);
  assert.equal(wages.reduce((n, e) => n + e.amount, 0), 15 * PARK_STAFF.dailyWage);
  assert.ok(wages.every(e => e.from === 'treasury' && c.households.some(h => h.wallet === e.to)));
  const maintenance = c.ledger.filter(e => e.reason === `Monthly park upkeep #${p.id}`);
  assert.equal(maintenance.length, 1); assert.equal(maintenance[0].amount, PARK.upkeep);
  for (const wage of wages) assert.deepEqual(c.ledger[c.ledger.indexOf(wage) + 1], { tick: 60, from: wage.to, to: 'treasury', amount: wage.amount / 10, reason: 'Monthly household wage tax' });
  assert.equal(parkPayroll(p), 0); unique(c);
  const loaded = deserialize(serialize(c)); run(loaded, 30); run(c, 30); assert.deepEqual(loaded, c);
});

test('removal settles earned claims, releases workers, and stops payroll/upkeep without repeat charges', () => {
  const c = isolated(); buildPark(c, 0); run(c, 3);
  const p = c.parks[0], claims = parkPayroll(p), assigned = structuredClone(p.staffing!.allocations);
  assert.equal(bulldoze(c, 0).ok, true); assert.equal(c.parks.length, 0);
  assert.equal(c.ledger.filter(e => e.reason === `Monthly park wages #${p.id}`).reduce((n, e) => n + e.amount, 0), claims);
  for (const a of assigned) assert.equal(parkEmploymentForHousehold(c, a.householdId).length, 0);
  const after = structuredClone(c); assert.equal(bulldoze(c, 0).ok, true); assert.equal(c.ledger.length, after.ledger.length);
  run(c, 12); assert.equal(c.ledger.filter(e => e.reason === `Monthly park wages #${p.id}`).reduce((n, e) => n + e.amount, 0), claims);
  assert.equal(c.ledger.some(e => e.reason === `Monthly park upkeep #${p.id}`), false);
  unique(c); assert.doesNotThrow(() => deserialize(serialize(c)));
});

test('v14 migration changes no money/jobs/history; v15 retains earned claims and rejects double assignment or unfunded claims', () => {
  const c = isolated(); buildPark(c, 0);
  // A genuine pre-unified v15 fixture without staffing is valid as v14 too.
  // Changing a current v25 envelope's outer number would fabricate an invalid hybrid.
  const old = JSON.parse(readFileSync(new URL('./fixtures/retail-v15.json', import.meta.url), 'utf8'));
  assert.equal(old.parks.length, 0); old.version = 14; old.rulesVersion = 'chain-9';
  const migrated = deserialize(JSON.stringify(old));
  for (const key of ['accounts', 'buildings', 'households', 'firms', 'employment', 'ownerLabor', 'rng', 'tick', 'nextId']) assert.deepEqual((migrated as any)[key], old[key]);
  const through = migrated.history?.throughTick ?? -1;
  const past = old.ledger.filter((e: any) => e.tick <= through);
  assert.equal(migrated.history?.moneyCount ?? 0, past.length);
  assert.deepEqual(migrated.ledger, old.ledger.filter((e: any) => e.tick > through));
  const historic: Record<string, number> = {};
  for (const e of past) { historic[e.from] = (historic[e.from] ?? 0) - e.amount; historic[e.to] = (historic[e.to] ?? 0) + e.amount; }
  for (const key of new Set([...Object.keys(historic), ...Object.keys(migrated.history?.accounts ?? {})]))
    assert.equal(migrated.history?.accounts[key] ?? 0, historic[key] ?? 0, `historical ${key}`);
  unique(migrated);
  step(c); const raw = serialize(c); assert.deepEqual(deserialize(raw), c);
  for (const corrupt of [
    (x: any) => x.parks[0].staffing.allocations.push({ ...x.parks[0].staffing.allocations[0] }),
    (x: any) => x.parks[0].staffing.allocations[0].householdId = 9999,
    (x: any) => x.parks[0].staffing.allocations[0].workers = 2,
    (x: any) => x.parks[0].staffing.workDays['household:4'] = 9999,
    (x: any) => { const amount = PARK_STAFF.dailyWage, wallet = Object.keys(x.parks[0].staffing.workDays)[0]; x.accounts.treasury -= amount; x.accounts[wallet] += amount; x.ledger.push({ tick: x.tick, from: 'treasury', to: wallet, amount, reason: `Monthly park wages #${x.parks[0].id}` }); },
    (x: any) => { x.version = 14; x.rulesVersion = 'chain-9'; },
    (x: any) => { const spent = x.accounts.treasury; x.accounts.treasury = 0; x.accounts.construction += spent; x.ledger.push({ tick: x.tick, from: 'treasury', to: 'construction', amount: spent, reason: 'Spend reserved wages' }); },
  ]) { const bad = JSON.parse(raw); corrupt(bad); assert.throws(() => deserialize(JSON.stringify(bad))); }
});
