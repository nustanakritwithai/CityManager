import { housingCapacity, householdWorkerCount, type City } from './sim.ts';

/** Wire contract shared with the isolated city-advisor.rules.v1 backend. */
export const METRIC_DEFINITIONS = {
  population: ['people', 'population'], households: ['households', 'population'],
  businesses: ['establishments', 'economy'], employed: ['people', 'economy'],
  unemployed: ['people', 'economy'], treasury: ['currency', 'economy'],
  incomePerTick: ['currency/tick', 'economy'], expensesPerTick: ['currency/tick', 'economy'],
  averageHappiness: ['index_0_100', 'wellbeing'], housingCapacity: ['people', 'population'],
  pollution: ['index_0_100', 'environment'], trafficPressure: ['index_0_100', 'mobility'],
} as const;
export type MetricId = keyof typeof METRIC_DEFINITIONS;
export type MetricUnit = typeof METRIC_DEFINITIONS[MetricId][0];
export type SignalCategory = typeof METRIC_DEFINITIONS[MetricId][1];
export const METRIC_LABELS: Record<MetricId, string> = {
  population: 'ประชากร', households: 'ครัวเรือน', businesses: 'สถานประกอบการ',
  employed: 'แรงงานมีงาน', unemployed: 'แรงงานว่างงาน', treasury: 'เงินคลังเมือง',
  incomePerTick: 'เงินเข้าคลังในวันปัจจุบัน', expensesPerTick: 'เงินออกคลังในวันปัจจุบัน',
  averageHappiness: 'ความสุข (ไม่มีข้อมูล)', housingCapacity: 'ความจุที่อยู่อาศัยเป็นคน',
  pollution: 'มลพิษ (ไม่มีข้อมูล)', trafficPressure: 'ความหนาแน่นจราจร (ไม่มีข้อมูล)',
};
export const UNIT_LABELS: Record<MetricUnit, string> = {
  people: 'คน', households: 'ครัวเรือน', establishments: 'แห่ง', currency: '฿',
  'currency/tick': '฿/วัน', index_0_100: 'ดัชนี 0–100',
};
export type SignalWindow = { startTick: number; endTick: number };
export type SignalMetric = { id: MetricId; value: number; unit: MetricUnit; source: 'citymanager.aggregate.v1' };
export type SignalCapture = { tick: number; metrics: SignalMetric[] };
export type SignalRequest = {
  schemaVersion: 1; locale: 'th' | 'en';
  snapshot: SignalCapture & { window: SignalWindow; prior?: SignalCapture };
};
type SignalBase = {
  id: string; metricRefs: MetricId[]; category: SignalCategory; unit: MetricUnit;
  window: SignalWindow; source: 'city-advisor.rules.v1';
};
export type CitySignal = SignalBase & (
  { kind: 'trend'; direction: 'up' | 'down' | 'flat'; delta: number } |
  { kind: 'threshold'; rule: string; value: number; conditionMet: boolean }
);
export type SignalMissingData = {
  id: string; metricRefs: MetricId[];
  reason: 'current_metric_unavailable' | 'prior_metric_unavailable' | 'threshold_inputs_unavailable';
};
export type SignalGroup = { category: SignalCategory; signalIds: string[] };
export type SignalObservation = { signalRefs: string[]; metricRefs: MetricId[]; emphasized: boolean; text: string };
export type SignalReport = {
  schemaVersion: 1; mode: 'ai' | 'fallback'; snapshotTick: number;
  data: {
    window: SignalWindow;
    provenance: { input: 'citymanager.aggregate.v1'; trust: 'client_reported_unverified'; derivation: 'city-advisor.rules.v1'; comparisonPriorTick: number | null };
    metrics: (SignalMetric & { window: SignalWindow })[];
    priorMetrics: (SignalMetric & { window: SignalWindow })[];
    signals: CitySignal[]; missingData: SignalMissingData[];
  };
  report: { summarySignalIds: string[]; groups: SignalGroup[]; observations: SignalObservation[]; hypotheses: never[]; limitations: string[] };
};
const SOURCE = 'citymanager.aggregate.v1' as const;
const RULES = 'city-advisor.rules.v1' as const;
const CATEGORIES: SignalCategory[] = ['population', 'economy', 'wellbeing', 'environment', 'mobility'];
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function exactKeys(value: unknown, allowed: string[], required = allowed): asserts value is Record<string, unknown> {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw Error('invalid_signal_request');
}
function metricList(value: unknown): SignalMetric[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw Error('invalid_signal_request');
  const seen = new Set<string>();
  return value.map(metric => {
    exactKeys(metric, ['id', 'value', 'unit', 'source']);
    if (typeof metric.id !== 'string' || !Object.hasOwn(METRIC_DEFINITIONS, metric.id) || seen.has(metric.id)) throw Error('invalid_signal_request');
    const id = metric.id as MetricId, unit = METRIC_DEFINITIONS[id][0];
    if (metric.unit !== unit || metric.source !== SOURCE || typeof metric.value !== 'number' || !Number.isFinite(metric.value) || Math.abs(metric.value) > 1e12) throw Error('invalid_signal_request');
    if ((unit === 'index_0_100' && (metric.value < 0 || metric.value > 100)) ||
        (['people', 'households', 'establishments'].includes(unit) && (!Number.isSafeInteger(metric.value) || metric.value < 0))) throw Error('invalid_signal_request');
    seen.add(id);
    return { id, value: metric.value, unit, source: SOURCE };
  });
}
export function validateSignalRequest(body: unknown): SignalRequest {
  exactKeys(body, ['schemaVersion', 'locale', 'snapshot']);
  if (body.schemaVersion !== 1 || (body.locale !== 'th' && body.locale !== 'en')) throw Error('invalid_signal_request');
  const snapshot = body.snapshot;
  exactKeys(snapshot, ['tick', 'window', 'metrics', 'prior'], ['tick', 'window', 'metrics']);
  exactKeys(snapshot.window, ['startTick', 'endTick']);
  const tick = snapshot.tick, start = snapshot.window.startTick, end = snapshot.window.endTick;
  if (![tick, start, end].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) || end !== tick || (start as number) > (tick as number)) throw Error('invalid_signal_request');
  const result: SignalRequest = {
    schemaVersion: 1, locale: body.locale,
    snapshot: { tick: tick as number, window: { startTick: start as number, endTick: end as number }, metrics: metricList(snapshot.metrics) },
  };
  if (snapshot.prior !== undefined) {
    exactKeys(snapshot.prior, ['tick', 'metrics']);
    const priorTick = snapshot.prior.tick;
    if (typeof priorTick !== 'number' || !Number.isSafeInteger(priorTick) || priorTick < (start as number) || priorTick >= (tick as number)) throw Error('invalid_signal_request');
    result.snapshot.prior = { tick: priorTick, metrics: metricList(snapshot.prior.metrics) };
  }
  return result;
}

/** Only current aggregates. Household records are never re-labelled as people or sent. */
export function captureCitySignals(city: City): SignalCapture {
  let income = 0, expense = 0;
  for (const entry of city.ledger) {
    if (entry.tick !== city.tick) continue;
    if (entry.to === 'treasury') income += entry.amount;
    if (entry.from === 'treasury') expense += entry.amount;
  }
  const population = city.households.reduce((total, household) => total + household.members, 0);
  const workforce = city.households.reduce((total, household) => total + household.workforce, 0);
  const employed = city.households.reduce((total, household) => total + householdWorkerCount(city, household.id), 0);
  const personCapacity = city.buildings.filter(building => building.zone === 'R').reduce((total, building) => total + housingCapacity(building).persons, 0);
  const metric = (id: MetricId, value: number): SignalMetric => ({ id, value, unit: METRIC_DEFINITIONS[id][0], source: SOURCE });
  const metrics = [
    metric('population', population),
    metric('households', city.households.length),
    metric('businesses', city.firms.length),
    metric('employed', employed),
    metric('unemployed', workforce - employed),
    metric('treasury', city.accounts.treasury / 100),
    metric('incomePerTick', income / 100),
    metric('expensesPerTick', expense / 100),
    metric('housingCapacity', personCapacity),
  ];
  return { tick: city.tick, metrics: metricList(metrics) };
}

/** History is observed, never reconstructed. Same/future captures cannot create a trend. */
export function requestForCapture(current: SignalCapture, prior?: SignalCapture, locale: 'th' | 'en' = 'th'): SignalRequest {
  const usable = prior && Number.isSafeInteger(prior.tick) && prior.tick >= 0 && prior.tick < current.tick ? prior : undefined;
  return validateSignalRequest({
    schemaVersion: 1, locale,
    snapshot: { tick: current.tick, window: { startTick: usable?.tick ?? current.tick, endTick: current.tick }, metrics: current.metrics, ...(usable ? { prior: usable } : {}) },
  });
}
function deriveData(input: SignalRequest): SignalReport['data'] {
  const snapshot = input.snapshot;
  const current = new Map(snapshot.metrics.map(metric => [metric.id, metric]));
  const prior = new Map((snapshot.prior?.metrics || []).map(metric => [metric.id, metric]));
  const signals: CitySignal[] = [], missingData: SignalMissingData[] = [];
  const observedWindow = { startTick: snapshot.tick, endTick: snapshot.tick };
  for (const id of Object.keys(METRIC_DEFINITIONS) as MetricId[]) {
    const metric = current.get(id);
    if (!metric) { missingData.push({ id: 'missing.current.' + id, metricRefs: [id], reason: 'current_metric_unavailable' }); continue; }
    if (!snapshot.prior || !prior.has(id)) { missingData.push({ id: 'missing.prior.' + id, metricRefs: [id], reason: 'prior_metric_unavailable' }); continue; }
    const delta = metric.value - prior.get(id)!.value;
    signals.push({ id: 'trend.' + id, kind: 'trend', metricRefs: [id], category: METRIC_DEFINITIONS[id][1], direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat', delta, unit: metric.unit, window: { startTick: snapshot.prior.tick, endTick: snapshot.tick }, source: RULES });
  }
  const threshold = (id: string, refs: MetricId[], rule: string, unit: MetricUnit, value: number, conditionMet: boolean) =>
    signals.push({ id, kind: 'threshold', metricRefs: refs, category: METRIC_DEFINITIONS[refs[0]][1], rule, value, unit, conditionMet, window: observedWindow, source: RULES });
  const treasury = current.get('treasury');
  if (treasury) threshold('threshold.treasury-negative', ['treasury'], 'treasury < 0', 'currency', treasury.value, treasury.value < 0);
  const income = current.get('incomePerTick'), expense = current.get('expensesPerTick');
  if (income && expense) {
    const net = income.value - expense.value;
    threshold('threshold.net-flow-negative', ['incomePerTick', 'expensesPerTick'], 'incomePerTick - expensesPerTick < 0', 'currency/tick', net, net < 0);
  } else missingData.push({ id: 'missing.net-flow-input', metricRefs: (['incomePerTick', 'expensesPerTick'] as MetricId[]).filter(id => !current.has(id)), reason: 'threshold_inputs_unavailable' });
  const population = current.get('population'), capacity = current.get('housingCapacity');
  if (population && capacity) {
    const gap = population.value - capacity.value;
    threshold('threshold.housing-capacity-exceeded', ['population', 'housingCapacity'], 'population - housingCapacity > 0', 'people', gap, gap > 0);
  } else missingData.push({ id: 'missing.housing-input', metricRefs: (['population', 'housingCapacity'] as MetricId[]).filter(id => !current.has(id)), reason: 'threshold_inputs_unavailable' });
  return {
    window: { ...snapshot.window },
    provenance: { input: SOURCE, trust: 'client_reported_unverified', derivation: RULES, comparisonPriorTick: snapshot.prior?.tick ?? null },
    metrics: snapshot.metrics.map(metric => ({ ...metric, window: { ...observedWindow } })),
    priorMetrics: (snapshot.prior?.metrics || []).map(metric => ({ ...metric, window: { startTick: snapshot.prior!.tick, endTick: snapshot.prior!.tick } })),
    signals, missingData,
  };
}
function explanation(signal: CitySignal, locale: 'th' | 'en'): string {
  const refs = signal.metricRefs.join(', ');
  if (signal.kind === 'trend') return locale === 'th'
    ? refs + ': ผลต่าง ' + signal.delta + ' ' + signal.unit + ' ระหว่าง tick ' + signal.window.startTick + ' ถึง ' + signal.window.endTick + ' (' + signal.direction + ') เป็นการเปรียบเทียบข้อมูล ไม่ยืนยันสาเหตุ'
    : refs + ': change ' + signal.delta + ' ' + signal.unit + ' from tick ' + signal.window.startTick + ' to ' + signal.window.endTick + ' (' + signal.direction + '); comparison does not establish a cause.';
  return locale === 'th'
    ? refs + ': เงื่อนไข ' + signal.rule + ' ' + (signal.conditionMet ? 'เป็นจริง' : 'ไม่เป็นจริง') + '; ค่าที่คำนวณได้ ' + signal.value + ' ' + signal.unit + ' ณ tick ' + signal.window.endTick + '; ไม่มีการจัดระดับความรุนแรง'
    : refs + ': condition ' + signal.rule + ' is ' + signal.conditionMet + '; computed value ' + signal.value + ' ' + signal.unit + ' at tick ' + signal.window.endTick + '; no severity assigned.';
}
export function buildLocalSignalReport(body: SignalRequest): SignalReport {
  const input = validateSignalRequest(body), data = deriveData(input);
  const summarySignalIds = [...data.signals].sort((a, b) => Number(b.kind === 'threshold' && b.conditionMet) - Number(a.kind === 'threshold' && a.conditionMet)).slice(0, 6).map(signal => signal.id);
  const selected = new Set(summarySignalIds);
  return {
    schemaVersion: 1, mode: 'fallback', snapshotTick: input.snapshot.tick, data,
    report: {
      summarySignalIds,
      groups: CATEGORIES.map(category => ({ category, signalIds: data.signals.filter(signal => signal.category === category).map(signal => signal.id) })).filter(group => group.signalIds.length),
      observations: data.signals.map(signal => ({ signalRefs: [signal.id], metricRefs: [...signal.metricRefs], emphasized: selected.has(signal.id), text: explanation(signal, input.locale) })),
      hypotheses: [],
      limitations: input.locale === 'th'
        ? ['ข้อมูลมาจาก snapshot ที่ไคลเอนต์รายงานและยังไม่ได้ตรวจสอบกับบัญชีเกม', 'ข้อมูลที่ขาดไม่ถูกแทนด้วยศูนย์', 'รายงานนี้ไม่แก้ไขบัญชีหรือการจำลอง และไม่ยืนยันเหตุและผล']
        : ['Snapshot values are client reported and not verified against the game ledger.', 'Missing values are not replaced with zero.', 'This report does not change accounting or simulation and does not establish causality.'],
    },
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
/** Accept only matching deterministic data and valid references; discard every remote prose field. */
export function acceptRemoteSignalReport(value: unknown, local: SignalReport): SignalReport | null {
  try {
    exactKeys(value, ['schemaVersion', 'mode', 'snapshotTick', 'data', 'report']);
    if (value.schemaVersion !== 1 || !['ai', 'fallback'].includes(value.mode as string) || value.snapshotTick !== local.snapshotTick || canonical(value.data) !== canonical(local.data)) return null;
    const report = value.report;
    exactKeys(report, ['summarySignalIds', 'groups', 'observations', 'hypotheses', 'limitations']);
    const ids = new Map(local.data.signals.map(signal => [signal.id, signal]));
    if (!Array.isArray(report.summarySignalIds) || report.summarySignalIds.length > 6 ||
        new Set(report.summarySignalIds).size !== report.summarySignalIds.length ||
        report.summarySignalIds.some(id => typeof id !== 'string' || !ids.has(id)) ||
        !Array.isArray(report.groups) || report.groups.length > 5 ||
        !Array.isArray(report.hypotheses) || report.hypotheses.length !== 0 ||
        !Array.isArray(report.limitations) || report.limitations.length > 8 || report.limitations.some(text => typeof text !== 'string' || text.length > 2000)) return null;
    const seenCategories = new Set<string>(), grouped = new Set<string>(), groups: SignalGroup[] = [];
    for (const group of report.groups) {
      exactKeys(group, ['category', 'signalIds']);
      if (typeof group.category !== 'string' || !CATEGORIES.includes(group.category as SignalCategory) || seenCategories.has(group.category) || !Array.isArray(group.signalIds) || group.signalIds.length > 16) return null;
      seenCategories.add(group.category);
      const signalIds: string[] = [];
      for (const id of group.signalIds) {
        if (typeof id !== 'string' || !ids.has(id) || ids.get(id)!.category !== group.category || grouped.has(id)) return null;
        grouped.add(id); signalIds.push(id);
      }
      groups.push({ category: group.category as SignalCategory, signalIds });
    }
    if (!Array.isArray(report.observations) || report.observations.length !== local.report.observations.length) return null;
    const observed = new Set<string>(), selected = new Set(report.summarySignalIds as string[]);
    for (const observation of report.observations) {
      exactKeys(observation, ['signalRefs', 'metricRefs', 'emphasized', 'text']);
      if (!Array.isArray(observation.signalRefs) || observation.signalRefs.length !== 1 || typeof observation.signalRefs[0] !== 'string' ||
          observed.has(observation.signalRefs[0]) || !ids.has(observation.signalRefs[0])) return null;
      const id = observation.signalRefs[0], signal = ids.get(id)!;
      if (canonical(observation.metricRefs) !== canonical(signal.metricRefs) || observation.emphasized !== selected.has(id) || typeof observation.text !== 'string' || observation.text.length > 2000) return null;
      observed.add(id);
    }
    const accepted = structuredClone(local);
    accepted.mode = value.mode as 'ai' | 'fallback';
    accepted.report.summarySignalIds = [...report.summarySignalIds] as string[];
    accepted.report.groups = groups;
    accepted.report.observations.forEach(observation => { observation.emphasized = selected.has(observation.signalRefs[0]); });
    return accepted;
  } catch { return null; }
}

