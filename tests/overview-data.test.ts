import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, buildRoad, zoneCell, step, serialize, GATEWAY, SIZE, type City } from '../src/sim.ts';
import { cityOverview } from '../src/context-data.ts';
import { treasuryHistory, treasuryBudget, supplyChain, growthChecklist, GROWTH_STEPS, CHAIN_ROUTES } from '../src/overview-data.ts';

function city(days: number, record?: (c: City) => void): City {
  const c = createCity(61025), S = SIZE;
  buildRoad(c, GATEWAY, 12 * S + 20);
  for (const col of [5, 10, 15]) buildRoad(c, 6 * S + col, 18 * S + col);
  for (let r = 7; r <= 17; r++) for (const col of [4, 6, 9, 11, 14, 16]) if (r !== 12) zoneCell(c, r * S + col, r < 12 ? 'R' : col > 12 ? 'I' : 'R');
  for (const col of [6, 7, 8, 9, 11, 12, 13]) { zoneCell(c, 11 * S + col, 'C'); zoneCell(c, 13 * S + col, col % 2 ? 'C' : 'F'); }
  for (let col = 16; col <= 20; col++) { zoneCell(c, 11 * S + col, 'F'); zoneCell(c, 13 * S + col, 'F'); }
  for (let t = 0; t < days; t++) { step(c); record?.(c); }
  return c;
}

test('treasury history matches the balance actually recorded at the end of each day', () => {
  const seen = new Map<number, number>(), c = city(260, c => seen.set(c.tick, c.accounts.treasury));
  const history = treasuryHistory(c);
  assert.equal(history.length, 30); assert.equal(history.at(-1)!.tick, c.tick);
  for (const point of history) assert.equal(point.balance, seen.get(point.tick), `day ${point.tick}`);
  assert.equal(treasuryHistory(createCity(61025)).length, 1, 'a new city has only today');
});

test('budget lines add up to the treasury flows of the overview window', () => {
  const c = city(260), budget = treasuryBudget(c), overview = cityOverview(c);
  assert.equal(budget.income.reduce((n, l) => n + l.amount, 0), overview.income);
  assert.equal(budget.expense.reduce((n, l) => n + l.amount, 0), overview.expense);
  assert.equal(budget.net, overview.net);
  assert.ok(budget.expense.some(l => l.key === 'upkeep'), 'road upkeep is a named line');
  assert.ok(budget.income.every(l => l.amount > 0) && budget.expense.every(l => l.amount > 0));
});

test('supply chain flows reconcile with the journals and the overview', () => {
  const c = city(420), chain = supplyChain(c), overview = cityOverview(c);
  assert.deepEqual(chain.flows.map(f => `${f.from}>${f.to}`), CHAIN_ROUTES.map(f => `${f.from}>${f.to}`));
  const flow = (from: string, to: string) => chain.flows.find(f => f.from === from && f.to === to)!.quantity;
  assert.equal(flow('shop', 'household'), overview.consumed, 'goods baskets');
  assert.equal(flow('factory', 'outside'), overview.exported);
  assert.equal(flow('outside', 'shop'), overview.imported);
  assert.equal(chain.harvested, overview.cropHarvested); assert.equal(chain.processed, overview.cropProcessed);
  assert.equal(flow('market', 'household'), overview.cropConsumed, 'crop baskets');
  assert.ok(chain.harvested > 0 && flow('farm', 'market') + flow('farm', 'factory') > 0, 'the grown city moves crops');
  const before = serialize(c); treasuryHistory(c); treasuryBudget(c); supplyChain(c); assert.equal(serialize(c), before);
});

test('growth checklist follows the simulator check order', () => {
  assert.ok(growthChecklist('growth.ready').every(i => i.state === 'pass'));
  assert.deepEqual(growthChecklist('growth.bootstrap').map(i => i.state), ['pass', 'pass', 'skip', 'skip', 'skip', 'skip', 'skip']);
  const blocked = growthChecklist('growth.no-crop-buffer').map(i => i.state);
  assert.deepEqual(blocked, ['pass', 'pass', 'pass', 'pass', 'fail', 'pending', 'pending']);
  assert.equal(growthChecklist('growth.unknown').every(i => i.state === 'pending'), true);
  assert.equal(GROWTH_STEPS.length, 7);
});
