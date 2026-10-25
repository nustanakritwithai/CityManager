// Deterministic local experiment only. No browser, API, key or model calls.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createCity, step, summary, serialize, deserialize, isMarket, isRetail, firmWage, MONTH } from '../src/sim.ts';
import { ownerStateHash } from '../src/owner-decision.ts';
import { createOwnerDecisionSession, replayOwnerJournal } from '../src/owner-decision-session.ts';

export const OWNER_BENCHMARK_SEEDS = Object.freeze([61025, 20261023, 1, 42]);
export const OWNER_BENCHMARK_DAYS = 720;

function reconcile(city) {
  let money = 0;
  for (const [account, cash] of Object.entries(city.accounts)) {
    assert(Number.isSafeInteger(cash), 'Money stays integer satang');
    assert(account === 'outside' || cash >= 0, 'No internal account goes negative');
    money += cash;
  }
  assert.equal(money, 0, 'All cash debits and credits reconcile, including named outside flows');
  assert.equal(city.goods.produced + city.goods.imported - city.goods.consumed - city.goods.exported,
    city.firms.reduce((total, firm) => total + firm.inventory, 0), 'Finished goods reconcile with actual inventories');
  assert.equal(city.crops.harvested - city.crops.processed - city.crops.consumed - city.crops.writtenOff,
    city.firms.reduce((total, firm) => total + firm.cropInventory, 0), 'Crops reconcile with actual inventories');
  for (const firm of city.firms) {
    assert(Number.isSafeInteger(firm.inventory) && firm.inventory >= 0);
    assert(Number.isSafeInteger(firm.cropInventory) && firm.cropInventory >= 0);
    assert(Number.isSafeInteger(firm.cropCost) && firm.cropCost >= 0);
    const earned = Object.values(firm.workDays).reduce((n, days) => n + days * firmWage(firm) / MONTH, 0);
    assert(Number.isSafeInteger(earned) && earned >= 0 && city.accounts[firm.wallet] >= earned, 'Earned wage claims remain fully reserved');
    assert(isMarket(firm) || isRetail(firm) || firm.owner === null, 'Only markets and shops are household-owned');
  }
  assert.equal(city.households.reduce((n, h) => n + h.workforce + h.dependents, 0),
    city.households.reduce((n, h) => n + h.members, 0), 'Canonical individual households retain actual member counts');
}

const cashRange = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { total: sorted.reduce((n, value) => n + value, 0), min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null, median: sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null };
};
function metrics(city) {
  const s = summary(city);
  return {
    tick: city.tick, population: s.population, households: s.households, workforce: s.workforce,
    jobs: s.jobs, employed: s.employed, unemployed: s.unemployed, treasurySatang: s.treasury,
    householdCashSatang: cashRange(city.households.map(h => city.accounts[h.wallet])),
    firmCashSatang: cashRange(city.firms.map(f => city.accounts[f.wallet])),
    cumulativeOperatingProfitSatang: city.firms.reduce((n, f) => n + f.profit + f.monthlyRevenue - f.monthlyExpense, 0),
    markets: city.firms.filter(isMarket).length, fundedFactories: city.firms.filter(f => f.fundedBy).length,
    earnedWageWorkerDays: city.firms.reduce((n, f) => n + Object.values(f.workDays).reduce((v, days) => v + days, 0), 0),
    earnedWagesReservedSatang: city.firms.reduce((n, f) => n + Object.values(f.workDays).reduce((v, days) => v + days * firmWage(f) / MONTH, 0), 0),
    finishedGoods: city.firms.reduce((n, f) => n + f.inventory, 0),
    cropLots: city.firms.reduce((n, f) => n + f.cropInventory, 0),
  };
}
function verifyRetainedReplay(city, session) {
  const journal = JSON.parse(JSON.stringify(session.exportJournal()));
  const replay = replayOwnerJournal(journal);
  assert.equal(replay.ok, true, 'Retained journal/checkpoint must replay successfully: ' + replay.code);
  assert(replay.city, 'Replay returns reconstructed canonical city');
  assert.equal(serialize(replay.city), serialize(city), 'Replay reproduces complete canonical state, not only totals');
  const stats = session.getStats();
  assert(stats.retiredEvents >= 0 && stats.checkpointRotations >= 0);
  if (stats.retiredEvents > 0) assert(replay.coverageStartTick > 0, 'Retired events disclose a later retained checkpoint');
  return { ok: true, coverageStartTick: replay.coverageStartTick, coverageEndTick: city.tick, maxEvents: journal.retention.maxEvents, events: replay.events,
    retiredEvents: stats.retiredEvents, checkpointRotations: stats.checkpointRotations };
}

/** Rule execution is opt-in in this isolated experiment; the game defaults to proposals. */
export function runOwnerDecisionBenchmark({ days = OWNER_BENCHMARK_DAYS, seeds = OWNER_BENCHMARK_SEEDS } = {}) {
  assert(Number.isSafeInteger(days) && days > 0 && days <= 7200, 'Bounded positive simulation horizon');
  assert(Array.isArray(seeds) && seeds.length > 0 && seeds.length <= 16 && new Set(seeds).size === seeds.length);
  assert(seeds.every(seed => Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff));
  const sourceHashes = Object.fromEntries(['sim.ts', 'owner-decision.ts', 'owner-decision-session.ts'].map(name =>
    [name, createHash('sha256').update(readFileSync(new URL('../src/' + name, import.meta.url))).digest('hex')]));
  const started = performance.now(), rows = [];
  for (const seed of seeds) {
    const baseline = createCity(seed), proposal = createCity(seed), execution = createCity(seed);
    const proposalSession = createOwnerDecisionSession(proposal), executionSession = createOwnerDecisionSession(execution);
    assert.equal(proposalSession.mode, 'proposal', 'A fresh session never starts autonomous');
    executionSession.setMode('auto');
    const monthly = { baseline: [], proposalOnly: [], ruleExecution: [] };
    let priorProposalEvaluated = 0, priorExecutionEvaluated = 0, applied = 0, held = 0;
    for (let day = 1; day <= days; day++) {
      step(baseline);
      proposalSession.advance(proposal);
      const outcomes = executionSession.advance(execution);
      for (const city of [baseline, proposal, execution]) reconcile(city);
      const proposalStats = proposalSession.getStats(), executionStats = executionSession.getStats();
      if (day % 30 !== 0) {
        assert.equal(proposalStats.evaluated, priorProposalEvaluated, 'No per-day owner decision evaluation');
        assert.equal(executionStats.evaluated, priorExecutionEvaluated, 'Auto decisions occur only after a completed monthly tick');
        assert.equal(outcomes.length, 0, 'No off-cycle automatic command');
      }
      priorProposalEvaluated = proposalStats.evaluated; priorExecutionEvaluated = executionStats.evaluated;
      for (const outcome of outcomes) {
        assert.notEqual(outcome.status, 'rejected', 'Fresh deterministic rule proposals remain valid when scheduled');
        if (outcome.status === 'applied') applied++;
        if (outcome.status === 'held') held++;
        const market = execution.firms.find(f => f.id === outcome.firmId);
        assert(market && isMarket(market) && market.owner?.householdId === outcome.actorId);
      }
      if (day % 30 === 0 || day === days) {
        assert.equal(serialize(proposal), serialize(baseline), 'Proposal-only decisions must have zero effect on canonical simulation');
        monthly.baseline.push(metrics(baseline)); monthly.proposalOnly.push(metrics(proposal)); monthly.ruleExecution.push(metrics(execution));
      }
    }
    for (const city of [baseline, proposal, execution]) {
      const raw = serialize(city);
      assert.equal(serialize(deserialize(raw)), raw, 'Complete final state round-trips under current migration/validation');
      reconcile(city);
    }
    const proposalReplay = verifyRetainedReplay(proposal, proposalSession), executionReplay = verifyRetainedReplay(execution, executionSession);
    const proposalStats = proposalSession.getStats(), executionStats = executionSession.getStats();
    assert.equal(proposalStats.applied, 0, 'Proposal mode never executes commands');
    assert.equal(proposalStats.contributedSatang, 0); assert.equal(proposalStats.withdrawnSatang, 0);
    assert.equal(executionStats.applied, applied); assert.equal(executionStats.held, held);
    rows.push({ seed, baseline: { final: metrics(baseline), stateHash: ownerStateHash(baseline) },
      proposalOnly: { final: metrics(proposal), stateHash: ownerStateHash(proposal), identicalToBaseline: true,
        decisions: proposalStats, replay: proposalReplay },
      ruleExecution: { final: metrics(execution), stateHash: ownerStateHash(execution), decisions: executionStats,
        replay: executionReplay }, monthly });
  }
  return { schemaVersion: 1, benchmark: 'owner-rule-phase1', baseline: 'chain-2', saveVersion: 7,
    horizonDays: days, seeds: [...seeds], sourceHashes, moneyUnit: 'satang', monthlyPeriodDays: 30,
    retentionMode: 'production-default', retentionMaxEvents: rows[0].ruleExecution.replay.maxEvents,
    treatments: ['fixed-chain-2', 'rule-proposal-only', 'rule-execution-opt-in'], llmTreatment: 'not implemented; future same-interface comparison',
    checked: ['money/goods/crops/inventory conservation every day', 'no negative internal cash', 'canonical household member counts',
      'proposal-only exact state equivalence each month', 'current-save final round-trip', 'retained checkpoint replay exact final state',
      'monthly-only automatic evaluation and real market household ownership'],
    rows, elapsedMs: Math.round(performance.now() - started), providerRequests: 0,
    limitations: ['Synthetic seeded prototype experiment, not evidence that a policy is economically optimal.',
      'Replay covers the explicitly retained checkpoint window; retired event counts and coverage are reported.',
      'Legacy migration, stale/invalid proposals and command idempotency are additionally verified by focused unit tests.'] };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  assert(args.length === 0 || args.length === 2 && args[0] === '--out', 'Usage: node --experimental-strip-types scripts/owner-decision-benchmark.mjs [--out summary.json]');
  const report = runOwnerDecisionBenchmark();
  if (args.length) {
    const output = resolve(args[1]); await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ benchmark: report.benchmark, horizonDays: report.horizonDays, seeds: report.seeds,
      elapsedMs: report.elapsedMs, providerRequests: 0, output }));
  } else console.log(JSON.stringify(report, null, 2));
}
