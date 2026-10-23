import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZE, GATEWAY, WAGES, MONTH, createCity, step, summary, connectedRoads, access, roadPath, buildRoad, zoneCell, bulldoze, explainCell, serialize, deserialize } from '../src/sim.ts';

const advance = (c: ReturnType<typeof createCity>, n: number) => { for (let i = 0; i < n; i++) step(c); return c; };
test('seeded daily ticks and save continuation are deterministic', () => {
  const a = advance(createCity(42), 90), b = advance(createCity(42), 90);
  assert.equal(serialize(a), serialize(b));
  const restored = deserialize(serialize(a)); advance(a, 30); advance(restored, 30);
  assert.equal(serialize(a), serialize(restored));
  assert.notEqual(serialize(advance(createCity(43), 90)), serialize(b));
});
test('roads have separate connectivity, Manhattan paths and atomic/repeat-safe costs', () => {
  const c = createCity(), before = c.accounts.treasury;
  assert.deepEqual(roadPath(0, SIZE + 2), [0, 1, 2, SIZE + 2]);
  assert.equal(buildRoad(c, GATEWAY, GATEWAY + 10).ok, true); assert.equal(c.accounts.treasury, before);
  assert.equal(buildRoad(c, 0, 2).ok, true); assert.equal(access(c, SIZE + 1), false);
  assert.equal(connectedRoads(c).has(0), false);
  assert.match(explainCell(c, 1).join(' '), /Disconnected/);
  assert.equal(buildRoad(c, -1, 1).ok, false); assert.equal(bulldoze(c, GATEWAY).ok, false);
  assert.equal(zoneCell(c, GATEWAY, 'R').ok, false);
});
test('disconnected zoned parcels do not grow; utilities give numerical/explicit reasons', () => {
  const c = createCity(); for (const cell of c.cells) cell.zone = null;
  zoneCell(c, 1, 'R'); advance(c, 90);
  assert.equal(c.buildings.length, 0); assert.match(explainCell(c, 1).join(' '), /No connected road frontage/);
  buildRoad(c, GATEWAY, 0); advance(c, 3); assert.equal(c.buildings.length, 1);
  const d = createCity(); d.utilities.power = false; advance(d, 30);
  assert.equal(d.buildings.length, 0); assert.match(explainCell(d, 11 * SIZE + 2).join(' '), /No power/);
});
test('individual employment, stock, purchases and monthly settlements reconcile', () => {
  const c = advance(createCity(42), 180), s = summary(c);
  assert.ok(s.population >= 2); assert.ok(s.employed > 0);
  assert.ok(c.ledger.some(e => e.reason === 'Monthly wages'));
  assert.ok(c.ledger.some(e => e.reason.includes('purchase') && e.from.startsWith('household:') && e.to.startsWith('firm:')));
  assert.ok(c.ledger.some(e => e.reason === 'Monthly household rent'));
  assert.ok(c.ledger.some(e => e.reason === 'Monthly household wage tax'));
  assert.ok(c.goodsLedger.some(e => e.reason === 'Household final consumption'));
  assert.equal(Object.values(c.accounts).reduce((a, b) => a + b, 0), 0);
  assert.ok(Object.entries(c.accounts).every(([k, v]) => Number.isSafeInteger(v) && (k === 'outside' || v >= 0)));
  assert.equal(c.goods.produced + c.goods.imported - c.goods.consumed - c.goods.exported, c.firms.reduce((a, f) => a + f.inventory, 0));
  assert.doesNotThrow(() => deserialize(serialize(c)));
  for (const h of c.households) if (h.employer !== null) assert.ok(c.firms.find(f => f.id === h.employer)?.employees.includes(h.id));
});
test('demolition removes agents and wallets honestly; repeated tools cannot duplicate charges', () => {
  const c = advance(createCity(8), 90), target = c.buildings[0];
  const before = c.accounts.treasury;
  assert.equal(buildRoad(c, target.cell, target.cell).ok, false); assert.equal(c.accounts.treasury, before);
  assert.equal(bulldoze(c, target.cell).ok, true); const after = c.accounts.treasury;
  assert.equal(bulldoze(c, target.cell).ok, true); assert.equal(c.accounts.treasury, after);
  assert.equal(c.buildings.some(b => b.id === target.id), false); assert.doesNotThrow(() => deserialize(serialize(c)));
});
test('a cut road suspends disconnected activity and explains the failure', () => {
  const c = advance(createCity(42), 45); bulldoze(c, GATEWAY + 1); step(c);
  assert.ok(c.households.every(h => h.employer === null));
  const lastTickPurchases = c.ledger.filter(e => e.tick === c.tick && e.reason.includes('purchase'));
  assert.equal(lastTickPurchases.length, 0);
  assert.match(explainCell(c, c.buildings[0].cell).join(' '), /Disconnected/);
});
test('corrupt/incompatible saves reject without mutating the current city', () => {
  const c = advance(createCity(), 30), original = serialize(c);
  for (const mutate of [
    (x: any) => x.version = 99, (x: any) => x.accounts.treasury++,
    (x: any) => x.cells.pop(), (x: any) => x.cells[GATEWAY].road = false,
    (x: any) => x.households[0].employer = 99999, (x: any) => x.firms[0].inventory++,
    (x: any) => x.utilities.water = 'yes', (x: any) => x.ledger[0].amount++,
    (x: any) => x.households[0].wallet = 'treasury',
  ]) { const bad = JSON.parse(original); mutate(bad); assert.throws(() => deserialize(JSON.stringify(bad))); }
  assert.throws(() => deserialize('{oops')); assert.equal(serialize(c), original);
});
test('monthly wages pay actual days worked and a cash-starved shop protects earned payroll', () => {
  const c = advance(createCity(42), 29);
  assert.equal(c.ledger.filter(e => e.reason === 'Monthly wages').length, 0);
  const expected = new Map<string, number>();
  for (const f of c.firms) {
    const days = { ...f.workDays };
    for (const id of f.employees) { const h = c.households.find(h => h.id === id)!; days[h.wallet] = (days[h.wallet] ?? 0) + 1; }
    for (const [wallet, n] of Object.entries(days)) expected.set(`${f.wallet}->${wallet}`, n * WAGES[f.zone] / MONTH);
  }
  assert.doesNotThrow(() => deserialize(serialize(c)));
  step(c);
  const payments = c.ledger.filter(e => e.tick === 30 && e.reason === 'Monthly wages');
  assert.equal(payments.length, expected.size);
  for (const e of payments) assert.equal(e.amount, expected.get(`${e.from}->${e.to}`));
  assert.ok(payments.some(e => e.amount < WAGES.I));
  assert.ok(c.firms.every(f => Object.keys(f.workDays).length === 0));

  const stressed = advance(createCity(42), 80), shop = stressed.firms.find(f => f.zone === 'C')!;
  const owed = () => Object.values(shop.workDays).reduce((n, days) => n + days * WAGES.C / MONTH, 0);
  assert.ok(shop.employees.length > 0);
  // A controlled liquidity shock: no purchasing household can replenish the shop's cash.
  for (const h of stressed.households) stressed.accounts[h.wallet] = 0;
  stressed.accounts[shop.wallet] = owed() + WAGES.C / MONTH;
  step(stressed); assert.equal(stressed.accounts[shop.wallet], owed());
  step(stressed); assert.equal(shop.employees.length, 0); assert.equal(stressed.accounts[shop.wallet], owed());
});
test('forged work-day claims reject invalid shapes, creditors, days and unfunded reserves', () => {
  const c = advance(createCity(42), 29), original = serialize(c);
  for (const mutate of [
    (x: any) => x.firms[0].workDays = [],
    (x: any) => x.firms[0].workDays = null,
    (x: any) => x.firms[0].workDays = { 'household:999999': 1 },
    (x: any) => x.firms[0].workDays = { [x.households[0].wallet]: 30 },
    (x: any) => x.firms[0].workDays = { [x.households[0].wallet]: -1 },
    (x: any) => { const f = x.firms[0]; f.workDays = { [x.households[0].wallet]: 29 }; x.accounts.outside += x.accounts[f.wallet]; x.accounts[f.wallet] = 0; },
  ]) { const bad = JSON.parse(original); mutate(bad); assert.throws(() => deserialize(JSON.stringify(bad))); }
  assert.equal(serialize(c), original);
});
test('goods journals must reconcile every counter and each surviving or departed firm stock', () => {
  const c = advance(createCity(42), 90), original = serialize(c);
  assert.ok(c.goodsLedger.length > 0);
  for (const mutate of [
    (x: any) => x.goodsLedger[0].quantity++,
    (x: any) => x.goodsLedger[0].to = 'firm:999999',
    (x: any) => x.goods.produced++,
    (x: any) => { const e = x.goodsLedger.find((e: any) => e.to.startsWith('firm:')); e.to = x.households[0].wallet; },
  ]) { const bad = JSON.parse(original); mutate(bad); assert.throws(() => deserialize(JSON.stringify(bad))); }
  const factory = c.firms.find(f => f.zone === 'I')!, cell = c.buildings.find(b => b.id === factory.building)!.cell;
  assert.equal(bulldoze(c, cell).ok, true);
  assert.doesNotThrow(() => deserialize(serialize(c)));
  assert.equal(c.accounts[factory.wallet], 0);
});
