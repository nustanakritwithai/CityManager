import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, deserialize, serialize, step, summary } from '../src/sim.ts';
import { cityGoals } from '../src/city-goals.ts';

test('seeded cities that win stay self-reliant for three years: farms pay their wages and no firm runs dry', { timeout: 120_000 }, () => {
  for (const seed of [61025, 2026]) {
    let c = createCity(seed), wonAt = 0;
    for (let d = 1; d <= 1080; d++) {
      step(c);
      if (!wonAt && cityGoals(c).won) wonAt = d;
      if (d % 180 === 0) c = deserialize(serialize(c));
      if (wonAt && d >= wonAt + 90 && d % 30 === 0) assert.equal(cityGoals(c).level, 5, `seed ${seed} stays at level 5 on day ${d}`);
    }
    assert.ok(wonAt > 0 && wonAt < 400, `seed ${seed} won on day ${wonAt}`);
    const s = summary(c);
    assert.equal(s.employed, s.workforce, 'everyone who can work has a job');
    assert.deepEqual(c.firms.filter(f => c.accounts[f.wallet] === 0).map(f => f.id), [], 'no business sits broke');
    const farms = c.firms.filter(f => f.zone === 'F');
    assert.ok(farms.length > 0 && farms.every(f => f.lastMonthProfit > 0), 'farms cover wages and rent');
  }
});

test('a business left with no cash and no workers is flagged, and a rebuild brings the chain back', async () => {
  const { bulldoze, zoneCell, firmWorkerCount } = await import('../src/sim.ts');
  const { buildingIssues } = await import('../src/map-overlay.ts');
  const c = createCity(61025); for (let d = 0; d < 300; d++) step(c);
  const farmCell = c.buildings.find(b => b.id === c.firms.find(f => f.zone === 'F')!.building)!.cell;
  assert.equal(bulldoze(c, farmCell).ok, true); for (let d = 0; d < 60; d++) step(c);
  assert.equal(zoneCell(c, farmCell, 'F').ok, true); for (let d = 0; d < 60; d++) step(c);
  const broke = c.firms.filter(f => c.accounts[f.wallet] === 0 && firmWorkerCount(c, f.id) === 0);
  assert.ok(broke.length > 0, 'losing the only farm leaves a factory with no cash to buy crops');
  const issues = buildingIssues(c);
  for (const f of broke) assert.equal(issues.find(i => i.cell === c.buildings.find(b => b.id === f.building)!.cell)?.kind, 'broke');
  for (const f of broke) { const b = c.buildings.find(b => b.id === f.building)!, zone = f.zone; assert.equal(bulldoze(c, b.cell).ok, true); assert.equal(zoneCell(c, b.cell, zone).ok, true); }
  for (let d = 0; d < 360; d++) step(c);
  assert.ok(cityGoals(c).level >= 4, `level ${cityGoals(c).level} a year after the rebuild`);
  assert.deepEqual(deserialize(serialize(c)), c);
});
