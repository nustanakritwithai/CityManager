import { METRIC_LABELS, UNIT_LABELS } from './signal-data.ts';
import type { CitySignal, MetricId, SignalReport } from './signal-data.ts';

export type SignalReading = { title: string; explanation: string; evidence: string[] };
export type SignalComparison = {
  id: MetricId; label: string; unit: string; current: number; prior: number | null; delta: number | null;
};
const number = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 12 });
const signed = (value: number) => `${value > 0 ? '+' : ''}${number(value)}`;
const dayFlow = (id: MetricId) => id === 'incomePerTick' || id === 'expensesPerTick';
const label = (id: MetricId) => METRIC_LABELS[id];

/** Two observed endpoints only. An unavailable earlier value is never a zero. */
export function readingComparison(report: SignalReport): SignalComparison[] {
  const priorTick = report.data.provenance.comparisonPriorTick;
  const hasPrior = priorTick !== null && priorTick < report.snapshotTick;
  return report.data.metrics.map(metric => {
    const prior = hasPrior ? report.data.priorMetrics.find(candidate => candidate.id === metric.id &&
      candidate.unit === metric.unit && candidate.window.startTick === priorTick && candidate.window.endTick === priorTick) : undefined;
    return {
      id: metric.id, label: label(metric.id), unit: UNIT_LABELS[metric.unit], current: metric.value,
      prior: prior?.value ?? null, delta: prior ? metric.value - prior.value : null,
    };
  });
}

export function readingWindow(report: SignalReport): string {
  const prior = report.data.provenance.comparisonPriorTick, current = report.snapshotTick;
  return prior !== null && prior < current
    ? `เทียบภาพที่จับไว้วันที่ ${prior} → ${current} ห่างกัน ${current - prior} วัน (1 tick = 1 วัน)`
    : `ภาพวันที่ ${current} · ยังไม่มีภาพก่อนหน้าสำหรับเปรียบเทียบ`;
}

/** Thai prose is generated only from validated local numbers and fixed rules. */
export function readingSignal(signal: CitySignal, report: SignalReport): SignalReading {
  const rows = readingComparison(report), unit = UNIT_LABELS[signal.unit];
  const evidence = [`สัญญาณ: ${signal.id} · สูตร: ${signal.source}`];
  for (const id of signal.metricRefs) {
    const metric = report.data.metrics.find(candidate => candidate.id === id);
    evidence.push(metric
      ? `${id} = ${number(metric.value)} ${UNIT_LABELS[metric.unit]} · วันที่ ${metric.window.endTick}`
      : `${id}: ไม่มีข้อมูลในภาพนี้`);
  }
  if (signal.kind === 'trend') {
    const row = rows.find(candidate => candidate.id === signal.metricRefs[0]);
    const direction = signal.delta > 0 ? 'เพิ่มขึ้น' : signal.delta < 0 ? 'ลดลง' : 'คงเดิม';
    const title = `${signal.metricRefs.map(label).join(' / ')} ${direction}${signal.delta === 0 ? row ? ` ${number(row.current)} ${unit}` : '' : ` ${number(Math.abs(signal.delta))} ${unit}`}`;
    evidence.push(`ผลต่าง: ${signed(signal.delta)} ${unit} · วันที่ ${signal.window.startTick} → ${signal.window.endTick}`);
    if (row?.prior !== null && row?.prior !== undefined) evidence.push(`${row.id} ก่อนหน้า = ${number(row.prior)} ${row.unit} · วันที่ ${signal.window.startTick}`);
    const endpoints = row?.prior !== null && row?.prior !== undefined
      ? `วันที่ ${signal.window.startTick}: ${number(row.prior)} → วันที่ ${signal.window.endTick}: ${number(row.current)} ${unit}`
      : `เปรียบเทียบวันที่ ${signal.window.startTick} กับวันที่ ${signal.window.endTick}; ไม่แสดงค่าก่อนหน้าที่ขาด`;
    const flowScope = signal.metricRefs.some(dayFlow)
      ? ' เปรียบเทียบยอดเฉพาะของแต่ละวันที่จับภาพ ไม่ใช่ยอดสะสมตลอดช่วงหรือค่าเฉลี่ยต่อวัน'
      : ' เป็นผลต่างของสองภาพที่จับไว้ ไม่บอกการเปลี่ยนแปลงระหว่างวันเหล่านั้น';
    return { title, explanation: `${endpoints}.${flowScope}`, evidence };
  }

  const current = (id: MetricId) => report.data.metrics.find(metric => metric.id === id)?.value;
  const atDay = `ณ วันที่ ${signal.window.endTick}`;
  evidence.push(`เงื่อนไข: ${signal.rule} · ${signal.conditionMet ? 'เป็นจริง' : 'ไม่เป็นจริง'}`);
  if (signal.id === 'threshold.treasury-negative') return {
    title: `เงินคลัง${signal.conditionMet ? 'ติดลบ' : 'คงเหลือ'} ${number(signal.value)} ${unit}`,
    explanation: `${atDay} เมืองมีเงินคลัง ${number(signal.value)} ${unit}`, evidence,
  };
  if (signal.id === 'threshold.net-flow-negative') {
    const income = current('incomePerTick'), expenses = current('expensesPerTick');
    if (income !== undefined && expenses !== undefined) evidence.push(`incomePerTick − expensesPerTick = ${number(income)} − ${number(expenses)} = ${number(signal.value)} ${unit}`);
    return {
      title: `วันที่ ${signal.window.endTick} เงิน${signal.conditionMet ? 'ออกมากกว่าเงินเข้า' : 'เข้าไม่น้อยกว่าเงินออก'}: สุทธิ ${signed(signal.value)} ${unit}`,
      explanation: `${atDay} เงินเข้า ${number(income!)} เครดิต เงินออก ${number(expenses!)} เครดิต ผลต่าง ${number(signal.value)} ${unit} นับรายการคลังเฉพาะวันที่จับภาพ รวมเงินทุนและค่าก่อสร้างถ้ามี ไม่ใช่กำไรประจำหรือยอดรวมตลอดช่วงเปรียบเทียบ`, evidence,
    };
  }
  if (signal.id === 'threshold.housing-capacity-exceeded') {
    const population = current('population'), capacity = current('housingCapacity');
    if (population !== undefined && capacity !== undefined) evidence.push(`population − housingCapacity = ${number(population)} − ${number(capacity)} = ${number(signal.value)} ${unit}`);
    return {
      title: signal.value > 0 ? `ประชากรเกินความจุรวม ${number(signal.value)} คน` : signal.value < 0 ? `เหลือความจุที่อยู่อาศัยรวม ${number(-signal.value)} คน` : 'ประชากรเท่ากับความจุที่อยู่อาศัยรวม',
      explanation: `${atDay} มีประชากร ${number(population!)} คน และความจุที่อยู่อาศัยรวม ${number(capacity!)} คน ความจุรวมไม่ได้ยืนยันว่าทุกครัวเรือนมีที่อยู่หรือจัดสรรเข้าบ้านได้`, evidence,
    };
  }
  return {
    title: `${signal.metricRefs.map(label).join(' / ')}: เงื่อนไข${signal.conditionMet ? 'เป็นจริง' : 'ไม่เป็นจริง'}`,
    explanation: `${atDay} ค่าที่คำนวณได้ ${number(signal.value)} ${unit} จากเงื่อนไขที่แสดง โดยไม่จัดระดับความรุนแรงหรือยืนยันสาเหตุ`, evidence,
  };
}
