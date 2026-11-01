/**
 * City overview dashboard: section navigation, treasury trend and budget, and the
 * 30-day supply chain. Read-only views over overview-data projections.
 */
import { treasuryBudget, supplyChain, goodsLines, type ChainFlow, type ChainNode } from './overview-data.ts';
import { CROP_LABELS, PRODUCT_LABELS, RECIPE_LABELS } from './goods.ts';
import { dailySeries, BUILDING_ORDER, BUILDING_NAMES, type DailySeries } from './city-series.ts';
import { cityOverview } from './context-data.ts';
import { CHARTS } from './chart-defs.ts';
import { renderChart, ChartModal } from './chart-modal.ts';
import { mixBar, statTile } from './charts.ts';
import { iconElement } from './ui-icons.ts';
import { cityGoals, renderGoalsCard } from './goals-panel.ts';
import { citySideMissions } from './city-goals.ts';
import type { City } from './sim.ts';

const SVG = 'http://www.w3.org/2000/svg';
const money = (satang: number) => Math.round(satang / 100).toLocaleString('th-TH') + ' ฿';
const signed = (satang: number) => (satang > 0 ? '+' : satang < 0 ? '−' : '±') + money(Math.abs(satang));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) => {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
};
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const node = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); return node;
};

const NAV: readonly [string, string][] = [
  ['dash-goals', 'เป้าหมาย'], ['dash-finance', 'การเงิน'], ['dash-chain', 'ห่วงโซ่สินค้า'], ['dash-growth', 'เมืองโต'], ['city-overview', 'ประชากรและงาน'],
  ['growth-anchor', 'ความต้องการ'], ['issue-section', 'ปัญหา'], ['event-log-section', 'เหตุการณ์'], ['money-section', 'บัญชี'],
];
const NODE_NAMES: Record<ChainNode, string> = { farm: 'ฟาร์ม', market: 'C · พืชผล', factory: 'โรงงาน', shop: 'C · สินค้า', household: 'ครัวเรือน', outside: 'ภายนอก' };
const NODE_POS: Record<ChainNode, [number, number]> = { farm: [14, 18], market: [174, 18], household: [334, 104], factory: [14, 190], shop: [174, 190], outside: [334, 190] };
const NODE_W = 92, NODE_H = 48;

export class OverviewDashboard {
  private readonly host: HTMLElement;
  private readonly goals = el('section', 'dash-card dash-goals');
  private readonly kpis = el('section', 'dash-kpis');
  private readonly finance = el('section', 'dash-card dash-finance');
  private readonly chain = el('section', 'dash-card dash-chain');
  private readonly growth = el('section', 'dash-card dash-growth');
  private readonly modal = new ChartModal();
  private city: City | null = null;
  private key = '';
  private chartWidth = 300;

  constructor(host: HTMLElement) {
    this.host = host;
    this.goals.id = 'dash-goals'; this.finance.id = 'dash-finance'; this.chain.id = 'dash-chain'; this.growth.id = 'dash-growth'; this.kpis.setAttribute('aria-label', 'ตัวเลขหลักของเมือง');
    const nav = el('nav', 'dash-nav'); nav.setAttribute('aria-label', 'ไปยังหมวดในภาพรวมเมือง');
    for (const [target, label] of NAV) {
      const button = el('button', 'dash-nav-chip', label); button.type = 'button';
      button.addEventListener('click', () => {
        const section = document.getElementById(target);
        if (section instanceof HTMLDetailsElement) section.open = true;
        section?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      });
      nav.append(button);
    }
    host.replaceChildren(nav, this.goals, this.kpis, this.finance, this.chain, this.growth);
  }
  get modalOpen() { return this.modal.isOpen; }
  closeModal() { this.modal.close(); }

  /** Rebuild once per simulated day; the navigation stays put so a press is never detached. */
  update(city: City) {
    const key = `${city.tick}:${city.ledger.length}:${city.cropLedger.length}:${city.goodsLedger.length}`;
    if (city !== this.city) this.key = ''; // A loaded city may share day and ledger sizes.
    this.city = city; this.modal.update(city);
    if (key === this.key) return;
    this.key = key;
    // Measure once before rebuilding, so building six charts does not force a layout each.
    this.chartWidth = this.width();
    const series = dailySeries(city, 30);
    renderGoalsCard(this.goals, cityGoals(city), citySideMissions(city));
    this.renderKpis(city, series); this.renderFinance(city, series); this.renderChain(city, series); this.renderGrowth(city, series);
  }

  /** Chart width follows the card so text stays at its real size. */
  private width() { return Math.max(260, Math.round((this.host.clientWidth || 340) - 44)); }
  private chart(key: string, series: DailySeries) {
    const def = CHARTS[key], box = el('div', 'dash-chart'), head = el('div', 'dash-chart-head');
    const expand = el('button', 'dash-expand'); expand.type = 'button'; expand.title = `ขยาย ${def.title}`; expand.setAttribute('aria-label', `ขยายกราฟ ${def.title}`);
    expand.append(iconElement('zoom-in')); expand.addEventListener('click', () => { if (this.city) this.modal.open(key, this.city); });
    head.append(el('h4', '', def.title), expand); box.append(head, renderChart(def, series, this.chartWidth, 140)); return box;
  }

  private renderKpis(city: City, series: DailySeries) {
    const o = cityOverview(city), now = series.treasury.at(-1)!, net = o.net, people = series.population, popDelta = people.at(-1)! - people[0];
    const employed = o.workforce ? o.employed / o.workforce : 0, housing = o.personCapacity ? o.occupiedPersons / o.personCapacity : 0;
    this.kpis.replaceChildren(
      statTile({ label: 'เงินคลัง', icon: 'coin', value: money(now), delta: { text: `${signed(net)} ใน 30 วัน`, tone: net > 0 ? 'good' : net < 0 ? 'bad' : 'flat' }, spark: series.treasury }),
      statTile({ label: 'ประชากร', icon: 'people', value: `${o.population.toLocaleString('th-TH')} คน`, delta: { text: `${popDelta >= 0 ? '+' : '−'}${Math.abs(popDelta).toLocaleString('th-TH')} ใน 30 วัน`, tone: popDelta > 0 ? 'good' : popDelta < 0 ? 'bad' : 'flat' }, spark: people }),
      statTile({ label: 'มีงานทำ', icon: 'worker', value: `${Math.round(employed * 100)}%`, meter: employed, note: `${o.employed.toLocaleString('th-TH')} จาก ${o.workforce.toLocaleString('th-TH')} คน` }),
      statTile({ label: 'ที่พักใช้ไป', icon: 'household', value: `${Math.round(housing * 100)}%`, meter: housing, note: `${o.occupiedPersons.toLocaleString('th-TH')} จาก ${o.personCapacity.toLocaleString('th-TH')} คน` }),
    );
  }

  private head(title: string, note: string) {
    const head = el('header', 'dash-head'); head.append(el('h3', '', title), el('span', 'dash-note', note)); return head;
  }

  private renderFinance(city: City, series: DailySeries) {
    const budget = treasuryBudget(city);
    const mix = el('div', 'dash-mix');
    mix.append(
      mixBar(budget.income.map((line, i) => ({ key: line.key, label: line.label, value: line.amount, slot: i + 1 })), money, 'รายรับคลังตามแหล่ง'),
      mixBar(budget.expense.map((line, i) => ({ key: line.key, label: line.label, value: line.amount, slot: i + 1 })), money, 'รายจ่ายคลังตามประเภท'),
    );
    this.finance.replaceChildren(this.head('การเงินของเมือง', `วันที่ ${series.ticks[0]}–${city.tick}`), this.chart('treasury', series), this.chart('cashflow', series), mix);
  }

  private renderChain(city: City, series: DailySeries) {
    const chain = supplyChain(city), max = Math.max(1, ...chain.flows.map(f => f.quantity));
    const count = (kind: ChainNode) => kind === 'household' ? city.households.length : kind === 'outside' ? 0
      : city.firms.filter(f => kind === 'farm' ? f.zone === 'F' : kind === 'factory' ? f.zone === 'I' : f.zone === 'C').length;
    const diagram = svg('svg', { viewBox: '0 0 440 270', class: 'dash-chain-svg', role: 'img', 'aria-label': 'แผนภาพการไหลของพืชผลและสินค้า 30 วัน รายละเอียดอยู่ในรายการด้านล่าง' });
    const defs = svg('defs');
    for (const tone of ['crops', 'goods', 'idle']) {
      const marker = svg('marker', { id: `dash-arrow-${tone}`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 11, markerHeight: 11, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' });
      marker.append(svg('path', { d: 'M0,0L10,5L0,10Z', class: `dash-arrow ${tone}` })); defs.append(marker);
    }
    diagram.append(defs);
    const centre = (n: ChainNode) => [NODE_POS[n][0] + NODE_W / 2, NODE_POS[n][1] + NODE_H / 2] as const;
    const edgePoint = (n: ChainNode, toward: readonly [number, number]) => {
      const [cx, cy] = centre(n), dx = toward[0] - cx, dy = toward[1] - cy, sx = NODE_W / 2 / (Math.abs(dx) || 1e-6), sy = NODE_H / 2 / (Math.abs(dy) || 1e-6), s = Math.min(sx, sy);
      return [cx + dx * s, cy + dy * s] as const;
    };
    const labels: SVGElement[] = [];
    for (const flow of chain.flows) {
      const tone = flow.quantity ? flow.commodity : 'idle';
      let a = edgePoint(flow.from, centre(flow.to)), b = edgePoint(flow.to, centre(flow.from)), d: string, mid: [number, number];
      if (flow.from === 'factory' && flow.to === 'outside') { // route under the shop
        a = [centre('factory')[0], NODE_POS.factory[1] + NODE_H]; b = [centre('outside')[0], NODE_POS.outside[1] + NODE_H];
        d = `M${a[0]},${a[1]}C${a[0]},${a[1] + 30} ${b[0]},${b[1] + 30} ${b[0]},${b[1] + 4}`; mid = [(a[0] + b[0]) / 2, a[1] + 22];
      } else { d = `M${a[0]},${a[1]}L${b[0]},${b[1]}`; mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
      diagram.append(svg('path', { d, class: `dash-flow ${tone}`, 'stroke-width': (flow.quantity ? 2 + 4 * flow.quantity / max : 1.5).toFixed(1), 'marker-end': `url(#dash-arrow-${tone})` }));
      if (flow.quantity) {
        const g = svg('g', { class: 'dash-flow-label' }), text = svg('text', { x: mid[0], y: mid[1] + 4, 'text-anchor': 'middle' });
        text.textContent = flow.quantity.toLocaleString('th-TH');
        g.append(svg('rect', { x: mid[0] - 22, y: mid[1] - 9, width: 44, height: 18, rx: 9 }), text); labels.push(g);
      }
    }
    for (const node of Object.keys(NODE_POS) as ChainNode[]) {
      const [x, y] = NODE_POS[node], g = svg('g', { class: `dash-node ${node}` });
      const name = svg('text', { x: x + NODE_W / 2, y: y + 20, 'text-anchor': 'middle', class: 'dash-node-name' }); name.textContent = NODE_NAMES[node];
      const sub = svg('text', { x: x + NODE_W / 2, y: y + 37, 'text-anchor': 'middle', class: 'dash-node-sub' });
      sub.textContent = node === 'outside' ? 'นำเข้า/ส่งออก' : node === 'farm' ? `เก็บ ${chain.harvested}` : node === 'factory' ? `ผลิต ${chain.produced}` : `${count(node)} ${node === 'household' ? 'ครัวเรือน' : 'แห่ง'}`;
      g.append(svg('rect', { x, y, width: NODE_W, height: NODE_H, rx: 12 }), name, sub); diagram.append(g);
    }
    diagram.append(...labels);
    const legend = el('div', 'dash-legend'); legend.append(el('span', 'dash-key crops', 'พืชผล (ล็อต)'), el('span', 'dash-key goods', 'สินค้าสำเร็จรูป (หน่วย)'), el('span', 'dash-key idle', 'ไม่มีการไหลในช่วงนี้'));
    const list = el('ul', 'dash-flow-list');
    for (const flow of chain.flows) {
      const item = el('li', flow.quantity ? '' : 'idle'); item.dataset.flow = `${flow.from}-${flow.to}`;
      item.append(el('span', `dash-key ${flow.quantity ? flow.commodity : 'idle'}`, `${NODE_NAMES[flow.from]} → ${NODE_NAMES[flow.to]}`), el('strong', '', `${flow.quantity.toLocaleString('th-TH')} ${flow.commodity === 'crops' ? 'ล็อต' : 'หน่วย'}`));
      list.append(item);
    }
    const summary = el('p', 'dash-note-line', `เก็บเกี่ยว ${chain.harvested} ล็อต · แปรรูป ${chain.processed} ล็อต เป็นสินค้า ${chain.produced} หน่วย · วันที่ ${chain.window.fromTick}–${chain.window.toTick}`);
    // One row per farm-to-table line: grown, made and sold in the window.
    const lines = el('ul', 'dash-flow-list dash-goods');
    for (const line of goodsLines(city)) {
      const active = line.farms + line.factories > 0, item = el('li', active ? '' : 'idle'); item.dataset.recipe = line.recipe;
      item.append(el('span', `dash-key ${active ? 'goods' : 'idle'}`, `${CROP_LABELS[line.crop]} → ${PRODUCT_LABELS[line.product]}`),
        el('strong', '', active ? `ฟาร์ม ${line.farms} · ${RECIPE_LABELS[line.recipe]} ${line.factories} · เก็บ ${line.harvested} · ผลิต ${line.produced} · ขาย ${line.sold + line.freshSold}${line.imported ? ` · นำเข้า ${line.imported}` : ''}${line.exportedCrops ? ` · ส่งออกพืช ${line.exportedCrops}` : ''}` : `ยังไม่มี · เลือกปลูก${CROP_LABELS[line.crop]}ที่ฟาร์ม`));
      lines.append(item);
    }
    this.chain.replaceChildren(this.head('ห่วงโซ่สินค้า 30 วัน', 'พาณิชย์ทั้งสองช่องคือกิจการเดียวกัน แยกแสดงตามสินค้า ไม่ใช่จำนวนกิจการที่ต้องบวกกัน'), diagram, legend, summary, lines, list, this.chart('crops', series), this.chart('goods', series));
  }

  private renderGrowth(city: City, series: DailySeries) {
    const o = cityOverview(city), idle = Math.max(0, o.workforce - o.employeeWorkers - o.selfEmployedWorkers);
    const ICON = { shop: 'shop', I: 'I', R: 'R', F: 'F', market: 'market' } as const;
    const mix = el('div', 'dash-mix');
    mix.append(
      mixBar(BUILDING_ORDER.map((kind, i) => ({ key: kind, label: BUILDING_NAMES[kind], value: series.buildings[kind].at(-1) ?? 0, slot: i + 1, icon: ICON[kind] })), v => `${v.toLocaleString('th-TH')} หลัง`, 'อาคารตอนนี้'),
      mixBar([
        { key: 'employee', label: 'ลูกจ้าง', value: o.employeeWorkers, slot: 1, icon: 'worker' }, { key: 'owner', label: 'ทำกิจการเอง', value: o.selfEmployedWorkers, slot: 2, icon: 'market' },
        { key: 'idle', label: 'ว่างงาน', value: idle, slot: 3, icon: 'idle' }, { key: 'dependents', label: 'ผู้พึ่งพิง', value: o.dependents, slot: 4, icon: 'dependents' },
      ], v => `${v.toLocaleString('th-TH')} คน`, 'ประชากรตามบทบาท'),
    );
    this.growth.replaceChildren(this.head('การเติบโตของเมือง', 'อาคารที่ยังอยู่ · ประชากรจากวันที่ย้ายเข้า'), this.chart('population', series), this.chart('buildings', series), mix);
  }
}

export type { ChainFlow };
