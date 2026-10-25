/** Wire contract for a supervised market-owner suggestion. No credentials or game state. */
const POLICY = 'owner-rule-1';
const FACT_KEYS = [
  'householdCash', 'householdFoodReserve', 'householdRentReserve', 'householdEssentialReserve',
  'householdSurplus', 'firmCash', 'earnedPayrollReserve', 'firmTaxReserve', 'firmRentReserve',
  'firmWorkingReserve', 'firmTotalReserve', 'firmCashShortfall', 'contributeAvailable',
  'withdrawAvailable', 'distributableProfit', 'safeContribute', 'safeWithdraw',
];
const MISSING = [
  'unsupported-rules', 'home-unavailable', 'access-unavailable', 'invalid-household-budget',
  'invalid-firm-budget', 'invalid-owner-finance', 'budget-overflow',
];
const MAX_BYTES = 16 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const money = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : plain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
function fingerprint(text) {
  let a = 2166136261, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) { const n = text.charCodeAt(i); a = Math.imul(a ^ n, 16777619); b = Math.imul(b ^ n, 2246822519); }
  return text.length.toString(36) + '-' + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
const fail = () => { throw Object.assign(new Error('invalid_owner_decision'), { status: 400, code: 'invalid_owner_decision' }); };
function byteBound(value) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BYTES) fail();
}

/** Validate the exact client snapshot, its integrity hash and the current reserve equations. */
export function validateOwnerSnapshot(value) {
  const keys = ['schemaVersion', 'policyVersion', 'rulesVersion', 'tick', 'actorId', 'firmId', 'buildingId', 'homeId', 'moneyUnit', 'horizonDays', 'stateHash', 'snapshotHash', 'budgetKnown', 'missing', 'facts'];
  if (!exact(value, keys)) fail();
  byteBound(value);
  if (value.schemaVersion !== 1 || value.policyVersion !== POLICY || typeof value.rulesVersion !== 'string' || !/^[a-z0-9.-]{1,32}$/.test(value.rulesVersion) || !money(value.tick) || !positive(value.actorId) || !positive(value.firmId) || !positive(value.buildingId) || (value.homeId !== null && !positive(value.homeId)) || value.moneyUnit !== 'satang' || value.horizonDays !== 30 || typeof value.stateHash !== 'string' || !/^state-1-[a-z0-9]+-[0-9a-f]{16}$/.test(value.stateHash) || typeof value.snapshotHash !== 'string' || typeof value.budgetKnown !== 'boolean') fail();
  if (!Array.isArray(value.missing) || value.missing.length > MISSING.length || new Set(value.missing).size !== value.missing.length || value.missing.some(code => !MISSING.includes(code))) fail();
  if (!exact(value.facts, FACT_KEYS) || FACT_KEYS.some(key => value.facts[key] !== null && !money(value.facts[key]))) fail();
  const withoutHash = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'snapshotHash'));
  if (value.snapshotHash !== 'owner-snapshot-1-' + fingerprint(canonical(withoutHash))) fail();
  if (value.budgetKnown) {
    if (value.missing.length || value.homeId === null || FACT_KEYS.some(key => !money(value.facts[key]))) fail();
    const f = value.facts;
    const essentials = f.householdFoodReserve + f.householdRentReserve;
    const reserves = f.earnedPayrollReserve + f.firmTaxReserve + f.firmRentReserve + f.firmWorkingReserve;
    if (![essentials, reserves].every(money) || f.householdEssentialReserve !== essentials || f.firmTotalReserve !== reserves) fail();
    const surplus = Math.max(0, f.householdCash - essentials);
    const shortfall = Math.max(0, reserves - f.firmCash);
    const contribute = Math.min(10_000, shortfall, surplus, f.contributeAvailable);
    const withdraw = Math.max(0, Math.min(10_000, f.withdrawAvailable, f.firmCash - reserves));
    if (f.householdSurplus !== surplus || f.firmCashShortfall !== shortfall || f.safeContribute !== contribute || f.safeWithdraw !== withdraw) fail();
  } else if (!value.missing.length || value.facts.safeContribute !== null || value.facts.safeWithdraw !== null) fail();
  return structuredClone(value);
}

export function validateOwnerDecisionRequest(value) {
  if (!exact(value, ['schemaVersion', 'operation', 'locale', 'snapshot']) || value.schemaVersion !== 3 || value.operation !== 'owner-decision' || value.locale !== 'th') fail();
  byteBound(value);
  return { schemaVersion: 3, operation: 'owner-decision', locale: 'th', snapshot: validateOwnerSnapshot(value.snapshot) };
}

const ruleCommand = snapshot => {
  if (!snapshot.budgetKnown) return { type: 'hold', amountSatang: 0 };
  if (snapshot.facts.safeContribute > 0) return { type: 'contributeOwnerCapital', amountSatang: snapshot.facts.safeContribute };
  if (snapshot.facts.safeWithdraw > 0) return { type: 'withdrawOwnerProfit', amountSatang: snapshot.facts.safeWithdraw };
  return { type: 'hold', amountSatang: 0 };
};
export function ownerDecisionCandidates(raw) {
  const snapshot = validateOwnerSnapshot(raw), command = ruleCommand(snapshot);
  const candidates = [{ id: 'hold', action: 'hold', amountSatang: 0 }];
  if (command.type !== 'hold') {
    const seen = new Set();
    for (const [id, divisor] of [['safe-transfer-quarter', 4], ['safe-transfer-half', 2], ['safe-transfer', 1]]) {
      const amountSatang = Math.floor(command.amountSatang / divisor);
      if (amountSatang > 0 && !seen.has(amountSatang)) {
        candidates.push({ id, action: command.type, amountSatang });
        seen.add(amountSatang);
      }
    }
  }
  return candidates;
}

/** The upstream sees only allowlisted numbers and candidate IDs, never local entity IDs or hashes. */
export function ownerProviderInput(raw) {
  const snapshot = validateOwnerSnapshot(raw);
  const { facts } = snapshot;
  return {
    tick: snapshot.tick, rulesVersion: snapshot.rulesVersion, moneyUnit: 'satang',
    budgetKnown: snapshot.budgetKnown, missing: [...snapshot.missing],
    facts: Object.fromEntries(FACT_KEYS.map(key => [key, facts[key]])),
    candidates: ownerDecisionCandidates(snapshot),
  };
}

export function validateOwnerDecisionSelection(value, snapshot) {
  if (!exact(value, ['candidateId']) || typeof value.candidateId !== 'string') fail();
  const candidates = ownerDecisionCandidates(snapshot);
  if (!candidates.some(candidate => candidate.id === value.candidateId)) fail();
  return { candidateId: value.candidateId };
}

export function buildOwnerDecisionResponse(raw, selection, mode = 'fallback') {
  const request = validateOwnerDecisionRequest(raw);
  if (!['ai', 'fallback'].includes(mode)) fail();
  return { schemaVersion: 3, operation: 'owner-decision', mode, snapshot: request.snapshot, selection: validateOwnerDecisionSelection(selection, request.snapshot) };
}

export function acceptOwnerDecision(value, request) {
  try {
    const local = validateOwnerDecisionRequest(request);
    if (!exact(value, ['schemaVersion', 'operation', 'mode', 'snapshot', 'selection']) || value.schemaVersion !== 3 || value.operation !== 'owner-decision' || !['ai', 'fallback'].includes(value.mode)) return null;
    const echoed = validateOwnerSnapshot(value.snapshot);
    if (canonical(echoed) !== canonical(local.snapshot)) return null;
    return buildOwnerDecisionResponse(local, value.selection, value.mode);
  } catch { return null; }
}
