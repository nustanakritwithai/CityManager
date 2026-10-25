/**
 * The city's charts, defined once and used twice: small on the dashboard, large in the
 * expanded view. Series colours follow the entity (fixed slot order), never the rank.
 */
import { BUILDING_ORDER, BUILDING_NAMES, sum, type DailySeries } from './city-series.ts';
import type { ChartMarker, ChartSeries } from './charts.ts';

export type ChartKind = 'line' | 'area' | 'stacked' | 'diverging';
export type ChartDef = {
  key: string; title: string; kind: ChartKind; unit: string; zero?: boolean;
  /** 'flow' series are summed over a window; 'level' series report their latest value. */
  measure: 'flow' | 'level';
  series: (s: DailySeries) => ChartSeries[];
  format: (v: number) => string; axis?: (v: number) => string;
  markers?: (s: DailySeries) => ChartMarker[];
};

const baht = (satang: number) => `${Math.round(satang / 100).toLocaleString('th-TH')} ฿`;
const bahtAxis = (satang: number) => {
  const v = satang / 100, a = Math.abs(v), sign = v < 0 ? '−' : '';
  return a >= 1e6 ? `${sign}${(a / 1e6).toFixed(1).replace(/\.0$/, '')}M` : a >= 1e3 ? `${sign}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K` : `${sign}${Math.round(a)}`;
};
const count = (unit: string) => (v: number) => `${Math.round(v).toLocaleString('th-TH')} ${unit}`;
const markersOf = (kinds: string[]) => (s: DailySeries) => s.markers.filter(m => kinds.includes(m.kind));

export const CHARTS: Record<string, ChartDef> = {
  treasury: {
    key: 'treasury', title: 'เงินคลังรายวัน', kind: 'line', zero: false, unit: '฿', measure: 'level', format: baht, axis: bahtAxis,
    series: s => [{ key: 'treasury', label: 'เงินคลัง', values: s.treasury, slot: 1 }], markers: markersOf(['road', 'closure']),
  },
  cashflow: {
    key: 'cashflow', title: 'รายรับ–รายจ่ายคลังรายวัน', kind: 'diverging', unit: '฿', measure: 'flow', format: baht, axis: bahtAxis,
    series: s => [{ key: 'income', label: 'รายรับ', values: s.income, slot: 1 }, { key: 'expense', label: 'รายจ่าย', values: s.expense, slot: 8 }],
    markers: markersOf(['road', 'closure']),
  },
  crops: {
    key: 'crops', title: 'พืชผลรายวัน', kind: 'line', unit: 'ล็อต', measure: 'flow', format: count('ล็อต'),
    series: s => [
      { key: 'harvested', label: 'เก็บเกี่ยว', values: s.cropsHarvested, slot: 1 },
      { key: 'processed', label: 'แปรรูป', values: s.cropsProcessed, slot: 2 },
      { key: 'consumed', label: 'ครัวเรือนกิน', values: s.cropsConsumed, slot: 3 },
    ],
    markers: markersOf(['building']),
  },
  goods: {
    key: 'goods', title: 'สินค้าสำเร็จรูปรายวัน', kind: 'line', unit: 'หน่วย', measure: 'flow', format: count('หน่วย'),
    series: s => [
      { key: 'produced', label: 'ผลิต', values: s.goodsProduced, slot: 1 },
      { key: 'consumed', label: 'ครัวเรือนใช้', values: s.goodsConsumed, slot: 2 },
      { key: 'exported', label: 'ส่งออก', values: s.goodsExported, slot: 3 },
    ],
    markers: markersOf(['building']),
  },
  population: {
    key: 'population', title: 'ประชากร', kind: 'area', unit: 'คน', measure: 'level', format: count('คน'),
    series: s => [{ key: 'population', label: 'ประชากร', values: s.population, slot: 3 }], markers: markersOf(['arrival']),
  },
  buildings: {
    key: 'buildings', title: 'อาคารตามประเภท', kind: 'stacked', unit: 'หลัง', measure: 'level', format: count('หลัง'),
    series: s => BUILDING_ORDER.map((kind, i) => ({ key: kind, label: BUILDING_NAMES[kind], values: s.buildings[kind], slot: i + 1 })),
    markers: markersOf(['building', 'closure']),
  },
};

/** Summary rows for the expanded view: mean per day, window total (flows) or latest (levels), peak. */
export function windowSummary(def: ChartDef, s: DailySeries) {
  return def.series(s).map(series => {
    const values = series.values, total = sum(values), days = Math.max(1, values.length);
    return { label: series.label, slot: series.slot, mean: total / days, total: def.measure === 'flow' ? total : values.at(-1) ?? 0, peak: Math.max(0, ...values) };
  });
}
