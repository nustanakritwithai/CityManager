import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildParallelRoad, access, GATEWAY, SIZE, type City } from '../src/sim.ts';
import { freightRoute, planCommutes, runCommutes } from '../src/commute.ts';

const grown = () => { const c = createCity(61025); for (let i = 0; i < 60; i++) step(c); return c; };
const distance = (a: number, b: number) => Math.abs(a % SIZE - b % SIZE) + Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));
/** Turn the main street into a one-way road towards the gateway: everything can drive out, nothing from outside can drive in. */
function oneWayOut(c: City) {
  const roads = c.cells.map((x, i) => (x.road ? i : -1)).filter(i => i >= 0);
  const far = roads.reduce((a, b) => (distance(b, GATEWAY) > distance(a, GATEWAY) ? b : a));
  assert.equal(buildParallelRoad(c, far, GATEWAY, true).ok, true);
  return c;
}
const cellOf = (c: City, wallet: string) => { const f = c.firms.find(x => x.wallet === wallet); return f ? c.buildings.find(b => b.id === f.building)!.cell : null; };
const reach = (c: City, from: string, to: string) => {
  const a = from === 'outside' ? GATEWAY : cellOf(c, from), b = to === 'outside' ? GATEWAY : cellOf(c, to);
  return a === null || b === null ? true : freightRoute(c, [a], [b]) !== null;
};

test('a delivery route follows the roads as they can legally be driven, in each direction', () => {
  const c = grown(), firm = c.firms.map(f => c.buildings.find(b => b.id === f.building)!.cell).find(cell => access(c, cell))!;
  assert.ok(freightRoute(c, [GATEWAY], [firm]) && freightRoute(c, [firm], [GATEWAY]), 'two-way streets reach both ways');
  oneWayOut(c);
  assert.equal(access(c, firm), true, 'still on the city’s road network');
  assert.equal(freightRoute(c, [GATEWAY], [firm]), null, 'nothing from outside can drive in against the one-way');
  assert.ok(freightRoute(c, [firm], [GATEWAY]), 'but it can drive out');
});

test('a one-way street binds drivers, but people still walk to work against it and no work day is lost', () => {
  const base = grown(), blocked = oneWayOut(deserialize(serialize(base))), twin = deserialize(serialize(base));
  assert.equal(planCommutes(blocked).filter(t => t.mode === 'unreachable').length, 0, 'on foot every linked street can be walked either way');
  step(blocked); step(twin);
  const credited = (c: City) => c.firms.reduce((n, f) => n + Object.values(f.workDays).reduce((m, d) => m + d, 0), 0);
  assert.equal(credited(blocked), credited(twin), 'the same work days are earned');
  for (const t of planCommutes(blocked).filter(t => t.mode === 'drive')) {
    assert.ok(freightRoute(blocked, [t.from!], [t.to!]) && freightRoute(blocked, [t.to!], [t.from!]), 'a driver needs a legal route there and back');
  }
});

test('a worker with no linked street to work that day loses exactly that day’s work credit', () => {
  // Five days into a month, so the day's credit sits on top of earlier unpaid days.
  const c = grown(); for (let i = 0; i < 5; i++) step(c);
  const pay = (from: string, to: string, amount: number, reason: string) => {
    const paid = Math.min(amount, from === 'outside' ? amount : c.accounts[from] ?? 0);
    c.accounts[from] = (c.accounts[from] ?? 0) - paid; c.accounts[to] = (c.accounts[to] ?? 0) + paid; c.ledger.push({ tick: c.tick, from, to, amount: paid, reason }); return paid;
  };
  // Today's jobs are already held and credited; then the street between home and work is dug up.
  const trip = planCommutes(c).find(t => t.wage && t.workplace.kind === 'firm' && t.route && t.route.length >= 3)!;
  assert.ok(trip, 'someone walks along the street to work');
  const cut = trip.route![1];
  c.cells[cut].road = false;
  const wallet = c.households.find(h => h.id === trip.householdId)!.wallet, firm = c.firms.find(f => f.id === trip.workplace.id)!;
  const lost = planCommutes(c).filter(t => t.mode === 'unreachable' && t.wage && t.workplace.kind === 'firm');
  assert.ok(lost.length > 0, 'cutting the street leaves no way there');
  const before = firm.workDays[wallet] ?? 0, mine = lost.filter(t => t.householdId === trip.householdId && t.workplace.id === firm.id).length;
  const day = runCommutes(c, pay);
  assert.equal(day.missed, lost.length, 'one lost day per person who could not get there');
  assert.equal(firm.workDays[wallet] ?? 0, Math.max(0, before - mine));
});

test('goods and crops only travel where a truck can drive', () => {
  const base = grown(), c = oneWayOut(deserialize(serialize(base))), twin = deserialize(serialize(base));
  // Crops that went farm → factory on two-way streets but would have to drive against the one-way now.
  const cutOff = (x: City) => x.cropLedger.filter(e => e.kind === 'trade' && e.tick > base.tick && !reach(c, e.from, e.to));
  let checked = 0;
  for (let day = 0; day < 20; day++) {
    step(c); step(twin);
    for (const e of c.goodsLedger.filter(e => e.tick === c.tick && (e.reason === 'Wholesale stock delivery' || e.reason === 'Imported shop stock' || e.reason === 'Exported goods'))) { assert.ok(reach(c, e.from, e.to), `${e.reason} ${e.from} → ${e.to} has a road route`); checked++; }
    for (const e of c.cropLedger.filter(e => e.tick === c.tick && e.kind === 'trade')) { assert.ok(reach(c, e.from, e.to), `crops ${e.from} → ${e.to} have a road route`); checked++; }
  }
  assert.ok(checked > 0, 'deliveries still happen where routes exist');
  assert.ok(cutOff(twin).length > 0, 'on two-way streets crops did go along the route the one-way now blocks');
  assert.equal(cutOff(c).length, 0, 'and with the one-way they never do');
  const saved = serialize(c); assert.equal(serialize(deserialize(saved)), saved);
});
