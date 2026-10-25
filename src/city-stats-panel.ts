/**
 * Wide translucent "city stats" overlay: every headline number on one screen over the map,
 * grouped into services, buildings, people and labour, and stocks. Read-only.
 */
import './city-stats.css';
import { cityStats, BUILDING_KINDS, STATS_WINDOW, type BuildingKind, type CityStats, type SkillKey } from './city-stats.ts';

const ICONS: Record<string, string> = {
  power: '<path d="M13 2 5 13h6l-1 9 8-11h-6z" fill="currentColor"/>',
  water: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" fill="currentColor"/>',
  road: '<path d="M8 2h8l3 20H5z" fill="currentColor" opacity=".5"/><path d="M12 4v3m0 4v3m0 4v3" stroke="currentColor" stroke-width="2"/>',
  coin: '<circle cx="12" cy="12" r="8" fill="currentColor" opacity=".35"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" stroke="currentColor" stroke-width="2" fill="none"/>',
  R: '<path d="M3 11 12 4l9 7v9H3z" fill="currentColor"/><path d="M10 14h4v6h-4z" fill="#0b1a20"/>',
  market: '<path d="M3 9h18v11H3z" fill="currentColor" opacity=".55"/><path d="M2 9 5 4h14l3 5z" fill="currentColor"/><path d="M7 13h4v3H7zM13 13h4v3h-4z" fill="#0b1a20"/>',
  shop: '<path d="M4 8h16v12H4z" fill="currentColor"/><path d="M3 4h18v5H3z" fill="currentColor" opacity=".6"/><path d="M7 12h4v8H7zM14 12h3v4h-3z" fill="#0b1a20"/>',
  I: '<path d="M3 20V11l5-3v3l5-3v3l5-3V4h3v16z" fill="currentColor"/>',
  F: '<path d="M3 15h18v5H3z" fill="currentColor" opacity=".55"/><path d="M12 15V6m0 4c-3 0-4-3-4-3 3-1 4 3 4 3m0-1c3 0 4-3 4-3-3-1-4 3-4 3" stroke="currentColor" stroke-width="2" fill="none"/>',
  people: '<circle cx="9" cy="8" r="3" fill="currentColor"/><circle cx="16" cy="9" r="2.5" fill="currentColor" opacity=".7"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6zM14 20c0-2 .5-4 2-5 3 0 5 2 5 5z" fill="currentColor"/>',
  household: '<path d="M4 11 12 5l8 6v9H4z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="14" r="1.8" fill="currentColor"/><circle cx="14.5" cy="15" r="1.4" fill="currentColor"/>',
  worker: '<path d="M6 11a6 6 0 0 1 12 0z" fill="currentColor"/><path d="M5 11h14v2H5z" fill="currentColor"/><path d="M8 15a4 4 0 0 0 8 0z" fill="currentColor" opacity=".7"/>',
  idle: '<circle cx="12" cy="8" r="3.5" fill="currentColor"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7z" fill="currentColor" opacity=".55"/><path d="M17 3h4l-4 4h4" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  dependents: '<circle cx="12" cy="9" r="3" fill="currentColor"/><path d="M7 20c0-3 2-6 5-6s5 3 5 6z" fill="currentColor" opacity=".6"/>',
  homeless: '<path d="M4 11 12 5l8 6" stroke="currentColor" stroke-width="2" fill="none"/><path d="M6 20 18 8" stroke="currentColor" stroke-width="2"/>',
  general: '<path d="m5 19 7-7m2-6 4 4-3 3-4-4z" stroke="currentColor" stroke-width="2.2" fill="none"/>',
  manufacturing: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" stroke="currentColor" stroke-width="2"/>',
  retail: '<path d="M5 7h14l-1.5 9h-11z" fill="currentColor" opacity=".6"/><path d="M3 4h3l2 12h10" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="9" cy="19" r="1.5" fill="currentColor"/><circle cx="16" cy="19" r="1.5" fill="currentColor"/>',
  crop: '<path d="M12 21V9" stroke="currentColor" stroke-width="2"/><ellipse cx="9" cy="10" rx="2.2" ry="3.6" transform="rotate(-25 9 10)" fill="currentColor"/><ellipse cx="15" cy="10" rx="2.2" ry="3.6" transform="rotate(25 15 10)" fill="currentColor"/><ellipse cx="12" cy="5.5" rx="2" ry="3" fill="currentColor"/>',
  box: '<path d="M3 8 12 3l9 5v9l-9 5-9-5z" fill="currentColor" opacity=".55"/><path d="M3 8l9 5 9-5M12 13v9" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  import: '<path d="M12 3v12m-5-5 5 5 5-5M4 20h16" stroke="currentColor" stroke-width="2.2" fill="none"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5M4 20h16" stroke="currentColor" stroke-width="2.2" fill="none"/>',
  consume: '<path d="M7 3v8a3 3 0 0 0 3 3v7m4-18c-2 0-3 3-3 6s1 4 3 4v8" stroke="currentColor" stroke-width="2" fill="none"/>',
  gear: '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4" stroke="currentColor" stroke-width="2.4"/>',
};
const KIND_LABEL: Record<BuildingKind, string> = { R: 'บ้าน', market: 'ตลาด', shop: 'ร้าน', I: 'โรงงาน', F: 'ฟาร์ม' };
const SKILL_LABEL: Record<SkillKey, string> = { general: 'ทั่วไป', manufacturing: 'การผลิต', retail: 'ค้าปลีก' };
const JOB_LABEL = { I: 'โรงงาน', F: 'ฟาร์ม', shop: 'ร้านค้า', market: 'ตลาด' } as const;
const n = (value: number) => value.toLocaleString('th-TH');
const baht = (satang: number) => `${Math.round(satang / 100).toLocaleString('th-TH')} ฿`;
const signedBaht = (satang: number) => (satang > 0 ? '+' : satang < 0 ? '−' : '') + baht(Math.abs(satang));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
}
function icon(name: string, tone = ''): HTMLElement {
  const span = el('span', `st-icon ${tone}`.trim()); span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${ICONS[name] ?? ''}</svg>`; return span;
}
/** One row: icon, label, value, optional sub-value and a bar of `share` (0–1). */
function row(name: string, label: string, value: string, opts: { tone?: string; sub?: string; share?: number; bar?: string; key?: string } = {}): HTMLElement {
  const item = el('div', `st-row ${opts.tone ?? ''}`.trim()); item.title = label; if (opts.key) item.dataset.stat = opts.key;
  const text = el('div', 'st-row-text'), head = el('div', 'st-row-head');
  head.append(el('span', 'st-label', label), el('strong', 'st-value', value)); text.append(head);
  if (opts.sub) text.append(el('small', 'st-sub', opts.sub));
  if (opts.share !== undefined) { const bar = el('span', `st-bar ${opts.bar ?? ''}`.trim()); bar.style.setProperty('--share', Math.max(0, Math.min(1, opts.share)).toFixed(3)); text.append(bar); }
  item.append(icon(name, opts.tone), text); return item;
}
function column(title: string, key: string, ...children: HTMLElement[]): HTMLElement {
  const col = el('section', 'st-col'); col.dataset.column = key; col.append(el('h3', 'st-col-title', title), ...children); return col;
}

export class CityStatsPanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly stamp: HTMLElement;
  private key = '';
  open = false;
  constructor(private readonly onToggle: (open: boolean) => void = () => {}) {
    this.root = el('div', 'city-stats'); this.root.id = 'city-stats'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', 'สถิติเมือง');
    const bar = el('header', 'st-titlebar'), title = el('h2', 'st-title', 'สถิติเมือง'), close = el('button', 'st-close', '✕');
    this.stamp = el('span', 'st-stamp'); close.type = 'button'; close.id = 'close-city-stats'; close.setAttribute('aria-label', 'ปิดสถิติเมือง');
    close.addEventListener('click', () => this.toggle(false));
    bar.append(title, this.stamp, close); this.body = el('div', 'st-body'); this.root.append(bar, this.body);
    document.body.append(this.root);
  }
  toggle(open = !this.open) {
    this.open = open; this.root.hidden = !open; this.key = ''; this.onToggle(open);
  }
  update(city: Parameters<typeof cityStats>[0]) {
    if (!this.open) return;
    const key = `${city.tick}:${city.ledger.length}:${city.buildings.length}:${city.households.length}`;
    if (key === this.key) return; this.key = key;
    const s = cityStats(city); this.stamp.textContent = `วันที่ ${s.tick} · ยอดไหล ${STATS_WINDOW} วันล่าสุด`;
    this.body.replaceChildren(this.services(s), this.buildings(s), this.people(s), this.stocks(s));
  }
  private services(s: CityStats) {
    const v = s.services;
    return column('บริการและการเงิน', 'services',
      row('power', 'ไฟฟ้า', v.power ? 'พร้อม' : 'ขาด', { tone: v.power ? 'power' : 'bad', sub: 'จากภายนอก', share: v.power ? 1 : 0, bar: v.power ? 'power' : 'bad', key: 'power' }),
      row('water', 'น้ำประปา', v.water ? 'พร้อม' : 'ขาด', { tone: v.water ? 'water' : 'bad', sub: 'จากภายนอก', share: v.water ? 1 : 0, bar: v.water ? 'water' : 'bad', key: 'water' }),
      row('road', 'ถนน', `${n(v.connectedRoads)} / ${n(v.roads)}`, { sub: `เชื่อมประตูเมือง · บำรุง ${baht(v.upkeepPerDay)}/วัน`, share: v.roads ? v.connectedRoads / v.roads : 0, key: 'roads' }),
      row('link', 'อาคารขาดถนน', n(v.disconnectedBuildings), { tone: v.disconnectedBuildings ? 'bad' : 'good', key: 'disconnected' }),
      el('div', 'st-divider'),
      row('coin', 'เงินคลัง', baht(v.treasury), { tone: 'money', key: 'treasury' }),
      row('import', 'รายรับ 30 วัน', baht(v.income), { tone: 'good', share: v.income + v.expense ? v.income / (v.income + v.expense) : 0, bar: 'good', key: 'income' }),
      row('export', 'รายจ่าย 30 วัน', baht(v.expense), { tone: 'bad', share: v.income + v.expense ? v.expense / (v.income + v.expense) : 0, bar: 'bad', key: 'expense' }),
      row('coin', 'สุทธิ 30 วัน', signedBaht(v.net), { tone: v.net < 0 ? 'bad' : 'good', key: 'net' }),
    );
  }
  private buildings(s: CityStats) {
    const table = el('table', 'st-table'), head = el('tr');
    head.append(el('th', '', 'ระดับ'));
    for (const kind of BUILDING_KINDS) { const th = el('th', `zone-${kind}`); th.title = KIND_LABEL[kind]; th.append(icon(kind, `zone-${kind}`), el('span', 'st-th-label', KIND_LABEL[kind])); head.append(th); }
    const thead = el('thead'); thead.append(head); const tbody = el('tbody');
    for (const level of s.buildings.levels) {
      const tr = el('tr'); tr.append(el('th', '', `${level}`));
      for (const kind of BUILDING_KINDS) { const v = s.buildings.rows[level][kind]; tr.append(el('td', v ? '' : 'zero', n(v))); }
      tbody.append(tr);
    }
    if (!s.buildings.levels.length) { const tr = el('tr'), td = el('td', 'zero', 'ยังไม่มีอาคาร'); td.colSpan = BUILDING_KINDS.length + 1; tr.append(td); tbody.append(tr); }
    const foot = el('tr', 'st-total'); foot.append(el('th', '', 'รวม'));
    for (const kind of BUILDING_KINDS) foot.append(el('td', '', n(s.buildings.totals[kind])));
    const tfoot = el('tfoot'); tfoot.append(foot); table.append(thead, tbody, tfoot);
    const wrap = el('div', 'st-table-wrap'); wrap.append(table);
    return column(`อาคาร ${n(s.buildings.all)} หลัง`, 'buildings', wrap, el('p', 'st-note', 'แถวคือระดับอาคาร สูงขึ้นเมื่อเติบโต ตลาดคือพาณิชย์ระดับ 1 ที่ซื้อขายพืชผล'));
  }
  private people(s: CityStats) {
    const p = s.people, labour = el('div', 'st-grid'), jobs = el('div', 'st-jobs');
    for (const skill of s.labour) labour.append(row(skill.skill, SKILL_LABEL[skill.skill], `${n(skill.employed + skill.owners)} / ${n(skill.supply)}`, { sub: `ว่าง ${n(skill.idle)} คน${skill.owners ? ` · เจ้าของ ${n(skill.owners)}` : ''}`, share: skill.supply ? (skill.employed + skill.owners) / skill.supply : 0, key: `skill-${skill.skill}` }));
    const jobTable = el('table', 'st-table st-job-table'), jh = el('tr');
    for (const label of ['งาน', 'กิจการ', 'คนทำ / รับได้', 'ค่าจ้าง/เดือน']) jh.append(el('th', '', label));
    const jhead = el('thead'); jhead.append(jh); const jbody = el('tbody');
    for (const job of s.jobs) {
      const tr = el('tr'), name = el('th'); name.append(icon(job.kind, `zone-${job.kind}`), el('span', '', JOB_LABEL[job.kind]));
      const fill = el('td', job.capacity && job.workers < job.capacity ? 'warn' : ''); fill.textContent = `${n(job.workers)} / ${n(job.capacity)}`;
      tr.append(name, el('td', job.firms ? '' : 'zero', n(job.firms)), fill, el('td', job.wage ? '' : 'zero', job.wage ? baht(job.wage) : 'เจ้าของทำเอง')); jbody.append(tr);
    }
    jobTable.append(jhead, jbody); jobs.append(jobTable);
    const top = el('div', 'st-people-top'); top.append(
      row('people', 'ประชากร', `${n(p.population)} คน`, { sub: `${n(p.households)} ครัวเรือน`, key: 'population' }),
      row('worker', 'มีงานทำ', `${n(p.employed)} / ${n(p.workforce)}`, { sub: 'จากแรงงานทั้งหมด', share: p.workforce ? p.employed / p.workforce : 0, bar: 'good', key: 'employed' }),
      row('idle', 'ว่างงาน', `${n(p.unemployed)} คน`, { tone: p.unemployed ? 'warn' : 'good', key: 'unemployed' }),
      row('dependents', 'ผู้พึ่งพิง', `${n(p.dependents)} คน`, { key: 'dependents' }),
      row('household', 'ที่พักอาศัย', `${n(p.occupiedPersons)} / ${n(p.personCapacity)}`, { sub: `บ้าน ${n(p.occupiedHomes)} / ${n(p.homeSlots)} ช่อง`, share: p.personCapacity ? p.occupiedPersons / p.personCapacity : 0, key: 'housing' }),
      row('homeless', 'ไร้บ้าน', `${n(p.homeless)} ครัวเรือน`, { tone: p.homeless ? 'bad' : 'good', sub: p.homeless ? `${n(p.homelessPersons)} คน` : undefined, key: 'homeless' })
    );
    return column('ประชากรและแรงงาน', 'people', top,
      el('h4', 'st-subtitle', 'แรงงานตามทักษะ'), labour,
      el('h4', 'st-subtitle', 'งานและค่าจ้าง'), jobs,
    );
  }
  private stocks(s: CityStats) {
    const k = s.stocks;
    return column('ทรัพยากรและสินค้า', 'stocks',
      el('h4', 'st-subtitle first', 'พืชผลคงคลัง (ล็อต)'),
      row('F', 'ที่ฟาร์ม', n(k.crops.farm), { tone: 'zone-F', key: 'crop-farm' }),
      row('market', 'ที่ตลาด', n(k.crops.market), { tone: 'zone-market', key: 'crop-market' }),
      row('I', 'รอแปรรูปที่โรงงาน', n(k.crops.factory), { tone: 'zone-I', key: 'crop-factory' }),
      el('h4', 'st-subtitle', 'สินค้าสำเร็จรูป (หน่วย)'),
      row('box', 'ที่โรงงาน', n(k.goods.factory), { tone: 'goods', key: 'goods-factory' }),
      row('shop', 'บนชั้นร้านค้า', n(k.goods.shop), { tone: 'zone-shop', key: 'goods-shop' }),
      el('h4', 'st-subtitle', `การไหล ${STATS_WINDOW} วัน`),
      row('crop', 'เก็บเกี่ยว', `${n(k.harvested)} ล็อต`, { tone: 'zone-F', key: 'harvested' }),
      row('gear', 'แปรรูป', `${n(k.processed)} ล็อต`, { sub: `ได้สินค้า ${n(k.produced)} หน่วย`, tone: 'zone-I', key: 'processed' }),
      row('consume', 'ครัวเรือนใช้', `${n(k.consumed)} หน่วย`, { key: 'consumed' }),
      row('import', 'นำเข้า', `${n(k.imported)} หน่วย`, { key: 'imported' }),
      row('export', 'ส่งออก', `${n(k.exported)} หน่วย`, { tone: 'goods', key: 'exported' }),
    );
  }
}
