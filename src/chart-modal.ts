/**
 * Expanded chart view: one city chart large, with a range row (7 / 30 / 90 days / all), legend
 * toggles, event markers along the time axis and a window summary table. Read-only.
 */
import { dailySeries } from './city-series.ts';
import { CHARTS, windowSummary, type ChartDef } from './chart-defs.ts';
import { divergingColumns, lineChart, stackedArea, type ChartSeries } from './charts.ts';
import type { City } from './sim.ts';

const RANGES: readonly [number, string][] = [[7, '7 วัน'], [30, '30 วัน'], [90, '90 วัน'], [Infinity, 'ทั้งหมด']];
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
}

/** Draw one definition at a given size; shared by the dashboard cards and the expanded view. */
export function renderChart(def: ChartDef, series: ReturnType<typeof dailySeries>, width: number, height: number, options: { hidden?: Set<string>; onToggle?: (key: string) => void; markers?: boolean } = {}): HTMLElement {
  const list: ChartSeries[] = def.series(series).map(s => ({ ...s, hidden: options.hidden?.has(s.key) }));
  const common = { ticks: series.ticks, format: def.format, axis: def.axis, title: def.title, width, height, onToggle: options.onToggle, markers: options.markers ? def.markers?.(series) : undefined };
  if (def.kind === 'diverging') return divergingColumns({ ...common, series: list, up: list[0], down: list[1] });
  if (def.kind === 'stacked') return stackedArea({ ...common, series: list });
  return lineChart({ ...common, series: list, area: def.kind === 'area', zero: def.zero });
}

export class ChartModal {
  private readonly root = el('div', 'chart-modal');
  private readonly title = el('h2', 'chart-modal-title');
  private readonly note = el('span', 'chart-modal-note');
  private readonly ranges = el('div', 'chart-modal-ranges');
  private readonly body = el('div', 'chart-modal-body');
  private def: ChartDef | null = null;
  private days = 30;
  private hidden = new Set<string>();
  private city: City | null = null;
  private key = '';

  constructor() {
    this.root.id = 'chart-modal'; this.root.hidden = true; this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'false');
    const bar = el('header', 'chart-modal-bar'), close = el('button', 'chart-modal-close', '✕');
    close.type = 'button'; close.setAttribute('aria-label', 'ปิดกราฟ'); close.addEventListener('click', () => this.close());
    bar.append(this.title, this.note, close);
    for (const [days, label] of RANGES) {
      const button = el('button', 'chart-range', label); button.type = 'button'; button.dataset.days = String(days);
      button.addEventListener('click', () => { this.days = days; this.key = ''; if (this.city) this.update(this.city); });
      this.ranges.append(button);
    }
    const controls = el('div', 'chart-modal-controls'); controls.append(el('span', 'chart-modal-label', 'ช่วงเวลา'), this.ranges);
    this.root.append(bar, controls, this.body); document.body.append(this.root);
  }
  get isOpen() { return !this.root.hidden; }
  open(key: string, city: City) {
    const def = CHARTS[key]; if (!def) return;
    this.def = def; this.hidden.clear(); this.key = ''; this.root.hidden = false; this.root.setAttribute('aria-label', def.title);
    this.update(city); (this.root.querySelector('.chart') as HTMLElement | null)?.focus({ preventScroll: true });
  }
  close() { this.root.hidden = true; this.def = null; }
  update(city: City) {
    this.city = city;
    if (!this.def || this.root.hidden) return;
    const key = `${this.def.key}:${this.days}:${city.tick}:${city.ledger.length}:${[...this.hidden].join(',')}`;
    if (key === this.key) return; this.key = key;
    const series = dailySeries(city, this.days), def = this.def;
    this.title.textContent = def.title;
    this.note.textContent = `วันที่ ${series.ticks[0]}–${series.ticks.at(-1)} · ${series.ticks.length.toLocaleString('th-TH')} วัน`;
    for (const b of this.ranges.querySelectorAll<HTMLButtonElement>('.chart-range')) { const on = Number(b.dataset.days) === this.days; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    const width = Math.max(320, Math.min(1040, this.body.clientWidth || innerWidth - 80) - 20);
    const chart = renderChart(def, series, width, Math.round(Math.min(340, Math.max(200, innerHeight * .36))), {
      hidden: this.hidden, markers: true,
      onToggle: k => { if (this.hidden.has(k)) this.hidden.delete(k); else if (this.hidden.size < def.series(series).length - 1) this.hidden.add(k); this.key = ''; this.update(city); },
    });
    // Window summary: mean per day, total (flows) or latest (levels), and the peak day.
    const table = el('table', 'chart-summary'), head = el('tr');
    for (const label of ['ชุดข้อมูล', 'เฉลี่ย/วัน', def.measure === 'flow' ? 'รวมช่วงนี้' : 'ล่าสุด', 'สูงสุด']) head.append(el('th', '', label));
    const thead = el('thead'); thead.append(head); const tbody = el('tbody');
    for (const row of windowSummary(def, series)) {
      const tr = el('tr'), name = el('th'), key = el('i'); key.style.setProperty('--c', `var(--series-${row.slot})`); name.append(key, document.createTextNode(row.label));
      tr.append(name, el('td', '', def.format(row.mean)), el('td', '', def.format(row.total)), el('td', '', def.format(row.peak))); tbody.append(tr);
    }
    table.append(thead, tbody);
    const summary = el('section', 'chart-modal-summary'); summary.append(el('h3', '', 'ช่วงนี้'), table);
    this.body.replaceChildren(chart, summary);
  }
}
