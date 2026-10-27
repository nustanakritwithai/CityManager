import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, serialize, step, summary } from '../src/sim.ts';
import { cityGoals } from '../src/city-goals.ts';
import { keepSupplied } from './plants.ts';

test('seeded cities that win stay self-reliant for three years: farms pay their wages and no firm runs dry', { timeout: 120_000 }, () => {
  for (const seed of [61025, 2026]) {
    let c = createCity(seed), wonAt = 0;
    for (let d = 1; d <= 1080; d++) {
      step(c); keepSupplied(c);
      if (!wonAt && cityGoals(c).won) wonAt = d;
      if (d % 180 === 0) c = deserialize(serialize(c));
      if (wonAt && d >= wonAt + 90 && d % 30 === 0) assert.equal(cityGoals(c).level, 5, `seed ${seed} stays at level 5 on day ${d}`);
    }
    // Plants cost the treasury one month's growth, so the three-month treasury goal restarts once (chain-4).
    assert.ok(wonAt > 0 && wonAt < 420, `seed ${seed} won on day ${wonAt}`);
    const s = summary(c);
    assert.equal(s.employed, s.workforce, 'everyone who can work has a job');
    assert.deepEqual(c.firms.filter(f => c.accounts[f.wallet] === 0).map(f => f.id), [], 'no business sits broke');
    const farms = c.firms.filter(f => f.zone === 'F');
    assert.ok(farms.length > 0 && farms.every(f => f.lastMonthProfit > 0), 'farms cover wages and rent');
  }
});

test('a business left with no cash and no workers is taken over at month end: new owner, same premises, chain back', { timeout: 120_000 }, async () => {
  const { bulldoze, zoneCell, deadFirm, utilities, access } = await import('../src/sim.ts');
  const c = createCity(61025); for (let d = 0; d < 300; d++) { step(c); keepSupplied(c); }
  const farmCell = c.buildings.find(b => b.id === c.firms.find(f => f.zone === 'F')!.building)!.cell, premises = new Map(c.firms.map(f => [f.building, f.id]));
  assert.equal(bulldoze(c, farmCell).ok, true);
  const takeovers: string[] = [];
  for (let d = 0; d < 120; d++) {
    step(c); keepSupplied(c);
    if (d === 59) assert.equal(zoneCell(c, farmCell, 'F').ok, true);
    if (c.tick % 30 === 0) {
      const svc = utilities(c);
      // After the month-end review no dead business is left on premises a new owner could run.
      assert.deepEqual(c.firms.filter(f => deadFirm(c, f) && access(c, c.buildings.find(b => b.id === f.building)!.cell) && svc.ok(f.building) && f.commercialKind !== 'market').map(f => f.id), [], `day ${c.tick}`);
      for (const f of c.firms.filter(f => f.takenOverAt === c.tick)) takeovers.push(`${premises.get(f.building)}→${f.id}`);
    }
  }
  assert.ok(takeovers.length > 0, 'losing the only farm broke a business, and a new owner took it over');
  for (const f of c.firms.filter(f => f.takenOverAt !== undefined)) {
    assert.ok(c.buildings.some(b => b.id === f.building), 'the same building is reused');
    assert.ok(c.ledger.some(e => e.from === f.wallet && e.to === 'construction' && e.tick === f.takenOverAt), 'the new owner paid the refit');
  }
  for (let d = 0; d < 300; d++) { step(c); keepSupplied(c); }
  assert.ok(cityGoals(c).level >= 4, `level ${cityGoals(c).level} without any rebuild`);
  assert.deepEqual(deserialize(serialize(c)), c);
  const raw = JSON.parse(serialize(c)), taken = raw.firms.findIndex((f: any) => f.takenOverAt !== undefined);
  for (const mutate of [(x: any) => { x.firms[taken].takenOverAt -= 1; }, (x: any) => { x.firms[taken].takenOverAt = x.tick + 1; }]) {
    const bad = structuredClone(raw); mutate(bad); assert.throws(() => deserialize(JSON.stringify(bad)), /corrupt/);
  }
});
