import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCity, step, serialize, deserialize, buildParallelRoad, access, GATEWAY, SIZE, type City } from '../src/sim.ts';
import { freightRoute, planCommutes } from '../src/commute.ts';

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

test('a worker with no route to work loses exactly that day’s work credit', () => {
  const base = grown(), blocked = oneWayOut(deserialize(serialize(base))), twin = deserialize(serialize(base));
  const lost = planCommutes(blocked).filter(t => t.mode === 'unreachable' && t.wage && t.workplace.kind === 'firm');
  assert.ok(lost.length > 0, 'the one-way street cuts some people off from work');
  step(blocked); step(twin);
  const credited = (c: City) => c.firms.reduce((n, f) => n + Object.values(f.workDays).reduce((m, d) => m + d, 0), 0);
  const unreachable = planCommutes(blocked).filter(t => t.mode === 'unreachable' && t.wage && t.workplace.kind === 'firm').length;
  assert.equal(blocked.employment.reduce((n, a) => n + a.workers, 0), twin.employment.reduce((n, a) => n + a.workers, 0), 'the same jobs are held');
  assert.equal(credited(twin) - credited(blocked), unreachable, 'one day less for each person who could not get there');
  assert.equal(Object.values(blocked.accounts).reduce((n, v) => n + v, 0), 0);
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
