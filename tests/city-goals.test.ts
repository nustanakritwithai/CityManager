import test from 'node:test';
import assert from 'node:assert/strict';
import { MONTH, createCity, deserialize, serialize, step } from '../src/sim.ts';
import { cityGoals, cityRecord, treasuryAtMonthEnds, GOAL_GROWTH_MONTHS } from '../src/city-goals.ts';

test('a fresh city starts at level 0 and the starter city climbs the stages in order', () => {
  const c = createCity(61025);
  assert.equal(cityGoals(c).level, 0); assert.equal(cityGoals(c).next?.id, 'village');
  let previous = 0;
  for (let d = 1; d <= 60; d++) { step(c); const g = cityGoals(c); assert.ok(g.level >= previous - 1); previous = g.level; }
  const g = cityGoals(c);
  assert.ok(g.level >= 3, `level ${g.level} after 60 days`);
  for (const stage of g.stages) assert.equal(stage.done, stage.level <= g.level, 'stages are cumulative');
});

test('a well-run seeded city wins within 15 months, and reading goals never changes the city', () => {
  const c = createCity(61025); let wonAt = 0;
  for (let d = 1; d <= 450 && !wonAt; d++) { step(c); const before = serialize(c); if (cityGoals(c).won) wonAt = d; assert.equal(serialize(c), before); }
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
  const c = createCity(61025);
  for (let d = 1; d <= 450 && !cityGoals(c).won; d++) step(c);
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
