import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runOwnerDecisionBenchmark, OWNER_BENCHMARK_SEEDS } from '../scripts/owner-decision-benchmark.mjs';
import { createCity, deserialize, serialize } from '../src/sim.ts';
import { createCity as oldCity, step as oldStep, serialize as oldSerialize } from '../src/legacy-v5.ts';
import { createOwnerDecisionSession, replayOwnerJournal } from '../src/owner-decision-session.ts';

test('legacy v1-v5 migration opens a proposal-only owner session without rewriting canonical state or enabling auto', () => {
  const old = oldCity(61025); for (let n = 0; n < 180; n++) oldStep(old);
  const raws = ['legacy-v1-day65.json', 'legacy-v2-day65.json', 'legacy-v3-day96.json', 'entity-card-v4.json']
    .map(name => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
  raws.push(oldSerialize(old));
  for (let index = 0; index < raws.length; index++) {
    assert.equal(JSON.parse(raws[index]).version, index + 1);
    const city = deserialize(raws[index]), before = serialize(city), session = createOwnerDecisionSession(city);
    assert.equal(city.version, 7); assert.equal(session.mode, 'proposal');
    session.evaluate(city); assert.equal(serialize(city), before, 'Evaluating imported household/owner state is read-only');
    session.setMode('auto'); session.reset(city);
    assert.equal(session.mode, 'proposal', 'Reset/load never silently restores autonomous execution');
    assert.equal(serialize(city), before);
    const replay = replayOwnerJournal(JSON.parse(JSON.stringify(session.exportJournal())));
    assert.equal(replay.ok, true); assert(replay.city); assert.equal(serialize(replay.city), before);
  }
});

test('checkpoint retention changes audit coverage without changing deterministic owner execution', () => {
  const compact = createCity(61025), normal = createCity(61025);
  const compactSession = createOwnerDecisionSession(compact, { maxEvents: 8 }), normalSession = createOwnerDecisionSession(normal);
  compactSession.setMode('auto'); normalSession.setMode('auto');
  for (let day = 0; day < 90; day++) { compactSession.advance(compact); normalSession.advance(normal); }
  assert.equal(serialize(compact), serialize(normal));
  assert(compactSession.getStats().checkpointRotations > 0);
  for (const [city, session] of [[compact, compactSession], [normal, normalSession]] as const) {
    const replay = replayOwnerJournal(JSON.parse(JSON.stringify(session.exportJournal())));
    assert.equal(replay.ok, true); assert(replay.city); assert.equal(serialize(replay.city), serialize(city));
  }
});

test('720-day four-seed fixed-growth benchmark keeps proposals inert and replays bounded owner rule execution', { timeout: 240_000 }, () => {
  const report = runOwnerDecisionBenchmark();
  assert.equal(report.horizonDays, 720); assert.deepEqual(report.seeds, [61025, 20261023, 1, 42]);
  assert.deepEqual(report.seeds, OWNER_BENCHMARK_SEEDS); assert.equal(report.baseline, 'chain-2');
  assert.equal(report.providerRequests, 0); assert.equal(report.rows.length, 4);
  assert.equal(report.retentionMode, 'production-default'); assert.equal(report.retentionMaxEvents, 256);
  for (const row of report.rows) {
    assert.equal(row.proposalOnly.stateHash, row.baseline.stateHash);
    assert.equal(row.proposalOnly.final.tick, 720); assert.equal(row.ruleExecution.final.tick, 720);
    assert.equal(row.proposalOnly.decisions.applied, 0);
    assert.equal(row.proposalOnly.replay.ok, true); assert.equal(row.ruleExecution.replay.ok, true);
    assert.equal(row.monthly.baseline.length, 24);
    assert(row.ruleExecution.decisions.monthlyEvaluations > 0);
    for (const treatment of [row.proposalOnly, row.ruleExecution]) {
      assert.equal(treatment.replay.coverageStartTick, 0, 'Production retention keeps the complete fresh-city experiment');
      assert.equal(treatment.replay.coverageEndTick, 720);
      assert.equal(treatment.replay.retiredEvents, 0, 'No retired history is mislabeled full-run replay');
    }
    assert(row.ruleExecution.final.households > 0 && row.ruleExecution.final.population >= row.ruleExecution.final.households);
  }
  assert(report.rows.some(row => row.ruleExecution.decisions.applied > 0), 'At least one actual owner transfer exercises execution, not only holds');
  // The repaired growth rule, rather than the old 10/8 plateau, is the comparator.
  for (const row of report.rows.filter(row => row.seed === 61025 || row.seed === 20261023)) {
    assert(row.baseline.final.population > 10); assert(row.baseline.final.jobs > 8);
  }
  if (process.env.CITYMANAGER_OWNER_BENCHMARK_REPORT) {
    const output = resolve(process.env.CITYMANAGER_OWNER_BENCHMARK_REPORT);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
});
