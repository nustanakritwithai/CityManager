/** Local rule proposals only. These are game actors, not authenticated website users. */
import { access, contributeOwnerCapital, firmRent, firmWage, isMarket, MONTH, ownerFinance, serialize, withdrawOwnerProfit, type City } from './sim.ts';
import { ownerDecisionCandidates, validateOwnerDecisionSelection, type OwnerCandidateId } from '../server/city-advisor/src/owner-contract.mjs';

export const OWNER_POLICY_VERSION = 'owner-rule-1' as const;
export const OWNER_MAX_TRANSFER = 10_000;
// Current growth-1 consumes one 800-satang basket per HOUSEHOLD per day, not per person.
// This is an explicit next-month policy reserve, not a claimed past expense or balance sheet.
const FOOD_PER_HOUSEHOLD_DAY = 800;
const HOUSEHOLD_MONTHLY_RENT = 10_000;
const FACT_KEYS = ['householdCash', 'householdFoodReserve', 'householdRentReserve', 'householdEssentialReserve', 'householdSurplus', 'firmCash', 'earnedPayrollReserve', 'firmTaxReserve', 'firmRentReserve', 'firmWorkingReserve', 'firmTotalReserve', 'firmCashShortfall', 'contributeAvailable', 'withdrawAvailable', 'distributableProfit', 'safeContribute', 'safeWithdraw'] as const;
export type OwnerFactKey = typeof FACT_KEYS[number];
export type OwnerFacts = Record<OwnerFactKey, number | null>;
const MISSING = ['unsupported-rules', 'home-unavailable', 'access-unavailable', 'invalid-household-budget', 'invalid-firm-budget', 'invalid-owner-finance', 'budget-overflow'] as const;
export type OwnerMissing = typeof MISSING[number];
export type OwnerCommand = { type: 'hold' | 'contributeOwnerCapital' | 'withdrawOwnerProfit'; amountSatang: number };
export type OwnerReason = 'budget-unavailable' | 'firm-shortfall' | 'realized-profit' | 'reserves-protected';
export type OwnerSnapshot = {
  schemaVersion: 1; policyVersion: typeof OWNER_POLICY_VERSION; rulesVersion: string; tick: number;
  actorId: number; firmId: number; buildingId: number; homeId: number | null;
  moneyUnit: 'satang'; horizonDays: 30; stateHash: string; snapshotHash: string;
  budgetKnown: boolean; missing: OwnerMissing[]; facts: OwnerFacts;
};
export type OwnerProposal = {
  schemaVersion: 1; policyVersion: typeof OWNER_POLICY_VERSION; proposalId: string;
  snapshot: OwnerSnapshot; command: OwnerCommand; reason: OwnerReason; evidenceIds: OwnerFactKey[];
};
export type OwnerValidation = { ok: boolean; code: string; message: string; proposal?: OwnerProposal };
export type OwnerExecutionOutcome = {
  ok: boolean; status: 'applied' | 'held' | 'rejected'; code: string; message: string;
  proposalId: string | null; actorId: number | null; firmId: number | null; command: OwnerCommand | null;
  beforeHash: string; afterHash: string;
};

export const OWNER_REASON_TEXT: Record<OwnerReason, string> = {
  'budget-unavailable': 'ยังคำนวณงบที่ต้องกันไว้ไม่ได้ จึงคงเดิม',
  'firm-shortfall': 'เติมเฉพาะเงินขาดจากทุนหมุนเวียน โดยไม่ใช้เงินจำเป็นของครัวเรือน',
  'realized-profit': 'ถอนเฉพาะกำไรที่ถอนออกได้ หลังกันภาระและเงินหมุนเวียนแล้ว',
  'reserves-protected': 'ยังไม่มีเงินเหลือที่ผ่านเงื่อนไขเติมทุนหรือถอนกำไร จึงคงเดิม',
};
export const OWNER_FACT_LABELS: Record<OwnerFactKey, string> = {
  householdCash: 'เงินครัวเรือนปัจจุบัน', householdFoodReserve: 'งบอาหารครัวเรือนที่กันไว้ 30 วัน',
  householdRentReserve: 'ค่าเช่าบ้านที่กันไว้หนึ่งเดือน', householdEssentialReserve: 'งบจำเป็นครัวเรือนที่กันไว้รวม',
  householdSurplus: 'เงินครัวเรือนเหนือเงินกันไว้', firmCash: 'เงินตลาดปัจจุบัน',
  earnedPayrollReserve: 'ค่าจ้างที่เกิดขึ้นแล้วและต้องกันไว้', firmTaxReserve: 'ภาษีตลาดที่กันไว้',
  firmRentReserve: 'ค่าเช่าตลาดที่กันไว้หนึ่งเดือน', firmWorkingReserve: 'เงินหมุนเวียนตลาดขั้นต่ำ',
  firmTotalReserve: 'ภาระและเงินหมุนเวียนตลาดที่กันไว้รวม', firmCashShortfall: 'เงินที่ตลาดขาดจากเงินกันไว้',
  contributeAvailable: 'เพดานเติมทุนของคำสั่งเดิม', withdrawAvailable: 'เพดานถอนกำไรของคำสั่งเดิม',
  distributableProfit: 'กำไรที่ผ่านเกณฑ์แจกจ่ายของคำสั่งเดิม', safeContribute: 'จำนวนเติมทุนที่ผ่านกฎรอบนี้',
  safeWithdraw: 'จำนวนถอนกำไรที่ผ่านกฎรอบนี้',
};

const money = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const id = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: readonly string[]) => record(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (record(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
};
/** Deterministic comparison fingerprint, deliberately not authentication or cryptography. */
function fingerprint(text: string): string {
  let a = 2166136261, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) { const n = text.charCodeAt(i); a = Math.imul(a ^ n, 16777619); b = Math.imul(b ^ n, 2246822519); }
  return text.length.toString(36) + '-' + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export function ownerStateHash(city: City): string { return 'state-1-' + fingerprint(serialize(city)); }
const snapshotHash = (snapshot: Omit<OwnerSnapshot, 'snapshotHash'>) => 'owner-snapshot-1-' + fingerprint(canonical(snapshot));
const proposalHash = (proposal: Omit<OwnerProposal, 'proposalId'>) => 'owner-proposal-1-' + fingerprint(canonical(proposal));
const emptyFacts = (): OwnerFacts => Object.fromEntries(FACT_KEYS.map(k => [k, null])) as OwnerFacts;

/** Copies only a real household-owned market and computes reserves from current prototype rules. */
export function captureOwnerSnapshot(city: City, firmId: number): OwnerSnapshot | null {
  try {
    const firm = city.firms.find(f => f.id === firmId);
    const household = firm?.owner && city.households.find(h => h.id === firm.owner!.householdId);
    const building = firm && city.buildings.find(b => b.id === firm.building);
    if (!firm || !isMarket(firm) || !firm.owner || !household || !building || building.zone !== 'C' || building.level !== 1 || firm.fundedBy !== undefined || !id(firm.id) || !id(household.id) || !id(building.id) || firm.wallet !== 'firm:' + firm.id || household.wallet !== 'household:' + household.id || !money(city.tick)) return null;
    const facts = emptyFacts(), missing: OwnerMissing[] = [];
    const mark = (code: OwnerMissing) => { if (!missing.includes(code)) missing.push(code); };
    const home = household.home === null ? undefined : city.buildings.find(b => b.id === household.home && b.zone === 'R');
    if (city.version !== 7 || city.rulesVersion !== 'chain-2') mark('unsupported-rules');
    if (!home) mark('home-unavailable');
    if (!city.utilities.power || !city.utilities.water || !home || !access(city, home.cell) || !access(city, building.cell)) mark('access-unavailable');
    if (Object.hasOwn(city.accounts, household.wallet) && money(city.accounts[household.wallet])) facts.householdCash = city.accounts[household.wallet];
    else mark('invalid-household-budget');
    if (Object.hasOwn(city.accounts, firm.wallet) && money(city.accounts[firm.wallet])) facts.firmCash = city.accounts[firm.wallet];
    else mark('invalid-firm-budget');
    if (!missing.includes('unsupported-rules')) {
      facts.householdFoodReserve = MONTH * FOOD_PER_HOUSEHOLD_DAY;
      if (home) {
        facts.householdRentReserve = HOUSEHOLD_MONTHLY_RENT;
        facts.householdEssentialReserve = facts.householdFoodReserve + facts.householdRentReserve;
        if (facts.householdCash !== null) facts.householdSurplus = Math.max(0, facts.householdCash - facts.householdEssentialReserve);
      }
      if (!money(firm.monthlyRevenue) || !money(firm.monthlyExpense) || !Number.isSafeInteger(firm.profit) || ![firm.owner.capitalContributed, firm.owner.capitalReturned, firm.owner.withdrawn, firm.owner.taxPaid].every(money) || !record(firm.workDays) || !Object.values(firm.workDays).every(money)) {
        mark('invalid-firm-budget');
      } else {
        const payroll = Object.values(firm.workDays).reduce((sum, days) => sum + days * firmWage(firm) / MONTH, 0);
        const finance = ownerFinance(city, firm.id);
        if (!finance || ![finance.taxReserve, finance.workingCashFloor, finance.contributeAvailable, finance.withdrawAvailable, finance.distributable, payroll, firmRent(firm)].every(money)) mark('invalid-owner-finance');
        else {
          facts.earnedPayrollReserve = payroll; facts.firmTaxReserve = finance.taxReserve;
          facts.firmRentReserve = firmRent(firm); facts.firmWorkingReserve = finance.workingCashFloor;
          facts.contributeAvailable = finance.contributeAvailable; facts.withdrawAvailable = finance.withdrawAvailable;
          facts.distributableProfit = finance.distributable;
          const reserved = payroll + finance.taxReserve + firmRent(firm) + finance.workingCashFloor;
          if (!money(reserved)) mark('budget-overflow');
          else {
            facts.firmTotalReserve = reserved;
            if (facts.firmCash !== null) {
              facts.firmCashShortfall = Math.max(0, reserved - facts.firmCash);
              if (facts.householdSurplus !== null) facts.safeContribute = Math.min(OWNER_MAX_TRANSFER, facts.firmCashShortfall, facts.householdSurplus, finance.contributeAvailable);
              facts.safeWithdraw = Math.max(0, Math.min(OWNER_MAX_TRANSFER, finance.withdrawAvailable, facts.firmCash - reserved));
            }
          }
        }
      }
    }
    if (Object.values(facts).some(v => v !== null && !money(v))) mark('budget-overflow');
    const budgetKnown = !missing.length && Object.values(facts).every(v => v !== null && money(v));
    if (!budgetKnown) { facts.safeContribute = null; facts.safeWithdraw = null; }
    const raw: Omit<OwnerSnapshot, 'snapshotHash'> = {
      schemaVersion: 1, policyVersion: OWNER_POLICY_VERSION, rulesVersion: String(city.rulesVersion), tick: city.tick,
      actorId: household.id, firmId: firm.id, buildingId: building.id, homeId: home?.id ?? null,
      moneyUnit: 'satang', horizonDays: 30, stateHash: ownerStateHash(city), budgetKnown, missing, facts,
    };
    return { ...raw, snapshotHash: snapshotHash(raw) };
  } catch { return null; }
}

const references = (command: OwnerCommand['type']): OwnerFactKey[] => command === 'contributeOwnerCapital'
  ? ['householdCash', 'householdEssentialReserve', 'firmCash', 'firmTotalReserve', 'safeContribute']
  : command === 'withdrawOwnerProfit' ? ['distributableProfit', 'firmTotalReserve', 'safeWithdraw'] : [];
function makeProposal(snapshot: OwnerSnapshot, command: OwnerCommand, reason: OwnerReason): OwnerProposal {
  const raw: Omit<OwnerProposal, 'proposalId'> = { schemaVersion: 1, policyVersion: OWNER_POLICY_VERSION, snapshot: structuredClone(snapshot), command: { ...command }, reason, evidenceIds: references(command.type) };
  return { ...raw, proposalId: proposalHash(raw) };
}
export function proposeOwnerDecision(snapshot: OwnerSnapshot): OwnerProposal {
  if (!snapshot.budgetKnown) return makeProposal(snapshot, { type: 'hold', amountSatang: 0 }, 'budget-unavailable');
  if ((snapshot.facts.safeContribute ?? 0) > 0) return makeProposal(snapshot, { type: 'contributeOwnerCapital', amountSatang: snapshot.facts.safeContribute! }, 'firm-shortfall');
  if ((snapshot.facts.safeWithdraw ?? 0) > 0) return makeProposal(snapshot, { type: 'withdrawOwnerProfit', amountSatang: snapshot.facts.safeWithdraw! }, 'realized-profit');
  return makeProposal(snapshot, { type: 'hold', amountSatang: 0 }, 'reserves-protected');
}

/** Convert a provider choice into the same canonical proposal that the game revalidates. */
export function ownerProposalForCandidate(snapshot: OwnerSnapshot, candidateId: OwnerCandidateId): OwnerProposal {
  const selected = validateOwnerDecisionSelection({ candidateId }, snapshot);
  const candidate = ownerDecisionCandidates(snapshot).find(item => item.id === selected.candidateId);
  if (!candidate) throw new Error('Selected owner decision candidate is no longer available.');
  if (candidate.action === 'hold') return makeProposal(snapshot, { type: 'hold', amountSatang: 0 }, snapshot.budgetKnown ? 'reserves-protected' : 'budget-unavailable');
  if (candidate.action !== 'contributeOwnerCapital' && candidate.action !== 'withdrawOwnerProfit') throw new Error('Unsupported owner decision candidate.');
  return makeProposal(snapshot, { type: candidate.action, amountSatang: candidate.amountSatang }, candidate.action === 'contributeOwnerCapital' ? 'firm-shortfall' : 'realized-profit');
}

function validSnapshotShape(v: unknown): v is OwnerSnapshot {
  if (!exact(v, ['schemaVersion', 'policyVersion', 'rulesVersion', 'tick', 'actorId', 'firmId', 'buildingId', 'homeId', 'moneyUnit', 'horizonDays', 'stateHash', 'snapshotHash', 'budgetKnown', 'missing', 'facts']) || !record(v)) return false;
  return v.schemaVersion === 1 && v.policyVersion === OWNER_POLICY_VERSION && typeof v.rulesVersion === 'string' && /^[a-z0-9.-]{1,32}$/.test(v.rulesVersion) && money(v.tick) && id(v.actorId) && id(v.firmId) && id(v.buildingId) && (v.homeId === null || id(v.homeId)) && v.moneyUnit === 'satang' && v.horizonDays === 30 && typeof v.stateHash === 'string' && typeof v.snapshotHash === 'string' && v.stateHash.length < 100 && v.snapshotHash.length < 100 && typeof v.budgetKnown === 'boolean' && Array.isArray(v.missing) && v.missing.length <= MISSING.length && new Set(v.missing).size === v.missing.length && v.missing.every(x => MISSING.includes(x as OwnerMissing)) && exact(v.facts, FACT_KEYS) && record(v.facts) && Object.values(v.facts).every(x => x === null || money(x));
}
const invalid = (code: string, message: string): OwnerValidation => ({ ok: false, code, message });
export function validateOwnerProposal(city: City, input: unknown): OwnerValidation {
  try {
    if (!exact(input, ['schemaVersion', 'policyVersion', 'proposalId', 'snapshot', 'command', 'reason', 'evidenceIds']) || !record(input) || input.schemaVersion !== 1 || input.policyVersion !== OWNER_POLICY_VERSION || typeof input.proposalId !== 'string' || input.proposalId.length >= 100 || !validSnapshotShape(input.snapshot) || !exact(input.command, ['type', 'amountSatang']) || !record(input.command) || !['hold', 'contributeOwnerCapital', 'withdrawOwnerProfit'].includes(String(input.command.type)) || !money(input.command.amountSatang) || typeof input.reason !== 'string' || !Object.hasOwn(OWNER_REASON_TEXT, input.reason) || !Array.isArray(input.evidenceIds)) return invalid('invalid-proposal', 'รูปแบบข้อเสนอไม่ถูกต้อง');
    const proposal = input as unknown as OwnerProposal;
    const current = captureOwnerSnapshot(city, proposal.snapshot.firmId);
    if (!current) return invalid('owner-unavailable', 'ไม่พบเจ้าของตลาดที่ตรงกับข้อเสนอ');
    if (canonical(current) !== canonical(proposal.snapshot)) return invalid('stale-snapshot', 'ข้อมูลเปลี่ยนแล้ว กรุณาประเมินใหม่');
    const raw = { schemaVersion: proposal.schemaVersion, policyVersion: proposal.policyVersion, snapshot: proposal.snapshot, command: proposal.command, reason: proposal.reason, evidenceIds: proposal.evidenceIds };
    if (proposal.proposalId !== proposalHash(raw)) return invalid('invalid-proposal-id', 'รหัสข้อเสนอไม่ตรงกับเนื้อหา');
    if (canonical(proposal.evidenceIds) !== canonical(references(proposal.command.type))) return invalid('invalid-evidence', 'รหัสหลักฐานไม่ตรงกับคำสั่ง');
    const { type, amountSatang } = proposal.command;
    if (type === 'hold') {
      if (amountSatang !== 0 || proposal.reason !== (current.budgetKnown ? 'reserves-protected' : 'budget-unavailable')) return invalid('invalid-hold', 'คำสั่งคงเดิมต้องไม่ย้ายเงิน');
    } else {
      if (!current.budgetKnown) return invalid('budget-unavailable', 'ยังคำนวณงบจำเป็นและภาระกิจการไม่ได้');
      const allowed = type === 'contributeOwnerCapital' ? current.facts.safeContribute : current.facts.safeWithdraw;
      if (amountSatang <= 0 || amountSatang > OWNER_MAX_TRANSFER || allowed === null || amountSatang > allowed || proposal.reason !== (type === 'contributeOwnerCapital' ? 'firm-shortfall' : 'realized-profit')) return invalid('unsafe-amount', 'จำนวนเงินเกินงบที่เหลือหลังเงินกันไว้');
    }
    return { ok: true, code: 'valid', message: 'ข้อเสนอผ่านการตรวจตามข้อมูลปัจจุบัน', proposal: structuredClone(proposal) };
  } catch { return invalid('invalid-proposal', 'ตรวจข้อเสนอไม่ได้ จึงไม่เปลี่ยนสถานะ'); }
}

/** Session/journal must deduplicate proposalId; this pure command boundary has no hidden state. */
export function executeOwnerProposal(city: City, input: unknown): OwnerExecutionOutcome {
  let beforeHash: string;
  try { beforeHash = ownerStateHash(city); } catch { beforeHash = 'unavailable'; }
  const validation = validateOwnerProposal(city, input);
  const proposal = validation.proposal;
  if (!validation.ok || !proposal) return { ok: false, status: 'rejected', code: validation.code, message: validation.message, proposalId: null, actorId: null, firmId: null, command: null, beforeHash, afterHash: beforeHash };
  const base = { proposalId: proposal.proposalId, actorId: proposal.snapshot.actorId, firmId: proposal.snapshot.firmId, command: { ...proposal.command }, beforeHash };
  if (proposal.command.type === 'hold') return { ...base, ok: true, status: 'held', code: 'held', message: OWNER_REASON_TEXT[proposal.reason], afterHash: beforeHash };
  const result = proposal.command.type === 'contributeOwnerCapital'
    ? contributeOwnerCapital(city, proposal.snapshot.firmId, proposal.command.amountSatang)
    : withdrawOwnerProfit(city, proposal.snapshot.firmId, proposal.command.amountSatang);
  return { ...base, ok: result.ok, status: result.ok ? 'applied' : 'rejected', code: result.ok ? 'applied' : 'command-rejected', message: result.message, afterHash: ownerStateHash(city) };
}
