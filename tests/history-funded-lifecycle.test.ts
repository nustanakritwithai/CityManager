import test from 'node:test';
import assert from 'node:assert/strict';
import { auditMoney } from '../src/city-history.ts';
import { bulldoze, createCity, deserialize, serialize, step, zoneCell } from '../src/sim.ts';

const cityWithFundedFactory = () => {
  const c = createCity(61025);
  for (let day = 0; day < 400; day++) step(c);
  const funded = c.firms.find(f => f.zone === 'I' && f.fundedBy); assert.ok(funded);
  return { c, funded };
};

test('compaction keeps complete relevant funded factory evidence, and never repairs missing evidence', { timeout: 120_000 }, () => {
  const { c, funded } = cityWithFundedFactory(), id = funded.id;
  for (const f of [...c.firms]) if (f.zone === 'I' || f.zone === 'F') assert.ok(bulldoze(c, c.buildings.find(b => b.id === f.building)!.cell).ok);
  while (c.tick < 420) step(c);
  const entries = auditMoney(c), funding = entries.find(e => e.reason === `Industry expansion capital #${id}`), closure = entries.find(e => e.reason === `Funded industry demolition #${id}`), returned = entries.find(e => e.reason === `Industry expansion residual return #${id}`);
  assert.ok(funding && closure && returned); assert.ok(funding.tick <= closure.tick && closure.tick <= returned.tick);
  assert.equal(returned.from, funding.to); assert.equal(returned.to, funding.from);
  const saved = serialize(c); assert.doesNotThrow(() => deserialize(saved));
  const forged = JSON.parse(saved); forged.ledger = forged.ledger.filter((e: {reason: string}) => e.reason !== closure.reason);
  assert.throws(() => deserialize(JSON.stringify(forged)), /corrupt/i, 'missing closure evidence is rejected');
  // A pre-existing broken checkpoint cannot be safely repaired: it is also rejected.
  const damaged = structuredClone(c); damaged.ledger = damaged.ledger.filter(e => e.reason !== closure.reason);
  assert.throws(() => { while (damaged.tick < 450) step(damaged); }, /Incomplete funded industry lifecycle/);
  while (c.tick < 450) step(c);
  const after = auditMoney(c);
  assert.equal(after.filter(e => [funding.reason, closure.reason, returned.reason].includes(e.reason)).length, 0, 'irrelevant closed child is pruned as one group');
  assert.doesNotThrow(() => deserialize(serialize(c)));
});

test('many genuinely funded and demolished children compact and reload within proof bound', { timeout: 120_000 }, () => {
  const { c, funded } = cityWithFundedFactory(); let current = funded;
  const sponsor = current.fundedBy!.firmId, children = new Set<number>();
  for (let cycle = 0; cycle < 8; cycle++) {
    assert.equal(current.fundedBy?.firmId, sponsor); children.add(current.id);
    const cell = c.buildings.find(b => b.id === current.building)!.cell;
    assert.ok(bulldoze(c, cell).ok); assert.ok(zoneCell(c, cell, 'I').ok);
    let next: typeof current | undefined;
    for (let day = 0; day < 600 && !next; day++) {
      step(c);
      if (c.tick % 30 === 0) {
        assert.doesNotThrow(() => deserialize(serialize(c)), `checkpoint ${c.tick}`);
        assert.ok(c.history!.structuralProofs.length <= Object.keys(c.accounts).length * 12 + c.plants.length + c.parks.length + 10);
      }
      next = c.firms.find(f => f.fundedBy?.firmId === sponsor && !children.has(f.id));
    }
    assert.ok(next, `funded factory ${cycle + 1} opened`); current = next;
  }
  assert.equal(children.size, 8);
});

test('a funded-factory takeover keeps its refit and original funding while successor is live', { timeout: 120_000 }, () => {
  const { c, funded } = cityWithFundedFactory(), id = funded.id;
  // A balanced, explicitly recorded synthetic loss makes this funded firm eligible for
  // the real monthly dead-business takeover path; no closure record is fabricated.
  const loss = c.accounts[funded.wallet]; assert.ok(loss > 0);
  c.accounts[funded.wallet] = 0; c.accounts.outside += loss;
  c.ledger.push({ tick: c.tick, from: funded.wallet, to: 'outside', amount: loss, reason: 'Test funding exhaustion' });
  c.employment = c.employment.filter(e => e.firmId !== id); funded.workDays = {};
  while (c.tick < 480) { step(c); if (c.tick % 30 === 0) assert.doesNotThrow(() => deserialize(serialize(c))); }
  const events = auditMoney(c), funding = events.find(e => e.reason === `Industry expansion capital #${id}`);
  const closure = events.find(e => e.reason === `Funded industry takeover #${id}`);
  assert.ok(funding && closure); assert.ok(closure.tick >= funding.tick);
  assert.ok(c.firms.some(f => f.wallet === closure.from && f.takenOverAt === closure.tick), 'the takeover successor remains active');
  const saved = serialize(c), forged = JSON.parse(saved);
  forged.history.structuralProofs = forged.history.structuralProofs.filter((e: {reason: string}) => e.reason !== closure.reason);
  assert.throws(() => deserialize(JSON.stringify(forged)), /corrupt/i, 'successor refit evidence remains mandatory');
});
