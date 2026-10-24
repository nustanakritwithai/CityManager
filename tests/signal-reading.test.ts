import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalSignalReport, METRIC_DEFINITIONS, requestForCapture } from '../src/signal-data.ts';
import type { MetricId, SignalCapture, SignalReport } from '../src/signal-data.ts';
import { readingComparison, readingSignal, readingWindow } from '../src/signal-reading.ts';

const capture = (tick: number, values: Partial<Record<MetricId, number>>): SignalCapture => ({
  tick, metrics: Object.entries(values).map(([id, value]) => ({
    id: id as MetricId, value: value!, unit: METRIC_DEFINITIONS[id as MetricId][0], source: 'citymanager.aggregate.v1',
  })),
});
const report = (current: SignalCapture, prior?: SignalCapture) => buildLocalSignalReport(requestForCapture(current, prior));
const read = (report: SignalReport, id: string) => readingSignal(report.data.signals.find(signal => signal.id === id)!, report);

test('first capture keeps absent prior and delta null; observed zero remains zero', () => {
  const value = report(capture(9, { population: 0, households: 0, treasury: 0 }));
  assert.deepEqual(readingComparison(value).map(row => [row.current, row.prior, row.delta]), [[0, null, null], [0, null, null], [0, null, null]]);
  assert.match(readingWindow(value), /วันที่ 9.*ยังไม่มีภาพก่อนหน้า/);
  assert(!readingWindow(value).includes('วันที่ 0'));
});

test('day zero is a valid observed endpoint and comparison retains people versus household units', () => {
  const value = report(capture(3, { population: 7, households: 3, treasury: 10.5 }), capture(0, { population: 0, households: 0, treasury: 11 }));
  assert.deepEqual(readingComparison(value), [
    { id: 'population', label: 'ประชากร', unit: 'คน', current: 7, prior: 0, delta: 7 },
    { id: 'households', label: 'ครัวเรือน', unit: 'ครัวเรือน', current: 3, prior: 0, delta: 3 },
    { id: 'treasury', label: 'เงินคลังเมือง', unit: 'เครดิต', current: 10.5, prior: 11, delta: -0.5 },
  ]);
  assert.match(readingWindow(value), /วันที่ 0 → 3 ห่างกัน 3 วัน/);
  const reading = read(value, 'trend.treasury');
  assert.match(reading.title, /ลดลง 0.5 เครดิต/);
  assert.match(reading.explanation, /วันที่ 0: 11 → วันที่ 3: 10.5 เครดิต/);
  assert.match(reading.explanation, /ไม่บอกการเปลี่ยนแปลงระหว่างวัน/);
  assert(reading.evidence.some(line => line.includes('trend.treasury')));
});

test('missing individual prior metric cannot become a zero or borrowed earlier value', () => {
  const value = report(capture(8, { treasury: 40, population: 7 }), capture(4, { treasury: 50 }));
  assert.equal(readingComparison(value).find(row => row.id === 'population')!.prior, null);
  assert.equal(readingComparison(value).find(row => row.id === 'population')!.delta, null);
  value.data.priorMetrics[0].window.endTick = 3;
  assert.equal(readingComparison(value).find(row => row.id === 'treasury')!.prior, null, 'wrong-window prior is not displayed');
});

test('flow trends explicitly compare captured daily totals, not interval sums or causal claims', () => {
  const value = report(capture(12, { incomePerTick: 15, expensesPerTick: 15 }), capture(2, { incomePerTick: 30, expensesPerTick: 15 }));
  const income = read(value, 'trend.incomePerTick'), expense = read(value, 'trend.expensesPerTick');
  assert.match(income.title, /ลดลง 15 เครดิต\/วัน/);
  assert.match(income.explanation, /วันที่ 2: 30 → วันที่ 12: 15/);
  assert.match(income.explanation, /ไม่ใช่ยอดสะสมตลอดช่วงหรือค่าเฉลี่ยต่อวัน/);
  assert(!income.explanation.includes('เพราะ'));
  assert.match(expense.title, /คงเดิม 15 เครดิต\/วัน$/);
  assert(readingComparison(value).every(row => row.prior !== null));
});

test('threshold readings expose grounded formulas and distinguish a single day from operating profit', () => {
  const value = report(capture(11, { treasury: -4, incomePerTick: 10.5, expensesPerTick: 12, population: 9, housingCapacity: 7 }));
  const treasury = read(value, 'threshold.treasury-negative');
  assert.match(treasury.title, /เงินคลังติดลบ -4 เครดิต/);
  const flow = read(value, 'threshold.net-flow-negative');
  assert.match(flow.title, /เงินออกมากกว่าเงินเข้า.*-1.5 เครดิต\/วัน/);
  assert(flow.evidence.some(line => line.includes('10.5 − 12 = -1.5')));
  assert.match(flow.explanation, /รวมเงินทุนและค่าก่อสร้างถ้ามี/);
  assert.match(flow.explanation, /ไม่ใช่กำไรประจำ/);
  const housing = read(value, 'threshold.housing-capacity-exceeded');
  assert.match(housing.title, /ประชากรเกินความจุรวม 2 คน/);
  assert(housing.evidence.some(line => line.includes('9 − 7 = 2 คน')));
  assert.match(housing.explanation, /ไม่ได้ยืนยันว่าทุกครัวเรือนมีที่อยู่/);
});

test('false thresholds and balanced flows do not claim a problem or alter source report', () => {
  const value = report(capture(11, { treasury: 0, incomePerTick: 12, expensesPerTick: 12, population: 7, housingCapacity: 9 }));
  const original = structuredClone(value);
  assert.match(read(value, 'threshold.treasury-negative').title, /คงเหลือ 0/);
  assert.match(read(value, 'threshold.net-flow-negative').title, /เข้าไม่น้อยกว่าเงินออก: สุทธิ 0/);
  assert.match(read(value, 'threshold.housing-capacity-exceeded').title, /เหลือความจุที่อยู่อาศัยรวม 2 คน/);
  readingWindow(value); readingComparison(value);
  assert.deepEqual(value, original, 'presentation does not change validated values, references or report');
});
