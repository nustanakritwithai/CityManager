/**
 * City overview dashboard: section navigation, treasury trend and budget, and the
 * 30-day supply chain. Read-only views over overview-data projections.
 */
import { treasuryHistory, treasuryBudget, supplyChain, type ChainFlow, type ChainNode } from './overview-data.ts';
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
  ['dash-finance', 'การเงิน'], ['dash-chain', 'ห่วงโซ่สินค้า'], ['city-overview', 'ประชากรและงาน'],
  ['growth-anchor', 'ความต้องการ'], ['issue-section', 'ปัญหา'], ['event-log-section', 'เหตุการณ์'], ['money-section', 'บัญชี'],
];
const NODE_NAMES: Record<ChainNode, string> = { farm: 'ฟาร์ม', market: 'ตลาด', factory: 'โรงงาน', shop: 'ร้านค้า', household: 'ครัวเรือน', outside: 'ภายนอก' };
const NODE_POS: Record<ChainNode, [number, number]> = { farm: [14, 18], market: [174, 18], household: [334, 104], factory: [14, 190], shop: [174, 190], outside: [334, 190] };
const NODE_W = 92, NODE_H = 48;

export class OverviewDashboard {
  private readonly host: HTMLElement;
  private readonly finance = el('section', 'dash-card dash-finance');
  private readonly chain = el('section', 'dash-card dash-chain');
  private key = '';

  constructor(host: HTMLElement) {
    this.host = host;
    this.finance.id = 'dash-finance'; this.chain.id = 'dash-chain';
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
    host.replaceChildren(nav, this.finance, this.chain);
  }

  /** Rebuild once per simulated day; the navigation stays put so a press is never detached. */
  update(city: City) {
    const key = `${city.tick}:${city.ledger.length}:${city.cropLedger.length}:${city.goodsLedger.length}`;
    if (key === this.key) return;
    this.key = key;
    this.renderFinance(city); this.renderChain(city);
  }

  private head(title: string, note: string) {
    const head = el('header', 'dash-head'); head.append(el('h3', '', title), el('span', 'dash-note', note)); return head;
  }

  private renderFinance(city: City) {
    const history = treasuryHistory(city), budget = treasuryBudget(city), now = history.at(-1)!.balance;
    const hero = el('div', 'dash-hero');
    const value = el('strong', 'dash-hero-value', money(now)), delta = el('span', `dash-delta ${budget.net < 0 ? 'bad' : budget.net > 0 ? 'good' : ''}`, `${signed(budget.net)} ใน 30 วัน`);
    hero.append(el('span', 'dash-hero-label', 'เงินคลังเมือง'), value, delta);
    const chart = this.trend(history);
    const lines = el('div', 'dash-budget');
    const max = Math.max(1, ...budget.income.map(l => l.amount), ...budget.expense.map(l => l.amount));
    const column = (title: string, items: typeof budget.income, tone: 'good' | 'bad') => {
      const box = el('div', `dash-budget-col ${tone}`); box.append(el('h4', '', title));
      if (!items.length) box.append(el('p', 'dash-empty', 'ไม่มีในช่วงนี้'));
      for (const line of items) {
        const row = el('div', 'dash-bar-row'); row.dataset.budget = line.key;
        const bar = el('span', 'dash-bar'); bar.style.setProperty('--share', String(line.amount / max));
        row.append(el('span', 'dash-bar-label', line.label), bar, el('span', 'dash-bar-value', money(line.amount)));
        box.append(row);
      }
      return box;
    };
    lines.append(column('รายรับคลัง', budget.income, 'good'), column('รายจ่ายคลัง', budget.expense, 'bad'));
    this.finance.replaceChildren(this.head('การเงินของเมือง', `วันที่ ${history[0].tick}–${city.tick}`), hero, chart, lines);
  }

  private trend(points: { tick: number; balance: number }[]) {
    const W = 440, H = 120, pad = 6, figure = el('figure', 'dash-trend');
    const values = points.map(p => p.balance), min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const x = (i: number) => pad + (points.length > 1 ? i / (points.length - 1) : 1) * (W - pad * 2), y = (v: number) => H - pad - (v - min) / span * (H - pad * 2 - 10);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join('');
    const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `เงินคลัง 30 วัน ต่ำสุด ${money(min)} สูงสุด ${money(max)} ล่าสุด ${money(values.at(-1)!)}` });
    for (const g of [0, .5, 1]) chart.append(svg('line', { x1: pad, x2: W - pad, y1: y(min + span * g), y2: y(min + span * g), class: 'dash-grid' }));
    chart.append(svg('path', { d: `${line}L${x(points.length - 1)},${H - pad}L${x(0)},${H - pad}Z`, class: 'dash-area' }), svg('path', { d: line, class: 'dash-line' }));
    chart.append(svg('circle', { cx: x(points.length - 1), cy: y(values.at(-1)!), r: 4, class: 'dash-dot' }));
    const caption = el('figcaption', 'dash-trend-caption');
    caption.append(el('span', '', `วันที่ ${points[0].tick} · ต่ำสุด ${money(min)}`), el('span', '', `สูงสุด ${money(max)}`));
    figure.append(chart, caption); return figure;
  }

  private renderChain(city: City) {
    const chain = supplyChain(city), max = Math.max(1, ...chain.flows.map(f => f.quantity));
    const count = (kind: ChainNode) => kind === 'household' ? city.households.length : kind === 'outside' ? 0
      : city.firms.filter(f => kind === 'farm' ? f.zone === 'F' : kind === 'factory' ? f.zone === 'I' : f.zone === 'C' && (kind === 'market') === (f.commercialKind === 'market')).length;
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
    this.chain.replaceChildren(this.head('ห่วงโซ่สินค้า 30 วัน', 'จากบันทึกพืชผลและสินค้าจริง'), diagram, legend, summary, list);
  }
}

export type { ChainFlow };
