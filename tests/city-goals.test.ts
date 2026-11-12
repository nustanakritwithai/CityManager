import test from 'node:test';
import assert from 'node:assert/strict';
import { MONTH, bulldoze, createCity, deserialize, serialize, step, summary } from '../src/sim.ts';
import { cityGoals, cityRecord, treasuryAtMonthEnds, GOAL_GROWTH_MONTHS } from '../src/city-goals.ts';
import { keepSupplied } from './plants.ts';

test('a fresh city starts at level 0 and the starter city climbs the stages in order', () => {
  const c = createCity(61025);
  assert.equal(cityGoals(c).level, 0); assert.equal(cityGoals(c).next?.id, 'village');
  let previous = 0;
  for (let d = 1; d <= 60; d++) { step(c); const g = cityGoals(c); assert.ok(g.level >= previous - 1); previous = g.level; }
  const g = cityGoals(c);
  assert.ok(g.level >= 3, `level ${g.level} after 60 days`);
  for (const stage of g.stages) assert.equal(stage.done, stage.level <= g.level, 'stages are cumulative');
});

test('a legacy seeded city wins within 15 months, and reading goals never changes the city', () => {
  const c = createCity(61025); delete c.goalRulesVersion; let wonAt = 0;
  for (let d = 1; d <= 450 && !wonAt; d++) { step(c); keepSupplied(c); const before = serialize(c); if (cityGoals(c).won) wonAt = d; assert.equal(serialize(c), before); }
  assert.ok(wonAt > 120 && wonAt <= 450, `won on day ${wonAt}`);
  const g = cityGoals(c); assert.equal(g.level, 5); assert.equal(g.next, null);
  const r = cityRecord(c); assert.equal(r.day, wonAt); assert.ok(r.population >= 20 && r.taxes > 0 && r.soldLocally > 0);
  assert.deepEqual(cityGoals(deserialize(serialize(c))), g, 'a loaded city shows the same stage');
});

test('treasury month-end balances match the balance recorded while the city ran', () => {
  const c = createCity(61025), recorded: number[] = [];
  for (let d = 1; d <= 150; d++) { step(c); if (d % MONTH === 0) recorded.push(c.accounts.treasury); }
  assert.deepEqual(treasuryAtMonthEnds(c, GOAL_GROWTH_MONTHS), recorded.slice(-GOAL_GROWTH_MONTHS - 1));
  assert.equal(treasuryAtMonthEnds(createCity(1), GOAL_GROWTH_MONTHS), null);
});

test('one import in the last 30 days or a shrinking treasury withholds the win', () => {
  const c = createCity(61025); delete c.goalRulesVersion;
  for (let d = 1; d <= 450 && !cityGoals(c).won; d++) { step(c); keepSupplied(c); }
  assert.ok(cityGoals(c).won);
  const imported = deserialize(serialize(c)), shop = imported.goodsLedger.find(e => e.reason === 'Wholesale stock delivery')!.to;
  imported.goodsLedger.push({ tick: imported.tick, from: 'outside', to: shop, quantity: 1, reason: 'Imported shop stock' });
  assert.equal(cityGoals(imported).won, false); assert.equal(cityGoals(imported).next?.id, 'self-reliant');
  const spent = deserialize(serialize(c)), end = spent.tick - spent.tick % MONTH;
  spent.ledger.push({ tick: end, from: 'treasury', to: 'roadworks', amount: spent.accounts.treasury, reason: 'Build 1 road cells' });
  assert.equal(cityGoals(spent).won, false);
});

test('the in-game version matches package.json', async () => {
  const { GAME_VERSION } = await import('../src/version.ts');
  const { readFileSync } = await import('node:fs');
  assert.equal(GAME_VERSION, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
});

test('demolition preserves completed shop sales in both 30-day goal checks', () => {
  const city = createCity(61025);
  for (let day = 0; day < 180; day++) { step(city); keepSupplied(city); }
  const recent = city.goodsLedger.filter(entry => entry.reason === 'Household final consumption' && entry.tick > city.tick - MONTH);
  const store = city.firms.find(firm => firm.zone === 'C' && recent.some(entry => entry.from === firm.wallet));
  assert.ok(store);
  const site = city.buildings.find(building => building.id === store.building);
  assert.ok(site);
  const goalChecks = (value: typeof city) => {
    const { stages } = cityGoals(value);
    return [stages[2].checks[1], stages[4].checks.at(-2)];
  };
  const before = goalChecks(city);
  assert.ok(before[0]?.done);
  assert.equal(bulldoze(city, site.cell).ok, true);
  assert.equal(city.tick, 180);
  assert.deepEqual(goalChecks(city), before);
  assert.deepEqual(goalChecks(deserialize(serialize(city))), before);
});

test('the employment display does not reach 80% before the exact eligibility threshold', () => {
  const city = createCity(61025), totals = summary(city);
  const check = (employed: number, workforce: number) => cityGoals(city, { ...totals, employed, workforce }).stages[3].checks[1];
  assert.deepEqual({ value: check(39, 49).value, done: check(39, 49).done }, { value: '79.59%', done: false });
  assert.equal(check(4803, 6004).value, '79.99%');
  assert.equal(check(4803, 6004).done, false);
  assert.equal(check(40, 50).value, '80%');
  assert.equal(check(40, 50).done, true);
  assert.equal(check(0, 0).value, '0%');
  assert.equal(check(0, 0).done, false);
});
