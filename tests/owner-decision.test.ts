import test from 'node:test';
import assert from 'node:assert/strict';
import { bulldoze, contributeOwnerCapital, createCity, deserialize, ownerFinance, serialize, step, type City } from '../src/sim.ts';
import { captureOwnerSnapshot, executeOwnerProposal, ownerStateHash, proposeOwnerDecision, validateOwnerProposal, type OwnerProposal } from '../src/owner-decision.ts';
import { ownerDecisionCandidates, validateOwnerDecisionSelection } from '../server/city-advisor/src/owner-contract.mjs';

function fixture(day = 210) {
  const city = createCity(61025);
  for (let n = 0; n < day; n++) step(city);
  const firm = city.firms.find(f => f.commercialKind === 'market')!;
  assert(firm?.owner, 'Real seeded market has its actual household owner');
  const household = city.households.find(h => h.id === firm.owner!.householdId)!;
  return { city, firm, household };
}
const freeze = (v: unknown): void => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(freeze); } };
const snapshot = (city: City, firmId: number) => { const s = captureOwnerSnapshot(city, firmId); assert(s); return s; };
function conserved(city: City) {
  assert.equal(Object.values(city.accounts).reduce((n, amount) => n + amount, 0), 0);
  assert.equal(city.goods.produced + city.goods.imported - city.goods.consumed - city.goods.exported, city.firms.reduce((n, f) => n + f.inventory, 0));
  assert.equal(city.crops.harvested - city.crops.processed - city.crops.consumed - city.crops.writtenOff - (city.crops.exported ?? 0), city.firms.reduce((n, f) => n + f.cropInventory, 0));
}
// Stress fixtures record both sides of a synthetic non-operating cash movement.
// They are not a new game command and do not claim an operating profit/expense.
function recordedCashMove(city: City, from: string, to: string, amount: number) {
  assert(Number.isSafeInteger(amount) && amount >= 0 && city.accounts[from] >= amount);
  city.accounts[from] -= amount; city.accounts[to] += amount;
  city.ledger.push({ tick: city.tick, from, to, amount, reason: 'Synthetic reserve-boundary fixture' });
}

test('owner capture/proposal is copied, deterministic and read-only for real market households only', () => {
  const { city, firm, household } = fixture(), before = serialize(city), beforeHash = ownerStateHash(city);
  freeze(city);
  const first = snapshot(city, firm.id), second = snapshot(city, firm.id);
  assert.deepEqual(first, second); assert.equal(first.actorId, household.id); assert.equal(first.homeId, household.home);
  assert.equal(first.moneyUnit, 'satang'); assert.equal(first.horizonDays, 30); assert.equal(first.budgetKnown, true);
  assert.equal(first.facts.householdEssentialReserve, 34_000, 'One basket per household/day plus current monthly rent, not a per-person invented cost');
  assert.equal(first.facts.firmTotalReserve, first.facts.earnedPayrollReserve! + first.facts.firmTaxReserve! + first.facts.firmRentReserve! + first.facts.firmWorkingReserve!);
  assert.deepEqual(proposeOwnerDecision(first), proposeOwnerDecision(second));
  first.facts.householdCash = 1;
  assert.equal(serialize(city), before); assert.equal(ownerStateHash(city), beforeHash);
  const factory = city.firms.find(f => f.zone === 'I')!;
  assert.equal(captureOwnerSnapshot(city, factory.id), null);
  assert.equal(captureOwnerSnapshot(city, -1), null);
});

test('realized profit withdrawal uses the existing command and retains firm reserves, principal and every inventory', () => {
  // Open-month earnings, after the previous month's automatic distribution.
  const { city, firm, household } = fixture(215), s = snapshot(city, firm.id), proposal = proposeOwnerDecision(s);
  assert.equal(proposal.command.type, 'withdrawOwnerProfit'); assert.equal(validateOwnerProposal(city, proposal).ok, true);
  const cashBefore = [city.accounts[household.wallet], city.accounts[firm.wallet]], capital = firm.owner!.capitalContributed;
  const profitBefore = firm.owner!.withdrawn, ledgers = [city.ledger.length, city.goodsLedger.length, city.cropLedger.length];
  const result = executeOwnerProposal(city, proposal);
  assert.equal(result.status, 'applied'); assert.equal(result.ok, true); assert.notEqual(result.beforeHash, result.afterHash);
  assert.deepEqual([city.accounts[household.wallet], city.accounts[firm.wallet]], [cashBefore[0] + proposal.command.amountSatang, cashBefore[1] - proposal.command.amountSatang]);
  assert.equal(firm.owner!.withdrawn, profitBefore + proposal.command.amountSatang); assert.equal(firm.owner!.capitalContributed, capital);
  assert(city.accounts[firm.wallet] >= s.facts.firmTotalReserve!);
  assert.equal(city.ledger.length, ledgers[0] + 1); assert.equal(city.ledger.at(-1)?.reason, 'Owner profit distribution');
  assert.deepEqual([city.goodsLedger.length, city.cropLedger.length], ledgers.slice(1));
  conserved(city); assert.deepEqual(deserialize(serialize(city)), city);
});

test('a cash shortfall can use only actual household surplus, without creating outside capital', () => {
  const { city, firm, household } = fixture();
  recordedCashMove(city, firm.wallet, 'landlord', city.accounts[firm.wallet] - 18_000);
  const s = snapshot(city, firm.id), proposal = proposeOwnerDecision(s);
  assert.equal(proposal.command.type, 'contributeOwnerCapital'); assert.equal(proposal.command.amountSatang, 5_000);
  const outside = city.accounts.outside, beforeHousehold = city.accounts[household.wallet];
  assert.equal(executeOwnerProposal(city, proposal).status, 'applied');
  assert.equal(city.accounts[firm.wallet], s.facts.firmTotalReserve);
  assert.equal(city.accounts[household.wallet], beforeHousehold - 5_000); assert(city.accounts[household.wallet] >= s.facts.householdEssentialReserve!);
  assert.equal(city.accounts.outside, outside); assert.equal(city.ledger.at(-1)?.reason, 'Owner capital contribution');
  conserved(city); assert.deepEqual(deserialize(serialize(city)), city);
});

test('Typhoon receives distinct quarter, half and full safe contribution amounts only', () => {
  const { city, firm } = fixture();
  recordedCashMove(city, firm.wallet, 'landlord', city.accounts[firm.wallet] - 18_000);
  const s = snapshot(city, firm.id), candidates = ownerDecisionCandidates(s);
  assert.equal(s.facts.safeContribute, 5_000);
  assert.deepEqual(candidates, [
    { id: 'hold', action: 'hold', amountSatang: 0 },
    { id: 'safe-transfer-quarter', action: 'contributeOwnerCapital', amountSatang: 1_250 },
    { id: 'safe-transfer-half', action: 'contributeOwnerCapital', amountSatang: 2_500 },
    { id: 'safe-transfer', action: 'contributeOwnerCapital', amountSatang: 5_000 },
  ]);
  assert.equal(new Set(candidates.map(candidate => candidate.amountSatang)).size, candidates.length);
  assert(candidates.every(candidate => candidate.amountSatang <= s.facts.safeContribute!));
  for (const candidate of candidates) assert.equal(validateOwnerDecisionSelection({ candidateId: candidate.id }, s).candidateId, candidate.id);
  assert.throws(() => validateOwnerDecisionSelection({ candidateId: 'arbitrary-amount' }, s));
});

test('fractional choices that round to zero are omitted without losing the legacy full-safe ID', () => {
  const { city, firm } = fixture(), initial = snapshot(city, firm.id);
  recordedCashMove(city, firm.wallet, 'landlord', city.accounts[firm.wallet] - (initial.facts.firmTotalReserve! - 3));
  const s = snapshot(city, firm.id), candidates = ownerDecisionCandidates(s);
  assert.equal(s.facts.safeContribute, 3);
  assert.deepEqual(candidates, [
    { id: 'hold', action: 'hold', amountSatang: 0 },
    { id: 'safe-transfer-half', action: 'contributeOwnerCapital', amountSatang: 1 },
    { id: 'safe-transfer', action: 'contributeOwnerCapital', amountSatang: 3 },
  ]);
  assert.throws(() => validateOwnerDecisionSelection({ candidateId: 'safe-transfer-quarter' }, s));
});

test('household essentials and next rent cap a partial contribution instead of draining its wallet', () => {
  const { city, firm, household } = fixture();
  recordedCashMove(city, firm.wallet, 'landlord', city.accounts[firm.wallet] - 18_000);
  recordedCashMove(city, household.wallet, 'landlord', city.accounts[household.wallet] - 34_500);
  const proposal = proposeOwnerDecision(snapshot(city, firm.id));
  assert.deepEqual(proposal.command, { type: 'contributeOwnerCapital', amountSatang: 500 });
  assert.equal(executeOwnerProposal(city, proposal).status, 'applied');
  assert.equal(city.accounts[household.wallet], 34_000); conserved(city);
  const next = proposeOwnerDecision(snapshot(city, firm.id));
  assert.deepEqual(next.command, { type: 'hold', amountSatang: 0 });
});

test('cash is not profit and withdrawal retains next rent in addition to existing command reserves', () => {
  const { city, firm } = fixture(215);
  step(city); // a current open-month tax reserve is now available from actual activity
  const initial = snapshot(city, firm.id);
  assert(initial.facts.distributableProfit! > 0);
  const development = ownerFinance(city, firm.id)!.developmentReserve;
  recordedCashMove(city, firm.wallet, 'landlord', city.accounts[firm.wallet] - initial.facts.firmTotalReserve! - development - 700);
  const s = snapshot(city, firm.id), proposal = proposeOwnerDecision(s);
  assert.equal(s.facts.safeWithdraw, 700); assert(s.facts.withdrawAvailable! > s.facts.safeWithdraw!);
  assert.deepEqual(proposal.command, { type: 'withdrawOwnerProfit', amountSatang: 700 });
  assert.equal(executeOwnerProposal(city, proposal).status, 'applied');
  assert.equal(city.accounts[firm.wallet], s.facts.firmTotalReserve! + development); conserved(city);
});

test('missing home or uncomputable amounts produce hold with no state change', () => {
  const { city, firm, household } = fixture();
  const home = city.buildings.find(b => b.id === household.home)!;
  assert.equal(bulldoze(city, home.cell).ok, true);
  const before = serialize(city), s = snapshot(city, firm.id), proposal = proposeOwnerDecision(s);
  assert.equal(s.budgetKnown, false); assert(s.missing.includes('home-unavailable')); assert.equal(s.facts.householdRentReserve, null);
  assert.deepEqual(proposal.command, { type: 'hold', amountSatang: 0 }); assert.equal(executeOwnerProposal(city, proposal).status, 'held');
  assert.equal(serialize(city), before);
  const broken = fixture(); delete broken.city.accounts[broken.household.wallet];
  const incomplete = snapshot(broken.city, broken.firm.id);
  assert.equal(incomplete.budgetKnown, false); assert.equal(incomplete.facts.householdCash, null);
  assert.equal(proposeOwnerDecision(incomplete).reason, 'budget-unavailable');
});

test('current time or same-tick state changes reject an old proposal without further mutation', () => {
  const { city, firm } = fixture(), old = proposeOwnerDecision(snapshot(city, firm.id));
  step(city); const afterTick = serialize(city);
  assert.equal(executeOwnerProposal(city, old).code, 'stale-snapshot'); assert.equal(serialize(city), afterTick);
  const fresh = proposeOwnerDecision(snapshot(city, firm.id));
  assert.equal(contributeOwnerCapital(city, firm.id, 1).ok, true); const afterCommand = serialize(city);
  assert.equal(validateOwnerProposal(city, fresh).code, 'stale-snapshot');
  assert.equal(executeOwnerProposal(city, fresh).ok, false); assert.equal(serialize(city), afterCommand);
});

test('forged actor/facts/commands/amounts/unknown fields cannot cross the command boundary', () => {
  const { city, firm } = fixture(), valid = proposeOwnerDecision(snapshot(city, firm.id)), before = serialize(city);
  const variants = [
    (p: OwnerProposal & Record<string, unknown>) => { p.patch = { accounts: {} }; },
    (p: OwnerProposal) => { p.snapshot.actorId++; },
    (p: OwnerProposal) => { p.snapshot.facts.firmCash!++; },
    (p: OwnerProposal) => { p.snapshot.snapshotHash = 'forged'; },
    (p: OwnerProposal) => { p.command.type = 'expandLevel' as 'hold'; },
    (p: OwnerProposal) => { p.command.amountSatang = -1; },
    (p: OwnerProposal) => { p.command.amountSatang = 1.5; },
    (p: OwnerProposal) => { p.command.amountSatang = Number.MAX_SAFE_INTEGER + 1; },
    (p: OwnerProposal) => { p.evidenceIds = ['invented' as 'firmCash']; },
    (p: OwnerProposal) => { p.proposalId = 'forged'; },
  ];
  for (const change of variants) {
    const bad = structuredClone(valid); change(bad);
    assert.equal(validateOwnerProposal(city, bad).ok, false); assert.equal(executeOwnerProposal(city, bad).status, 'rejected');
    assert.equal(serialize(city), before);
  }
  assert.equal(validateOwnerProposal(city, null).ok, false);
});

test('future rules cannot silently use growth-1 reserve assumptions', () => {
  const { city, firm } = fixture(); (city as unknown as { rulesVersion: string }).rulesVersion = 'growth-2';
  const before = serialize(city), s = snapshot(city, firm.id), proposal = proposeOwnerDecision(s);
  assert.equal(s.rulesVersion, 'growth-2'); assert.equal(s.budgetKnown, false); assert(s.missing.includes('unsupported-rules'));
  assert.equal(s.facts.householdEssentialReserve, null); assert.equal(proposal.reason, 'budget-unavailable');
  assert.equal(executeOwnerProposal(city, proposal).status, 'held'); assert.equal(serialize(city), before);
});
