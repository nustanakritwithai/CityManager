import test from 'node:test';
import assert from 'node:assert/strict';
import { contributeOwnerCapital, createCity, deserialize, isMarket, serialize, step, type City } from '../src/sim.ts';
import { createCity as createLegacy, serialize as serializeLegacy, step as stepLegacy } from '../src/legacy-v5.ts';
import { createOwnerDecisionSession, replayOwnerJournal } from '../src/owner-decision-session.ts';
import { captureOwnerSnapshot, ownerProposalForCandidate } from '../src/owner-decision.ts';

function town(day = 30): City { const c = createCity(61025); for (let n = 0; n < day; n++) step(c); return c; }
function market(c: City) { const f = c.firms.find(isMarket); assert(f?.owner); return f; }
function replay(c: City, session: ReturnType<typeof createOwnerDecisionSession>) {
  const exported = JSON.parse(JSON.stringify(session.exportJournal()));
  const result = replayOwnerJournal(exported);
  assert.equal(result.ok, true, result.code); assert(result.city);
  assert.equal(serialize(result.city), serialize(c)); return result;
}

test('default proposal mode follows fixed growth without any canonical-state changes or hidden auto execution', () => {
  const c = createCity(61025), baseline = createCity(61025), session = createOwnerDecisionSession(c);
  assert.equal(session.mode, 'proposal');
  for (let n = 1; n <= 60; n++) {
    step(baseline); assert.deepEqual(session.advance(c), []);
    assert.equal(serialize(c), serialize(baseline));
    if (n % 30) assert.equal(session.getStats().monthlyEvaluations, Math.floor(n / 30));
  }
  assert.equal(session.getStats().monthlyEvaluations, 2); assert(session.getStats().evaluated > 0);
  assert.equal(session.getStats().applied, 0); assert.equal(session.getStats().held, 0); replay(c, session);
});

test('explicit auto runs only after monthly ticks, is ordered/deterministic and replays the resulting commands', () => {
  const c = createCity(61025), twin = createCity(61025), session = createOwnerDecisionSession(c), other = createOwnerDecisionSession(twin);
  session.setMode('auto'); other.setMode('auto');
  assert.equal(session.getStats().applied, 0);
  for (let n = 1; n <= 90; n++) {
    const outcomes = session.advance(c), same = other.advance(twin);
    assert.deepEqual(outcomes, same); if (n % 30) assert.equal(outcomes.length, 0);
    assert.deepEqual(outcomes.map(o => o.firmId), outcomes.map(o => o.firmId).sort((a, b) => Number(a) - Number(b)));
  }
  assert(session.getStats().applied > 0); assert.equal(session.getStats().monthlyEvaluations, 3);
  assert.equal(serialize(c), serialize(twin)); assert.deepEqual(session.exportJournal(), other.exportJournal()); replay(c, session);
});

test('manual proposals apply existing guarded transfers once; duplicate and unknown IDs cannot mutate cash', () => {
  const c = town(), f = market(c), session = createOwnerDecisionSession(c), before = serialize(c);
  const [proposal] = session.evaluate(c, f.id); assert(proposal); assert.equal(serialize(c), before);
  const outcome = session.apply(c, proposal.proposalId); assert.equal(outcome.status, 'applied');
  const once = serialize(c);
  assert.equal(session.apply(c, proposal.proposalId).code, 'duplicate-proposal');
  assert.equal(session.apply(c, 'unknown-owner-proposal').code, 'unknown-proposal');
  assert.equal(serialize(c), once); assert.equal(session.getStats().applied, 1); assert.equal(session.getStats().rejected, 2);
  replay(c, session);
});

test('an explicit Typhoon hold is journaled, replayed and remains a no-transfer owner proposal', () => {
  const c = town(), f = market(c), session = createOwnerDecisionSession(c), before = serialize(c);
  const snapshot = captureOwnerSnapshot(c, f.id); assert(snapshot);
  const proposal = ownerProposalForCandidate(snapshot, 'hold');
  assert.equal(session.registerTyphoonProposal(c, proposal), true);
  assert.equal(session.getProposalSource(proposal.proposalId), 'typhoon');
  assert.equal(serialize(c), before);
  const replayed = replay(c, session); assert.equal(serialize(replayed.city!), before);
  const outcome = session.apply(c, proposal.proposalId);
  assert.equal(outcome.status, 'held'); assert.equal(serialize(c), before);
  assert.equal(session.apply(c, proposal.proposalId).code, 'duplicate-proposal');
  replay(c, session); assert.equal(serialize(c), before);
});

test('Typhoon auto executes one validated existing transfer after the monthly choice and replays without a model call', () => {
  const c = town(29), session = createOwnerDecisionSession(c);
  session.setMode('typhoon-auto');
  assert.deepEqual(session.advance(c), []); assert.equal(c.tick, 30);
  const f = market(c), [ruleProposal] = session.evaluateTyphoonAutoMonthly(c, f.id);
  assert(ruleProposal); const snapshot = captureOwnerSnapshot(c, f.id); assert(snapshot);
  const aiProposal = ownerProposalForCandidate(snapshot, 'safe-transfer');
  const beforeState = serialize(c), beforeAccounts = structuredClone(c.accounts), beforeLedger = c.ledger.length;
  assert.equal(session.registerTyphoonProposal(c, aiProposal), true);
  const outcome = session.applyTyphoonAuto(c, aiProposal.proposalId, 'typhoon-auto');
  assert.equal(outcome.status, 'applied'); assert.equal(outcome.ok, true);
  assert(['contributeOwnerCapital', 'withdrawOwnerProfit'].includes(outcome.command!.type));
  assert.notEqual(serialize(c), beforeState); assert.equal(c.ledger.length, beforeLedger + 1);
  assert.equal(Object.values(c.accounts).reduce((sum, amount) => sum + amount, 0), 0);
  assert.notDeepEqual(c.accounts, beforeAccounts);
  const once = serialize(c);
  assert.equal(session.applyTyphoonAuto(c, aiProposal.proposalId, 'typhoon-auto').code, 'duplicate-proposal');
  assert.equal(serialize(c), once);
  replay(c, session); assert.equal(serialize(c), once);
});

test('Typhoon quarter and half choices execute their exact finite amounts once and replay from the journal', () => {
  for (const [candidateId, amountSatang] of [['safe-transfer-quarter', 2_500], ['safe-transfer-half', 5_000]] as const) {
    const c = town(29), session = createOwnerDecisionSession(c);
    session.setMode('typhoon-auto'); assert.deepEqual(session.advance(c), []);
    const firm = market(c), [ruleProposal] = session.evaluateTyphoonAutoMonthly(c, firm.id); assert(ruleProposal);
    const snapshot = captureOwnerSnapshot(c, firm.id); assert(snapshot);
    const proposal = ownerProposalForCandidate(snapshot, candidateId);
    assert.equal(proposal.command.type, 'withdrawOwnerProfit');
    assert.equal(proposal.command.amountSatang, amountSatang);
    const before = serialize(c), ledgerBefore = c.ledger.length;
    assert.equal(session.registerTyphoonProposal(c, proposal), true);
    const result = session.applyTyphoonAuto(c, proposal.proposalId, 'typhoon-auto');
    assert.equal(result.status, 'applied'); assert.equal(result.command?.amountSatang, amountSatang);
    assert.equal(c.ledger.length, ledgerBefore + 1); assert.notEqual(serialize(c), before);
    assert(c.accounts[firm.wallet] >= snapshot.facts.firmTotalReserve!);
    const once = serialize(c);
    assert.equal(session.applyTyphoonAuto(c, proposal.proposalId, 'typhoon-auto').code, 'duplicate-proposal');
    assert.equal(serialize(c), once);
    replay(c, session); assert.equal(serialize(c), once);
  }
});

test('invalid or stale Typhoon auto suggestions are rejected without a transfer', () => {
  const c = town(29), session = createOwnerDecisionSession(c);
  session.setMode('typhoon-auto'); session.advance(c);
  const f = market(c), [baseline] = session.evaluateTyphoonAutoMonthly(c, f.id); assert(baseline);
  const snapshot = captureOwnerSnapshot(c, f.id); assert(snapshot);
  const valid = ownerProposalForCandidate(snapshot, 'safe-transfer');
  const invalid = structuredClone(valid); invalid.command.amountSatang += 1;
  const beforeInvalid = serialize(c);
  assert.equal(session.registerTyphoonProposal(c, invalid), false); assert.equal(serialize(c), beforeInvalid);
  session.advance(c);
  const beforeStale = serialize(c);
  assert.equal(session.registerTyphoonProposal(c, valid), false);
  assert.notEqual(session.applyTyphoonAuto(c, valid.proposalId, 'typhoon-auto').status, 'applied');
  assert.equal(serialize(c), beforeStale); replay(c, session);
});

test('old proposals are rejected after the next tick without mutating the newer state', () => {
  const c = town(), session = createOwnerDecisionSession(c), [proposal] = session.evaluate(c, market(c).id);
  session.advance(c); const newer = serialize(c);
  assert.equal(session.apply(c, proposal.proposalId).code, 'stale-snapshot'); assert.equal(serialize(c), newer);
  replay(c, session);
});

test('explicit external changes begin a new honest checkpoint and discard previous pending proposals', () => {
  const c = town(), session = createOwnerDecisionSession(c), [proposal] = session.evaluate(c, market(c).id);
  // Existing public mutator/data authority is outside the owner sidecar; no simulated command is invented.
  c.lastEvent = 'A player changed the selected tool state'; session.syncExternal(c, 'player-command');
  assert.equal(session.getProposals().length, 0); assert.equal(session.exportJournal().checkpoint.reason, 'player-command');
  const newer = serialize(c); assert.equal(session.apply(c, proposal.proposalId).code, 'unknown-proposal'); assert.equal(serialize(c), newer);
  assert(session.getStats().retiredEvents > 0); replay(c, session);
});

test('retention rotates explicit checkpoints, keeps cumulative results and replays exactly the retained window', () => {
  const c = createCity(61025), session = createOwnerDecisionSession(c, { maxEvents: 8 }); session.setMode('auto');
  for (let n = 0; n < 90; n++) session.advance(c);
  const stats = session.getStats(), journal = session.exportJournal();
  assert(stats.checkpointRotations > 0); assert(stats.retiredEvents > 0); assert(stats.coverageStartTick > 0);
  assert(journal.events.length <= 8); assert(journal.retired.length <= 8); assert(stats.applied > 0);
  assert.equal(stats.activeEvents, journal.events.length); assert.equal(stats.checkpointTick, journal.checkpoint.tick);
  assert.equal(replay(c, session).coverageStartTick, journal.checkpoint.tick);
});

test('unpaired external ticks never masquerade as replayed steps or trigger automatic owner decisions', () => {
  const c = town(29), session = createOwnerDecisionSession(c); session.setMode('auto');
  step(c); const afterStep = serialize(c); assert.deepEqual(session.afterTick(c), []);
  assert.equal(serialize(c), afterStep); assert.equal(session.getStats().applied, 0);
  assert.equal(session.exportJournal().checkpoint.reason, 'unpaired-tick-checkpoint'); replay(c, session);
});

test('bounded tick ranges seal at decisions and reject unnotified external mutations before auto execution', () => {
  const c = town(), baseline = deserialize(serialize(c)), session = createOwnerDecisionSession(c); session.setMode('auto');
  session.advance(c); step(baseline);
  assert.equal(session.getStats().pendingTicks, 1);
  const id = market(c).id;
  assert.equal(contributeOwnerCapital(c, id, 10_000).ok, true);
  assert.equal(contributeOwnerCapital(baseline, id, 10_000).ok, true);
  for (let n = 0; n < 29; n++) { session.advance(c); step(baseline); }
  assert.equal(session.mode, 'proposal'); assert.equal(session.getStats().recording, false);
  assert.equal(session.getStats().issue, 'unnotified-state-change'); assert.equal(session.getStats().applied, 0);
  assert.equal(serialize(c), serialize(baseline)); assert.throws(() => session.exportJournal());
  session.syncExternal(c, 'confirmed-player-command');
  assert.equal(session.mode, 'proposal'); assert.equal(session.getStats().recording, true); replay(c, session);
  session.advance(c); session.beforeExternal(c);
  assert.equal(session.getStats().pendingTicks, 0);
  assert(session.exportJournal().events.some(event => event.kind === 'step' && event.tick > event.fromTick));
});

test('off blocks manual execution and load/reset never restores auto or changes imported v1-v5 state', () => {
  const c = town(), session = createOwnerDecisionSession(c), [proposal] = session.evaluate(c, market(c).id);
  session.setMode('off'); const before = serialize(c);
  assert.equal(session.apply(c, proposal.proposalId).code, 'mode-off'); assert.deepEqual(session.evaluate(c), []); assert.equal(serialize(c), before); replay(c, session);
  const old = createLegacy(61025); for (let n = 0; n < 30; n++) stepLegacy(old);
  const imported = deserialize(serializeLegacy(old)), frozen = serialize(imported);
  session.setMode('auto'); session.reset(imported);
  assert.equal(session.mode, 'proposal'); assert.equal(serialize(imported), frozen); assert.equal(imported.version, 6);
  assert.equal(Object.hasOwn(imported, 'ownerDecisions'), false); replay(imported, session);
});

test('tampered or reordered sidecars are rejected without modifying the caller city', () => {
  const c = town(), session = createOwnerDecisionSession(c); const [proposal] = session.evaluate(c, market(c).id); session.apply(c, proposal.proposalId);
  const original = serialize(c), journal = session.exportJournal();
  const variants = [
    (j: typeof journal) => { j.checkpoint.stateHash = 'forged'; },
    (j: typeof journal) => { j.events.reverse(); },
    (j: typeof journal) => { j.finalHash = 'forged'; },
    (j: typeof journal) => { j.stats.withdrawnSatang++; },
    (j: typeof journal) => { (j as unknown as Record<string, unknown>).newAction = 'expandLevel'; },
  ];
  for (const change of variants) { const changed = structuredClone(journal); change(changed); const r = replayOwnerJournal(changed); assert.equal(r.ok, false); assert.equal(r.city, null); }
  assert.equal(serialize(c), original);
  const exposed = session.getProposals(); exposed[0].command.amountSatang = 999999;
  assert.notEqual(session.getProposals()[0].command.amountSatang, 999999); replay(c, session);
});

test('unavailable checkpoint capacity fails closed for owner commands while the base simulation remains usable', () => {
  const c = town(); c.lastEvent = 'x'.repeat(12_000_001);
  const session = createOwnerDecisionSession(c); session.setMode('auto');
  assert.equal(session.mode, 'proposal'); assert.equal(session.getStats().recording, false);
  const accounts = structuredClone(c.accounts);
  assert.equal(session.apply(c, 'unavailable').status, 'rejected'); assert.deepEqual(c.accounts, accounts);
  assert.throws(() => session.exportJournal());
});
