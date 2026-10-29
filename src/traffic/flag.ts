import { TRAFFIC_MODEL_ENABLED } from './clock.ts';
export const TRAFFIC_STORAGE_KEY = 'citymanager.traffic';
/** Feature flag with a dev override: `?traffic=1` / `?traffic=0`, or localStorage[TRAFFIC_STORAGE_KEY] = '1'. */
export function trafficModelEnabled(search = globalThis.location?.search ?? '', storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): boolean {
  const q = new URLSearchParams(search).get('traffic');
  try {
    if (q === '1') storage?.setItem(TRAFFIC_STORAGE_KEY, '1');
    if (q === '0') storage?.removeItem(TRAFFIC_STORAGE_KEY);
  } catch { /* private mode */ }
  if (q === '1') return true;
  if (q === '0') return false;
  try { if (storage?.getItem(TRAFFIC_STORAGE_KEY) === '1') return true; } catch { /* ignore */ }
  return TRAFFIC_MODEL_ENABLED;
}
type Topo = { blocked: number[]; oneWay: Record<string, number> };
const CELLS = 576;
/** Cells whose road flag or junction/one-way topology changed between two snapshots. */
export function changedRoadCells(before: readonly boolean[], after: readonly boolean[], topoBefore: string, topoAfter: string): number[] {
  const out = new Set<number>();
  after.forEach((r, i) => { if (r !== before[i]) out.add(i); });
  if (topoBefore !== topoAfter) {
    const parse = (t: string): Topo => t ? JSON.parse(t) : { blocked: [], oneWay: {} }, x = parse(topoBefore), y = parse(topoAfter);
    const bx = new Set(x.blocked), by = new Set(y.blocked);
    for (const k of [...bx].filter(k => !by.has(k)).concat([...by].filter(k => !bx.has(k)))) { out.add(Math.floor(k / CELLS)); out.add(k % CELLS); }
    for (const c of new Set([...Object.keys(x.oneWay), ...Object.keys(y.oneWay)])) if (x.oneWay[c] !== y.oneWay[c]) out.add(Number(c));
  }
  return [...out].sort((a, b) => a - b);
}
