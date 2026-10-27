/** Local, replayable market-owner decisions. No provider, renderer, storage or save-v6 changes. */
import { deserialize, isMarket, MONTH, serialize, step, type City } from './sim.ts';
import { captureOwnerSnapshot, executeOwnerProposal, OWNER_POLICY_VERSION, ownerStateHash, proposeOwnerDecision, validateOwnerProposal, type OwnerExecutionOutcome, type OwnerProposal } from './owner-decision.ts';

export type OwnerDecisionMode = 'off' | 'proposal' | 'auto' | 'typhoon-auto';
export type OwnerDecisionStats = {
  evaluated: number; applied: number; held: number; rejected: number;
  contributedSatang: number; withdrawnSatang: number; monthlyEvaluations: number;
  retiredEvents: number; checkpointRotations: number;
};
export type OwnerSessionStats = OwnerDecisionStats & {
  activeEvents: number; coverageStartTick: number; checkpointTick: number; pendingTicks: number; recording: boolean; issue: string | null;
};
type EventBase = { sequence: number; tick: number; beforeHash: string; afterHash: string };
export type OwnerJournalEvent = EventBase & (
  | { kind: 'step'; fromTick: number }
  | { kind: 'mode'; mode: OwnerDecisionMode }
  | { kind: 'cycle'; mode: OwnerDecisionMode }
  | { kind: 'evaluation'; trigger: 'monthly' | 'manual' | 'typhoon'; proposal: OwnerProposal }
  | { kind: 'command'; source: 'monthly-auto' | 'manual' | 'typhoon-auto' | 'typhoon-fallback-auto'; proposal: OwnerProposal; outcome: OwnerExecutionOutcome }
  | { kind: 'rejection'; proposalId: string | null; code: 'unknown-proposal' | 'mode-off'; outcome: OwnerExecutionOutcome }
);
type EventInput<T = OwnerJournalEvent> = T extends OwnerJournalEvent ? Omit<T, 'sequence'> : never;
type Checkpoint = {
  sequence: number; tick: number; state: string; stateHash: string; mode: OwnerDecisionMode;
  lastMonthlyTick: number; processedIds: string[]; stats: OwnerDecisionStats; reason: string;
};
type RetiredCoverage = { fromTick: number; toTick: number; fromSequence: number; toSequence: number; eventCount: number; finalHash: string; reason: string };
export type OwnerJournal = {
  schemaVersion: 1; policyVersion: typeof OWNER_POLICY_VERSION; rulesVersion: 'chain-4';
  retention: { maxEvents: number; maxBytes: number; maxRetiredSummaries: 8 };
  checkpoint: Checkpoint; events: OwnerJournalEvent[]; retired: RetiredCoverage[];
  stats: OwnerDecisionStats; mode: OwnerDecisionMode; finalTick: number; finalHash: string; journalHash: string;
};
export type OwnerReplayResult = { ok: boolean; city: City | null; code: string; message: string; events: number; coverageStartTick: number };

const MAX_JOURNAL_BYTES = 32 * 1024 * 1024;
const MAX_EVENT_BYTES = 64 * 1024;
const modes = ['off', 'proposal', 'auto', 'typhoon-auto'];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const emptyStats = (): OwnerDecisionStats => ({ evaluated: 0, applied: 0, held: 0, rejected: 0, contributedSatang: 0, withdrawnSatang: 0, monthlyEvaluations: 0, retiredEvents: 0, checkpointRotations: 0 });
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const exact = (value: unknown, fields: string[]) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key));
// A comparison checksum, not authentication. Replay also re-executes/validates every retained command.
function digest(text: string): string {
  let a = 2166136261, b = 5381;
  for (let n = 0; n < text.length; n++) { const v = text.charCodeAt(n); a = Math.imul(a ^ v, 16777619); b = Math.imul(b, 33) ^ v; }
  return `owner-journal:${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
function countOutcome(stats: OwnerDecisionStats, outcome: OwnerExecutionOutcome) {
  stats[outcome.status]++;
  if (outcome.status === 'applied' && outcome.command?.type === 'contributeOwnerCapital') stats.contributedSatang += outcome.command.amountSatang;
  if (outcome.status === 'applied' && outcome.command?.type === 'withdrawOwnerProfit') stats.withdrawnSatang += outcome.command.amountSatang;
}
function rejected(city: City, code: string, proposal: OwnerProposal | null = null, id: string | null = null): OwnerExecutionOutcome {
  let hash = 'unavailable';
  try { hash = ownerStateHash(city); } catch { /* Fail closed even when a checkpoint cannot be serialized. */ }
  return { ok: false, status: 'rejected', code, message: code === 'duplicate-proposal' ? 'ข้อเสนอนี้ดำเนินการไปแล้ว' : code === 'mode-off' ? 'ปิดระบบข้อเสนอเจ้าของตลาดอยู่' : 'ไม่พบข้อเสนอในรอบปัจจุบัน',
    proposalId: proposal?.proposalId ?? id, actorId: proposal?.snapshot.actorId ?? null, firmId: proposal?.snapshot.firmId ?? null,
    command: proposal ? { ...proposal.command } : null, beforeHash: hash, afterHash: hash };
}

/** A session deliberately never restores auto mode from a save or journal. */
export class OwnerDecisionSession {
  private city: City;
  private selectedMode: OwnerDecisionMode = 'proposal';
  private maxEvents: number;
  private checkpoint: Checkpoint | null = null;
  private events: OwnerJournalEvent[] = [];
  private retired: RetiredCoverage[] = [];
  private stats = emptyStats();
  private pending = new Map<number, OwnerProposal>();
  private proposalSources = new Map<number, 'rules' | 'typhoon'>();
  private processed = new Set<string>();
  private nextSequence = 1;
  private expectedHash = '';
  private expectedTick = 0;
  private monthlyTick = 0;
  private activeBytes = 0;
  private issue: string | null = null;
  private boundaryState = '';
  private pendingTicks: { fromTick: number; toTick: number; beforeHash: string } | null = null;
  private tickStart: { city: City; tick: number; hash: string } | null = null;

  constructor(city: City, options: { maxEvents?: number } = {}) {
    this.city = city;
    const limit = options.maxEvents ?? 256;
    if (!Number.isSafeInteger(limit) || limit < 4 || limit > 256) throw new Error('Invalid owner journal retention.');
    this.maxEvents = limit;
    this.reset(city);
  }
  get mode(): OwnerDecisionMode { return this.selectedMode; }
  getProposals(): OwnerProposal[] { return [...this.pending.values()].sort((a, b) => a.snapshot.firmId - b.snapshot.firmId).map(clone); }
  getProposalSource(proposalId: string): 'rules' | 'typhoon' | null { const proposal = [...this.pending.values()].find(p => p.proposalId === proposalId); return proposal ? this.proposalSources.get(proposal.snapshot.firmId) ?? 'rules' : null; }
  getStats(): OwnerSessionStats { return { ...this.stats, activeEvents: this.events.length, coverageStartTick: this.checkpoint?.tick ?? this.expectedTick, checkpointTick: this.checkpoint?.tick ?? this.expectedTick, pendingTicks: this.pendingTicks ? this.pendingTicks.toTick - this.pendingTicks.fromTick : 0, recording: this.issue === null, issue: this.issue }; }

  private fail(code: string) { this.issue = code; this.selectedMode = 'proposal'; this.tickStart = null; }
  private anchor(city: City, reason: string, retire: boolean) {
    const state = serialize(city), hash = ownerStateHash(city);
    const nextStats = { ...this.stats };
    const summaries = [...this.retired];
    if (retire) {
      if (this.events.length && this.checkpoint) summaries.push({ fromTick: this.checkpoint.tick, toTick: this.expectedTick, fromSequence: this.checkpoint.sequence + 1, toSequence: this.nextSequence - 1, eventCount: this.events.length, finalHash: this.expectedHash, reason });
      nextStats.retiredEvents += this.events.length; nextStats.checkpointRotations++;
    }
    const checkpoint: Checkpoint = { sequence: this.nextSequence - 1, tick: city.tick, state, stateHash: hash, mode: this.selectedMode, lastMonthlyTick: this.monthlyTick, processedIds: [...this.processed].sort(), stats: { ...nextStats }, reason: reason.slice(0, 64) };
    const size = bytes(checkpoint);
    if (size + MAX_EVENT_BYTES + 32768 > MAX_JOURNAL_BYTES || checkpoint.processedIds.length > 4096) throw new Error('Owner checkpoint capacity unavailable.');
    this.checkpoint = checkpoint; this.events = []; this.stats = nextStats; this.retired = summaries.slice(-8);
    this.expectedHash = hash; this.expectedTick = city.tick; this.activeBytes = size; this.tickStart = null;
    this.boundaryState = state; this.pendingTicks = null;
  }
  private reserve(city: City, count = 1): boolean {
    if (this.issue) return false;
    try {
      if (this.events.length + count > this.maxEvents || this.activeBytes + count * MAX_EVENT_BYTES + 32768 > MAX_JOURNAL_BYTES) this.anchor(city, 'event-retention', true);
      return true;
    } catch { this.fail('journal-capacity-unavailable'); return false; }
  }
  private append(event: EventInput) {
    const complete = { ...event, sequence: this.nextSequence++ } as OwnerJournalEvent;
    const size = bytes(complete);
    if (size > MAX_EVENT_BYTES) throw new Error('Owner event exceeds retention capacity.');
    this.events.push(complete); this.activeBytes += size;
    this.expectedHash = complete.afterHash; this.expectedTick = complete.tick;
  }
  private prepare(city: City, reason = 'external-change'): boolean {
    if (city !== this.city) { this.reset(city); return this.issue === null; }
    if (this.issue) return false;
    try {
      if (this.pendingTicks && !this.sealTicks(city)) return false;
      const current = ownerStateHash(city);
      if (current !== this.expectedHash || city.tick !== this.expectedTick) {
        this.fail('unnotified-state-change'); return false;
      }
      return true;
    } catch { this.fail('state-unavailable'); return false; }
  }
  /** Seal a bounded owned tick range by replaying it before any owner action. */
  private sealTicks(city: City): boolean {
    const range = this.pendingTicks;
    if (!range) return true;
    try {
      if (city.tick !== range.toTick || range.toTick <= range.fromTick || range.toTick - range.fromTick > MONTH) throw new Error();
      const shadow = deserialize(this.boundaryState);
      if (shadow.tick !== range.fromTick || ownerStateHash(shadow) !== range.beforeHash) throw new Error();
      while (shadow.tick < range.toTick) step(shadow);
      const actual = serialize(city);
      if (serialize(shadow) !== actual) { this.fail('unnotified-state-change'); return false; }
      const hash = ownerStateHash(city);
      if (this.events.length + 1 > this.maxEvents || this.activeBytes + MAX_EVENT_BYTES + 32768 > MAX_JOURNAL_BYTES) {
        this.anchor(city, 'event-retention', true); return true;
      }
      this.append({ kind: 'step', fromTick: range.fromTick, tick: range.toTick, beforeHash: range.beforeHash, afterHash: hash });
      this.boundaryState = actual; this.pendingTicks = null;
      return true;
    } catch { this.fail('tick-replay-unavailable'); return false; }
  }
  reset(city: City): void {
    this.city = city; this.selectedMode = 'proposal'; this.events = []; this.retired = []; this.stats = emptyStats();
    this.pending.clear(); this.proposalSources.clear(); this.processed.clear(); this.nextSequence = 1; this.issue = null; this.checkpoint = null;
    this.expectedTick = city.tick; this.expectedHash = 'unavailable'; this.pendingTicks = null; this.boundaryState = '';
    this.monthlyTick = Math.floor(city.tick / MONTH) * MONTH;
    try { this.anchor(city, 'new-or-loaded-city', false); } catch { this.fail('checkpoint-unavailable'); }
  }
  beforeExternal(city: City): void { this.prepare(city, 'before-player-command'); }
  syncExternal(city: City, reason = 'player-command'): void {
    if (city !== this.city) { this.reset(city); return; }
    try {
      const hash = ownerStateHash(city);
      if (!this.pendingTicks && !this.issue && hash === this.expectedHash && city.tick === this.expectedTick) return;
      if (this.issue) this.selectedMode = 'proposal';
      this.issue = null; this.pending.clear(); this.proposalSources.clear(); this.processed.clear(); this.monthlyTick = Math.floor(city.tick / MONTH) * MONTH;
      this.anchor(city, reason, true);
    } catch { this.fail('checkpoint-unavailable'); }
  }
  setMode(mode: OwnerDecisionMode): void {
    if (!modes.includes(mode)) throw new Error('Invalid owner decision mode.');
    if (!this.prepare(this.city) || !this.reserve(this.city)) return;
    if (mode === this.selectedMode) return;
    this.selectedMode = mode;
    this.append({ kind: 'mode', mode, tick: this.city.tick, beforeHash: this.expectedHash, afterHash: this.expectedHash });
  }
  /** Call before step and afterTick synchronously, or prefer advance(). */
  beforeTick(city: City): boolean {
    if (city !== this.city) this.reset(city);
    if (this.issue) { this.tickStart = null; return false; }
    const lastTick = this.pendingTicks?.toTick ?? this.expectedTick;
    if (city.tick !== lastTick) { this.selectedMode = 'proposal'; this.syncExternal(city, 'unpaired-before-tick'); }
    if (this.issue) return false;
    this.tickStart = { city, tick: city.tick, hash: this.expectedHash }; return true;
  }
  afterTick(city: City): OwnerExecutionOutcome[] {
    const before = this.tickStart; this.tickStart = null;
    if (this.issue) return [];
    if (!before || before.city !== city || city.tick !== before.tick + 1) { this.selectedMode = 'proposal'; this.syncExternal(city, 'unpaired-tick-checkpoint'); return []; }
    try {
      this.processed.clear();
      if (this.pendingTicks) this.pendingTicks.toTick = city.tick;
      else this.pendingTicks = { fromTick: before.tick, toTick: city.tick, beforeHash: before.hash };
      if (city.tick <= 0 || city.tick % MONTH || this.monthlyTick >= city.tick) return [];
      if (!this.sealTicks(city)) return [];
      if (!this.reserve(city)) return [];
      this.monthlyTick = city.tick;
      if (this.selectedMode !== 'off') this.stats.monthlyEvaluations++;
      this.append({ kind: 'cycle', mode: this.selectedMode, tick: city.tick, beforeHash: this.expectedHash, afterHash: this.expectedHash });
      if (this.selectedMode === 'off') return [];
      if (this.selectedMode === 'typhoon-auto') return [];
      const outcomes: OwnerExecutionOutcome[] = [];
      for (const firm of [...city.firms].filter(isMarket).sort((a, b) => a.id - b.id)) {
        const proposals = this.evaluateInternal(city, firm.id, 'monthly');
        if (this.selectedMode === 'auto' && proposals.length) outcomes.push(this.applyInternal(city, proposals[0].proposalId, 'monthly-auto'));
      }
      return outcomes;
    } catch { this.fail('journal-recording-failed'); return []; }
  }
  advance(city: City): OwnerExecutionOutcome[] {
    this.beforeTick(city);
    step(city);
    return this.afterTick(city);
  }
  private evaluateInternal(city: City, firmId: number, trigger: 'monthly' | 'manual'): OwnerProposal[] {
    if (!this.reserve(city, this.selectedMode === 'auto' ? 2 : 1)) return [];
    const snapshot = captureOwnerSnapshot(city, firmId);
    if (!snapshot) { this.pending.delete(firmId); this.proposalSources.delete(firmId); return []; }
    const proposal = proposeOwnerDecision(snapshot);
    if (bytes(proposal) + 8192 > MAX_EVENT_BYTES) { this.fail('proposal-recording-capacity'); return []; }
    this.pending.set(firmId, clone(proposal)); this.proposalSources.set(firmId, 'rules'); this.stats.evaluated++;
    this.append({ kind: 'evaluation', trigger, proposal: clone(proposal), tick: city.tick, beforeHash: this.expectedHash, afterHash: this.expectedHash });
    return [clone(proposal)];
  }
  /** Record a manually requested Typhoon choice or a choice made in explicit Typhoon-auto mode. */
  registerTyphoonProposal(city: City, proposal: OwnerProposal): boolean {
    if (!['proposal', 'typhoon-auto'].includes(this.selectedMode) || !this.prepare(city)) return false;
    const valid = validateOwnerProposal(city, proposal);
    if (!valid.ok || !valid.proposal || this.processed.has(valid.proposal.proposalId)) return false;
    if (!this.reserve(city)) return false;
    if (bytes(valid.proposal) + 8192 > MAX_EVENT_BYTES) { this.fail('proposal-recording-capacity'); return false; }
    this.pending.set(valid.proposal.snapshot.firmId, clone(valid.proposal)); this.proposalSources.set(valid.proposal.snapshot.firmId, 'typhoon'); this.stats.evaluated++;
    this.append({ kind: 'evaluation', trigger: 'typhoon', proposal: clone(valid.proposal), tick: city.tick, beforeHash: this.expectedHash, afterHash: this.expectedHash });
    return true;
  }
  evaluate(city: City, firmId?: number): OwnerProposal[] {
    if (!this.prepare(city) || this.selectedMode === 'off') return [];
    const ids = firmId === undefined ? city.firms.filter(isMarket).map(f => f.id).sort((a, b) => a - b) : [firmId];
    return ids.flatMap(id => this.evaluateInternal(city, id, 'manual'));
  }
  /** Evaluate one fresh firm snapshot within the monthly Typhoon-auto boundary. */
  evaluateTyphoonAutoMonthly(city: City, firmId: number): OwnerProposal[] {
    if (this.selectedMode !== 'typhoon-auto' || city.tick % MONTH !== 0 || this.monthlyTick !== city.tick || !this.prepare(city)) return [];
    return this.evaluateInternal(city, firmId, 'monthly');
  }
  private applyInternal(city: City, proposalId: string, source: 'monthly-auto' | 'manual' | 'typhoon-auto' | 'typhoon-fallback-auto'): OwnerExecutionOutcome {
    const proposal = [...this.pending.values()].find(p => p.proposalId === proposalId) ?? null;
    if (!this.reserve(city)) return rejected(city, 'journal-unavailable', proposal);
    if (this.selectedMode === 'off' || !proposal) {
      const code = this.selectedMode === 'off' ? 'mode-off' : 'unknown-proposal';
      const id = typeof proposalId === 'string' && proposalId.length <= 512 ? proposalId : null;
      const outcome = rejected(city, code, null, id); countOutcome(this.stats, outcome);
      this.append({ kind: 'rejection', code, proposalId: id, outcome, tick: city.tick, beforeHash: outcome.beforeHash, afterHash: outcome.afterHash }); return outcome;
    }
    const outcome = this.processed.has(proposal.proposalId) ? rejected(city, 'duplicate-proposal', proposal) : executeOwnerProposal(city, proposal);
    if (outcome.status === 'applied' || outcome.status === 'held') this.processed.add(proposal.proposalId);
    countOutcome(this.stats, outcome);
    this.append({ kind: 'command', source, proposal: clone(proposal), outcome: clone(outcome), tick: city.tick, beforeHash: outcome.beforeHash, afterHash: outcome.afterHash });
    this.boundaryState = serialize(city);
    return clone(outcome);
  }
  apply(city: City, proposalId: string): OwnerExecutionOutcome {
    if (!this.prepare(city)) return rejected(city, 'journal-unavailable');
    return this.applyInternal(city, proposalId, 'manual');
  }
  applyTyphoonAuto(city: City, proposalId: string, source: 'typhoon-auto' | 'typhoon-fallback-auto'): OwnerExecutionOutcome {
    if (this.selectedMode !== 'typhoon-auto' || city.tick % MONTH !== 0 || this.monthlyTick !== city.tick || !this.prepare(city)) return rejected(city, 'journal-unavailable');
    const proposal = [...this.pending.values()].find(item => item.proposalId === proposalId);
    const expectedSource = source === 'typhoon-auto' ? 'typhoon' : 'rules';
    if (!proposal || proposal.snapshot.tick !== city.tick || this.proposalSources.get(proposal.snapshot.firmId) !== expectedSource || !this.processed.has(proposalId) && !validateOwnerProposal(city, proposal).ok) return rejected(city, 'stale-snapshot', proposal ?? null);
    return this.applyInternal(city, proposalId, source);
  }
  exportJournal(): OwnerJournal {
    if (!this.prepare(this.city, 'export-boundary') || !this.checkpoint) throw new Error('Owner journal checkpoint unavailable.');
    const body = { schemaVersion: 1 as const, policyVersion: OWNER_POLICY_VERSION, rulesVersion: 'chain-4' as const,
      retention: { maxEvents: this.maxEvents, maxBytes: MAX_JOURNAL_BYTES, maxRetiredSummaries: 8 as const }, checkpoint: this.checkpoint,
      events: this.events, retired: this.retired, stats: this.stats, mode: this.selectedMode, finalTick: this.expectedTick, finalHash: this.expectedHash };
    if (bytes(body) > MAX_JOURNAL_BYTES) throw new Error('Owner journal capacity exceeded.');
    return clone({ ...body, journalHash: digest(JSON.stringify(body)) });
  }
}

export const createOwnerDecisionSession = (city: City, options: { maxEvents?: number } = {}) => new OwnerDecisionSession(city, options);

/** Replays only the retained, explicitly covered window. It never calls a model or mutates a caller's city. */
export function replayOwnerJournal(input: unknown): OwnerReplayResult {
  let count = 0, start = 0;
  try {
    if (!exact(input, ['schemaVersion', 'policyVersion', 'rulesVersion', 'retention', 'checkpoint', 'events', 'retired', 'stats', 'mode', 'finalTick', 'finalHash', 'journalHash']) || bytes(input) > MAX_JOURNAL_BYTES) throw new Error();
    const journal = clone(input) as OwnerJournal;
    const { journalHash, ...body } = journal;
    if (journal.schemaVersion !== 1 || journal.policyVersion !== OWNER_POLICY_VERSION || journal.rulesVersion !== 'chain-4' || journalHash !== digest(JSON.stringify(body))) throw new Error();
    if (!exact(journal.retention, ['maxEvents', 'maxBytes', 'maxRetiredSummaries']) || !integer(journal.retention.maxEvents) || journal.retention.maxEvents < 4 || journal.retention.maxEvents > 256 || journal.retention.maxBytes !== MAX_JOURNAL_BYTES || journal.retention.maxRetiredSummaries !== 8) throw new Error();
    const cp = journal.checkpoint;
    if (!exact(cp, ['sequence', 'tick', 'state', 'stateHash', 'mode', 'lastMonthlyTick', 'processedIds', 'stats', 'reason']) || !integer(cp.sequence) || !integer(cp.tick) || !integer(cp.lastMonthlyTick) || cp.lastMonthlyTick > cp.tick || !modes.includes(cp.mode) || typeof cp.reason !== 'string' || cp.reason.length > 64 || typeof cp.state !== 'string' || cp.state.length > 12_000_000 || !Array.isArray(cp.processedIds) || cp.processedIds.length > 4096 || cp.processedIds.some(id => typeof id !== 'string' || id.length > 512) || new Set(cp.processedIds).size !== cp.processedIds.length) throw new Error();
    if (!exact(cp.stats, Object.keys(emptyStats())) || Object.values(cp.stats).some(value => !integer(value))) throw new Error();
    if (!Array.isArray(journal.events) || journal.events.length > journal.retention.maxEvents || !Array.isArray(journal.retired) || journal.retired.length > 8) throw new Error();
    for (const r of journal.retired) if (!exact(r, ['fromTick', 'toTick', 'fromSequence', 'toSequence', 'eventCount', 'finalHash', 'reason']) || !integer(r.fromTick) || !integer(r.toTick) || r.toTick < r.fromTick || !integer(r.fromSequence) || !integer(r.toSequence) || !integer(r.eventCount) || typeof r.finalHash !== 'string' || typeof r.reason !== 'string') throw new Error();
    const city = deserialize(cp.state); start = cp.tick;
    if (city.tick !== cp.tick || ownerStateHash(city) !== cp.stateHash) throw new Error();
    let expected = cp.stateHash, sequence = cp.sequence, mode = cp.mode, monthlyTick = cp.lastMonthlyTick;
    const stats = { ...cp.stats }, processed = new Set(cp.processedIds);
    const monthlyEvaluated = new Set<string>(), typhoonEvaluated = new Set<string>();
    const common = ['sequence', 'tick', 'beforeHash', 'afterHash', 'kind'];
    for (const event of journal.events) {
      if (!integer(event.sequence) || event.sequence !== ++sequence || !integer(event.tick) || event.beforeHash !== expected || ownerStateHash(city) !== expected || bytes(event) > MAX_EVENT_BYTES) throw new Error();
      if (event.kind === 'step') {
        if (!exact(event, [...common, 'fromTick']) || event.fromTick !== city.tick || event.tick <= city.tick || event.tick - city.tick > MONTH) throw new Error();
        while (city.tick < event.tick) step(city); processed.clear();
      } else if (event.kind === 'mode') {
        if (!exact(event, [...common, 'mode']) || event.tick !== city.tick || !modes.includes(event.mode)) throw new Error(); mode = event.mode;
      } else if (event.kind === 'cycle') {
        if (!exact(event, [...common, 'mode']) || event.tick !== city.tick || !event.tick || event.tick % MONTH || event.tick <= monthlyTick || event.mode !== mode) throw new Error();
        monthlyTick = event.tick; monthlyEvaluated.clear(); typhoonEvaluated.clear(); if (mode !== 'off') stats.monthlyEvaluations++;
      } else if (event.kind === 'evaluation') {
        if (!exact(event, [...common, 'trigger', 'proposal']) || event.tick !== city.tick || mode === 'off' || !['monthly', 'manual', 'typhoon'].includes(event.trigger) || event.trigger === 'monthly' && monthlyTick !== event.tick || event.trigger === 'typhoon' && !(mode === 'proposal' || mode === 'typhoon-auto' && monthlyTick === event.tick)) throw new Error();
        if (event.trigger === 'typhoon') {
          const validation = validateOwnerProposal(city, event.proposal);
          if (!validation.ok || !validation.proposal) throw new Error();
        } else {
          const snapshot = captureOwnerSnapshot(city, event.proposal?.snapshot?.firmId);
          if (!snapshot || JSON.stringify(proposeOwnerDecision(snapshot)) !== JSON.stringify(event.proposal)) throw new Error();
        }
        if (event.trigger === 'monthly') monthlyEvaluated.add(event.proposal.proposalId);
        if (event.trigger === 'typhoon') typhoonEvaluated.add(event.proposal.proposalId);
        stats.evaluated++;
      } else if (event.kind === 'command') {
        if (!exact(event, [...common, 'source', 'proposal', 'outcome']) || event.tick !== city.tick || mode === 'off' || !['monthly-auto', 'manual', 'typhoon-auto', 'typhoon-fallback-auto'].includes(event.source) || event.source === 'monthly-auto' && (mode !== 'auto' || monthlyTick !== event.tick) || event.source === 'typhoon-auto' && (mode !== 'typhoon-auto' || monthlyTick !== event.tick || !typhoonEvaluated.has(event.proposal?.proposalId)) || event.source === 'typhoon-fallback-auto' && (mode !== 'typhoon-auto' || monthlyTick !== event.tick || !monthlyEvaluated.has(event.proposal?.proposalId))) throw new Error();
        const result = processed.has(event.proposal?.proposalId) ? rejected(city, 'duplicate-proposal', event.proposal) : executeOwnerProposal(city, event.proposal);
        if (JSON.stringify(result) !== JSON.stringify(event.outcome)) throw new Error();
        if (result.status === 'applied' || result.status === 'held') processed.add(event.proposal.proposalId); countOutcome(stats, result);
      } else if (event.kind === 'rejection') {
        if (!exact(event, [...common, 'proposalId', 'code', 'outcome']) || event.tick !== city.tick || !['unknown-proposal', 'mode-off'].includes(event.code) || event.code === 'mode-off' && mode !== 'off' || event.proposalId !== null && (typeof event.proposalId !== 'string' || event.proposalId.length > 512)) throw new Error();
        const result = rejected(city, event.code, null, event.proposalId);
        if (JSON.stringify(result) !== JSON.stringify(event.outcome)) throw new Error(); countOutcome(stats, result);
      } else throw new Error();
      expected = ownerStateHash(city); if (expected !== event.afterHash) throw new Error(); count++;
    }
    if (city.tick !== journal.finalTick || expected !== journal.finalHash || mode !== journal.mode || JSON.stringify(stats) !== JSON.stringify(journal.stats)) throw new Error();
    return { ok: true, city, code: 'verified', message: 'ตรวจ replay ในช่วง checkpoint ที่เก็บไว้ตรงกับสถานะปลายทาง', events: count, coverageStartTick: start };
  } catch { return { ok: false, city: null, code: 'invalid-journal', message: 'ตรวจ replay ไม่ผ่าน ไฟล์อาจไม่ครบหรือข้อมูลเปลี่ยน ระบบไม่ได้เปลี่ยนเมืองปัจจุบัน', events: count, coverageStartTick: start }; }
}
