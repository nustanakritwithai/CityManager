/**
 * Small SVG chart kit for the panels: line / area, stacked area, diverging columns, part-to-whole
 * bar and stat tiles. Every plot has a crosshair tooltip (pointer and keyboard), a legend for two
 * or more series and a table view, so no value depends on colour or hover alone.
 * Labels go in with textContent; series colours come from the --series-N tokens.
 */
import './charts.css';
import { iconElement } from './ui-icons.ts';

export type ChartSeries = { key: string; label: string; values: readonly number[]; slot: number; hidden?: boolean };
export type ChartFormat = (value: number) => string;
export type ChartMarker = { tick: number; icon: string; text: string };
type PlotOptions = {
  ticks: readonly number[]; series: readonly ChartSeries[]; format: ChartFormat; axis?: ChartFormat; title: string;
  width?: number; height?: number; markers?: readonly ChartMarker[]; onToggle?: (key: string) => void; tickLabel?: (tick: number) => string;
};

const SVG = 'http://www.w3.org/2000/svg';
const colour = (slot: number) => `var(--series-${Math.min(8, Math.max(1, slot))})`;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); return node;
}

/** Thousands as 1.2K / 3.4M; small values as they are. */
export function compact(value: number): string {
  const a = Math.abs(value), sign = value < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
  return `${sign}${Math.round(a).toLocaleString('th-TH')}`;
}
/** Clean axis ticks (1, 2, 2.5, 5 × 10^k) covering [min, max]. */
export function niceTicks(min: number, max: number, count = 3): number[] {
  if (min === max) { max = min + 1; }
  const raw = (max - min) / count, power = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= raw)!;
  const ticks: number[] = []; for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  if (ticks.at(-1)! < max) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

type Frame = { W: number; H: number; left: number; right: number; top: number; bottom: number; x: (i: number) => number; y: (v: number) => number; yTicks: number[]; n: number };
function frame(n: number, min: number, max: number, W: number, H: number, zero = true): Frame {
  const yTicks = niceTicks(zero ? Math.min(0, min) : min, Math.max(max, min + 1)), lo = yTicks[0], hi = yTicks.at(-1)!;
  const left = 40, right = 10, top = 10, bottom = 24;
  const x = (i: number) => left + (n > 1 ? i / (n - 1) : .5) * (W - left - right);
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo || 1)) * (H - top - bottom);
  return { W, H, left, right, top, bottom, x, y, yTicks, n };
}
function axes(root: SVGSVGElement, f: Frame, ticks: readonly number[], axis: ChartFormat, tickLabel: (t: number) => string) {
  for (const v of f.yTicks) {
    root.append(svg('line', { x1: f.left, x2: f.W - f.right, y1: f.y(v), y2: f.y(v), class: v === 0 ? 'chart-baseline' : 'chart-grid' }));
    const label = svg('text', { x: f.left - 6, y: f.y(v) + 4, 'text-anchor': 'end', class: 'chart-tick' }); label.textContent = axis(v); root.append(label);
  }
  const marks = ticks.length > 2 ? [0, Math.floor((ticks.length - 1) / 2), ticks.length - 1] : ticks.map((_, i) => i);
  for (const i of [...new Set(marks)]) {
    const label = svg('text', { x: f.x(i), y: f.H - 6, 'text-anchor': i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle', class: 'chart-tick' });
    label.textContent = tickLabel(ticks[i]); root.append(label);
  }
}

/** Legend: line keys for lines, swatches for areas and bars; optional toggle-to-isolate. */
function legend(series: readonly ChartSeries[], shape: 'line' | 'rect', onToggle?: (key: string) => void): HTMLElement {
  const box = el('div', 'chart-legend');
  for (const s of series) {
    const item = el(onToggle ? 'button' : 'span', `chart-key ${shape}${s.hidden ? ' off' : ''}`);
    if (item instanceof HTMLButtonElement) { item.type = 'button'; item.setAttribute('aria-pressed', String(!s.hidden)); item.addEventListener('click', () => onToggle!(s.key)); }
    const mark = el('i'); mark.style.setProperty('--c', colour(s.slot)); item.append(mark, document.createTextNode(s.label)); box.append(item);
  }
  return box;
}

/** A table twin of any plot: rows newest first, built when first opened. */
function tableView(ticks: readonly number[], series: readonly ChartSeries[], format: ChartFormat, tickLabel: (t: number) => string): HTMLElement {
  const details = el('details', 'chart-table'), summary = el('summary', '', 'ดูเป็นตาราง'); details.append(summary);
  details.addEventListener('toggle', () => {
    if (!details.open || details.querySelector('table')) return;
    const table = el('table'), head = el('tr'); head.append(el('th', '', 'วัน'));
    for (const s of series) head.append(el('th', '', s.label));
    const thead = el('thead'); thead.append(head); const body = el('tbody');
    for (let i = ticks.length - 1; i >= 0; i--) {
      const row = el('tr'); row.append(el('th', '', tickLabel(ticks[i]))); for (const s of series) row.append(el('td', '', format(s.values[i] ?? 0))); body.append(row);
    }
    table.append(thead, body); const wrap = el('div', 'chart-table-wrap'); wrap.append(table); details.append(wrap);
  });
  return details;
}

/** Crosshair + one tooltip listing every visible series at the nearest day; arrow keys move it. */
function crosshair(figure: HTMLElement, root: SVGSVGElement, f: Frame, o: PlotOptions, points: (i: number) => { s: ChartSeries; v: number; y: number }[]) {
  const guide = svg('line', { y1: f.top, y2: f.H - f.bottom, class: 'chart-crosshair' }); guide.style.display = 'none';
  const dots = svg('g'); root.append(guide, dots);
  const tip = el('div', 'chart-tip'); tip.hidden = true; figure.append(tip);
  const hit = svg('rect', { x: f.left, y: f.top, width: f.W - f.left - f.right, height: f.H - f.top - f.bottom, class: 'chart-hit' }); root.append(hit);
  let index = -1;
  const show = (i: number) => {
    index = Math.max(0, Math.min(f.n - 1, i)); const x = f.x(index);
    guide.setAttribute('x1', String(x)); guide.setAttribute('x2', String(x)); guide.style.display = '';
    dots.replaceChildren(); tip.replaceChildren(el('div', 'chart-tip-head', (o.tickLabel ?? dayLabel)(o.ticks[index])));
    for (const p of points(index)) {
      const dot = svg('circle', { cx: x, cy: p.y, r: 4, class: 'chart-dot' }); dot.style.fill = colour(p.s.slot); dots.append(dot);
      const row = el('div', 'chart-tip-row'), key = el('i'); key.style.setProperty('--c', colour(p.s.slot));
      row.append(key, el('strong', '', o.format(p.v)), el('span', '', p.s.label)); tip.append(row);
    }
    tip.hidden = false;
    const box = figure.getBoundingClientRect(), rel = x / f.W * box.width;
    tip.style.left = `${Math.min(Math.max(4, rel + 12), Math.max(4, box.width - tip.offsetWidth - 4))}px`;
  };
  const hide = () => { guide.style.display = 'none'; dots.replaceChildren(); tip.hidden = true; };
  const fromPointer = (e: PointerEvent) => { const box = root.getBoundingClientRect(), sx = (e.clientX - box.left) / box.width * f.W; show(Math.round((sx - f.left) / ((f.W - f.left - f.right) / Math.max(1, f.n - 1)))); };
  hit.addEventListener('pointermove', fromPointer); hit.addEventListener('pointerdown', fromPointer); hit.addEventListener('pointerleave', hide);
  figure.tabIndex = 0; figure.setAttribute('aria-label', `${o.title} กดลูกศรซ้ายขวาเพื่ออ่านค่าแต่ละวัน`);
  figure.addEventListener('focus', () => show(f.n - 1)); figure.addEventListener('blur', hide);
  figure.addEventListener('keydown', e => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]; if (step) { e.preventDefault(); show((index < 0 ? f.n - 1 : index) + step); }
    if (e.key === 'Home') { e.preventDefault(); show(0); } if (e.key === 'End') { e.preventDefault(); show(f.n - 1); } if (e.key === 'Escape') hide();
  });
}

export const dayLabel = (tick: number) => `วัน ${tick}`;

function markerRow(figure: HTMLElement, f: Frame, o: PlotOptions) {
  if (!o.markers?.length) return;
  const row = el('div', 'chart-markers'), readout = el('p', 'chart-marker-readout', 'แตะไอคอนเพื่ออ่านเหตุการณ์');
  readout.setAttribute('aria-live', 'polite');
  const first = o.ticks[0], last = o.ticks.at(-1)!, groups: { x: number; items: ChartMarker[] }[] = [];
  for (const m of o.markers) {
    if (m.tick < first || m.tick > last) continue;
    const x = f.x(m.tick - first) / f.W * 100, group = groups.find(g => Math.abs(g.x - x) < 3.2);
    if (group) group.items.push(m); else groups.push({ x, items: [m] });
  }
  for (const g of groups) {
    const button = el('button', 'chart-marker'); button.type = 'button'; button.style.left = `${g.x}%`;
    button.append(iconElement(g.items[0].icon, 'ui-icon')); if (g.items.length > 1) button.append(el('b', '', `+${g.items.length - 1}`));
    const text = g.items.map(m => `${(o.tickLabel ?? dayLabel)(m.tick)} · ${m.text}`).join(' · ');
    button.setAttribute('aria-label', text); button.title = text;
    button.addEventListener('click', () => { readout.textContent = text; for (const b of row.querySelectorAll('.chart-marker')) b.classList.toggle('on', b === button); });
    row.append(button);
  }
  figure.append(row, readout);
}

function figureShell(o: PlotOptions, shape: 'line' | 'rect'): { figure: HTMLElement; root: SVGSVGElement; W: number; H: number } {
  const W = Math.max(240, Math.round(o.width ?? 320)), H = Math.round(o.height ?? 150), figure = el('figure', 'chart');
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img' }); root.setAttribute('aria-label', o.title);
  figure.append(root);
  if (o.series.length > 1) figure.append(legend(o.series, shape, o.onToggle));
  return { figure, root, W, H };
}

/** Lines (2px) for one to four series; a single series gets a 10% area wash. */
export function lineChart(o: PlotOptions & { area?: boolean; endLabels?: boolean; zero?: boolean }): HTMLElement {
  const { figure, root, W, H } = figureShell(o, 'line'), visible = o.series.filter(s => !s.hidden), n = o.ticks.length;
  // Areas and counts start at zero; a balance line may fit its own range so movement shows.
  const all = visible.flatMap(s => s.values), zero = o.area || o.zero !== false, f = frame(n, zero ? Math.min(0, ...all) : Math.min(...all), Math.max(zero ? 1 : -Infinity, ...all), W, H, zero);
  axes(root, f, o.ticks, o.axis ?? compact, o.tickLabel ?? dayLabel);
  for (const s of visible) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${f.x(i).toFixed(1)},${f.y(v).toFixed(1)}`).join('');
    if (o.area && visible.length === 1) { const fill = svg('path', { d: `${d}L${f.x(n - 1)},${f.y(f.yTicks[0])}L${f.x(0)},${f.y(f.yTicks[0])}Z`, class: 'chart-area' }); fill.style.fill = colour(s.slot); root.append(fill); }
    const line = svg('path', { d, class: 'chart-line' }); line.style.stroke = colour(s.slot); root.append(line);
    const end = svg('circle', { cx: f.x(n - 1), cy: f.y(s.values[n - 1] ?? 0), r: 4, class: 'chart-dot' }); end.style.fill = colour(s.slot); root.append(end);
  }
  if (o.endLabels !== false && visible.length > 1 && visible.length <= 4) {
    const taken: number[] = [];
    for (const s of visible) {
      const y = f.y(s.values[n - 1] ?? 0); if (taken.some(t => Math.abs(t - y) < 13)) continue; taken.push(y);
      const label = svg('text', { x: f.x(n - 1) - 8, y: y - 7, 'text-anchor': 'end', class: 'chart-end-label' }); label.textContent = s.label; root.append(label);
    }
  }
  crosshair(figure, root, f, o, i => visible.map(s => ({ s, v: s.values[i] ?? 0, y: f.y(s.values[i] ?? 0) })));
  markerRow(figure, f, o); figure.append(tableView(o.ticks, o.series, o.format, o.tickLabel ?? dayLabel));
  return figure;
}

/** Stacked areas for part-to-whole over time; first series sits on the baseline. */
export function stackedArea(o: PlotOptions): HTMLElement {
  const { figure, root, W, H } = figureShell(o, 'rect'), visible = o.series.filter(s => !s.hidden), n = o.ticks.length;
  const totals = o.ticks.map((_, i) => visible.reduce((t, s) => t + (s.values[i] ?? 0), 0)), f = frame(n, 0, Math.max(1, ...totals), W, H);
  axes(root, f, o.ticks, o.axis ?? compact, o.tickLabel ?? dayLabel);
  const base = new Array<number>(n).fill(0);
  for (const s of visible) {
    const topLine = s.values.map((v, i) => base[i] + (v ?? 0));
    const upper = topLine.map((v, i) => `${i ? 'L' : 'M'}${f.x(i).toFixed(1)},${f.y(v).toFixed(1)}`).join('');
    const lower = base.map((v, i) => `L${f.x(n - 1 - i).toFixed(1)},${f.y(base[n - 1 - i]).toFixed(1)}`).join('');
    const band = svg('path', { d: `${upper}${lower}Z`, class: 'chart-band' }); band.style.fill = colour(s.slot); root.append(band);
    const edge = svg('path', { d: upper, class: 'chart-band-edge' }); edge.style.stroke = colour(s.slot); root.append(edge);
    topLine.forEach((v, i) => { base[i] = v; });
  }
  crosshair(figure, root, f, o, i => { let acc = 0; return visible.map(s => { acc += s.values[i] ?? 0; return { s, v: s.values[i] ?? 0, y: f.y(acc) }; }).reverse(); });
  markerRow(figure, f, o); figure.append(tableView(o.ticks, o.series, o.format, o.tickLabel ?? dayLabel));
  return figure;
}

/** Inflow above the baseline, outflow below (diverging pair), one column per day. */
export function divergingColumns(o: PlotOptions & { up: ChartSeries; down: ChartSeries }): HTMLElement {
  const series = [o.up, o.down], { figure, root, W, H } = figureShell({ ...o, series }, 'rect'), n = o.ticks.length;
  const f = frame(n, -Math.max(1, ...o.down.values), Math.max(1, ...o.up.values), W, H);
  axes(root, f, o.ticks, o.axis ?? compact, o.tickLabel ?? dayLabel);
  const band = (f.W - f.left - f.right) / Math.max(1, n), width = Math.max(2, Math.min(24, band - 2)), r = Math.min(4, width / 2), zero = f.y(0);
  const bar = (i: number, value: number, up: boolean, s: ChartSeries) => {
    if (!value) return;
    const cx = f.left + band * (i + .5), x0 = cx - width / 2, x1 = cx + width / 2, end = f.y(up ? value : -value), rr = Math.min(r, Math.abs(end - zero));
    const d = up ? `M${x0},${zero}V${end + rr}Q${x0},${end} ${x0 + rr},${end}H${x1 - rr}Q${x1},${end} ${x1},${end + rr}V${zero}Z`
      : `M${x0},${zero}V${end - rr}Q${x0},${end} ${x0 + rr},${end}H${x1 - rr}Q${x1},${end} ${x1},${end - rr}V${zero}Z`;
    const path = svg('path', { d, class: 'chart-column' }); path.style.fill = colour(s.slot); root.append(path);
  };
  for (let i = 0; i < n; i++) { bar(i, o.up.values[i] ?? 0, true, o.up); bar(i, o.down.values[i] ?? 0, false, o.down); }
  root.append(svg('line', { x1: f.left, x2: f.W - f.right, y1: zero, y2: zero, class: 'chart-baseline' }));
  const fx = { ...f, x: (i: number) => f.left + band * (i + .5) };
  crosshair(figure, root, fx, o, i => [{ s: o.up, v: o.up.values[i] ?? 0, y: f.y(o.up.values[i] ?? 0) }, { s: o.down, v: o.down.values[i] ?? 0, y: f.y(-(o.down.values[i] ?? 0)) }]);
  markerRow(figure, fx, o); figure.append(tableView(o.ticks, series, o.format, o.tickLabel ?? dayLabel));
  return figure;
}

export type MixPart = { key: string; label: string; value: number; slot: number; icon?: string };
/** Part-to-whole: one horizontal stacked bar (2px surface gaps), legend with value and share. */
export function mixBar(parts: readonly MixPart[], format: ChartFormat, title: string): HTMLElement {
  const total = parts.reduce((t, p) => t + Math.max(0, p.value), 0), figure = el('figure', 'chart-mix');
  const head = el('figcaption', 'chart-mix-head'); head.append(el('span', '', title), el('strong', '', format(total))); figure.append(head);
  const bar = el('div', 'chart-mix-bar'); bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `${title}: ${parts.map(p => `${p.label} ${format(p.value)}`).join(', ')}`);
  const tip = el('div', 'chart-tip'); tip.hidden = true;
  for (const p of parts) {
    if (p.value <= 0) continue;
    const seg = el('span', 'chart-mix-seg'); seg.style.flexGrow = String(p.value); seg.style.setProperty('--c', colour(p.slot)); seg.tabIndex = 0;
    const share = total ? Math.round(p.value / total * 100) : 0, reveal = () => {
      tip.replaceChildren(); const row = el('div', 'chart-tip-row'), key = el('i'); key.style.setProperty('--c', colour(p.slot));
      row.append(key, el('strong', '', `${format(p.value)} · ${share}%`), el('span', '', p.label)); tip.append(row); tip.hidden = false;
      tip.style.left = `${Math.max(0, Math.min(seg.offsetLeft, figure.clientWidth - tip.offsetWidth))}px`;
    };
    seg.addEventListener('pointerenter', reveal); seg.addEventListener('focus', reveal); seg.addEventListener('pointerleave', () => { tip.hidden = true; }); seg.addEventListener('blur', () => { tip.hidden = true; });
    bar.append(seg);
  }
  if (!total) bar.append(el('span', 'chart-mix-empty', 'ยังไม่มีในช่วงนี้'));
  const list = el('ul', 'chart-mix-legend');
  for (const p of parts) {
    const item = el('li'), key = el('i'); key.style.setProperty('--c', colour(p.slot));
    if (p.icon) item.append(iconElement(p.icon, 'ui-icon chart-mix-icon'));
    item.append(key, el('span', '', p.label), el('strong', '', format(p.value)), el('small', '', total ? `${Math.round(p.value / total * 100)}%` : '0%'));
    list.append(item);
  }
  figure.append(bar, tip, list); return figure;
}

export type StatTile = { label: string; value: string; icon?: string; delta?: { text: string; tone: 'good' | 'bad' | 'flat' }; spark?: readonly number[]; meter?: number; note?: string };
/** Label, value, signed delta and either a sparkline (de-emphasis, last point accented) or a meter. */
export function statTile(t: StatTile): HTMLElement {
  const tile = el('figure', 'stat-tile'), head = el('figcaption', 'stat-label');
  if (t.icon) head.append(iconElement(t.icon, 'ui-icon stat-icon')); head.append(document.createTextNode(t.label));
  tile.append(head, el('strong', 'stat-value', t.value));
  if (t.delta) tile.append(el('span', `stat-delta ${t.delta.tone}`, t.delta.text));
  if (t.spark && t.spark.length > 1) {
    const W = 100, H = 24, min = Math.min(...t.spark), max = Math.max(...t.spark), span = max - min || 1, n = t.spark.length;
    const x = (i: number) => 2 + i / (n - 1) * (W - 6), y = (v: number) => H - 3 - (v - min) / span * (H - 6);
    const spark = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'stat-spark', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
    spark.append(svg('path', { d: t.spark.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''), class: 'stat-spark-line' }),
      svg('circle', { cx: x(n - 1), cy: y(t.spark[n - 1]), r: 3, class: 'stat-spark-dot' }));
    tile.append(spark);
  }
  if (t.meter !== undefined) { const meter = el('span', 'stat-meter'); meter.style.setProperty('--share', Math.max(0, Math.min(1, t.meter)).toFixed(3)); meter.setAttribute('aria-hidden', 'true'); tile.append(meter); }
  if (t.note) tile.append(el('small', 'stat-note', t.note));
  return tile;
}
