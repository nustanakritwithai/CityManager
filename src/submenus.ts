import { iconElement } from './ui-icons.ts';
import { GAME_VERSION } from './version.ts';
import './submenus.css';
import { MONTH, SIZE, ROAD_COST, utilityStatus, type City } from './sim.ts';
import { flowRows, cropFlowRows, walletGroups, formatMoney, type FlowKind, type FlowRow, type CropFlowRow } from './inspector-data.ts';

const BASE = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
type JournalKind = FlowKind | 'crops';
type JournalRow = FlowRow | CropFlowRow;
type Journal = {
  kind: JournalKind; initial: number; limit: number; count: HTMLElement; scope: HTMLElement; list: HTMLElement;
  more: HTMLButtonElement; all: HTMLButtonElement; recent: HTMLButtonElement; revision: string;
  expanded: Map<number, string>; heldPointers: Set<number>; heldKeys: Set<string>;
  releaseBarrier: boolean; pending: boolean; flushTimer: ReturnType<typeof setTimeout> | null;
};
const journals = new Map<JournalKind, Journal>();
let ready = false, current: City | null = null, selection: number | null = null, walletRevision = '';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag); value.className = className; if (text !== undefined) value.textContent = text; return value;
}
function root(id: string): HTMLElement { const found = document.getElementById(id); if (!found) throw new Error(`Missing submenu root: #${id}`); return found; }
function image(name: string): HTMLImageElement { const img = element('img'); img.src = `${BASE}assets/kenney-ui/${name}.png`; img.alt = ''; img.decoding = 'async'; return img; }
function svg(kind: string): SVGElement {
  const shapes: Record<string, string> = {
    money: '<rect x="12" y="19" width="48" height="36" rx="7"/><path d="M17 19v-7h35v7M44 31h16v13H44z"/><circle cx="49" cy="37" r="1"/>',
    goods: '<path d="m12 23 24-12 24 12-24 13zM12 23v28l24 12 24-12V23M36 36v27M24 17l24 13"/>',
    wallets: '<rect x="12" y="20" width="48" height="36" rx="6"/><path d="M18 20v-8h34v8M43 32h17v12H43zM19 44h13"/>',
    road: '<path d="M23 8v56M49 8v56M36 9v9m0 9v9m0 9v9M8 48h15m26 0h15"/><circle cx="13" cy="48" r="4"/>',
    zones: '<path d="M10 16h23v22H10zM39 16h23v22H39zM10 44h23v22H10zM39 44h23v22H39zM16 30l5-5 6 5M45 27h11M51 21v12"/>',
    growth: '<path d="M12 60V35l13-10 13 10v25M38 60V19h22v41M6 60h60M44 28h4m6 0h2m-12 9h4m6 0h2M21 45h8v15"/>',
    view: '<path d="M14 11h44v47H14zM14 43h44M24 21h24v16H24zM27 64h18M36 58v6M7 23v17M65 23v17"/>',
    calendar: '<rect x="12" y="15" width="48" height="47" rx="5"/><path d="M12 29h48M24 8v15M48 8v15M23 39h6m13 0h6M23 49h6m13 0h6"/>',
    utilities: '<path d="m25 7-13 28h14l-6 27 24-36H29l7-19M53 33c-14 17-14 27 0 27s14-10 0-27z"/>',
    limits: '<path d="M12 14h48v48H12zM12 30h48M12 46h48M28 14v48M44 14v48"/>',
    outside: '<circle cx="36" cy="36" r="25"/><path d="M11 36h50M36 11c-15 14-15 36 0 50 15-14 15-36 0-50M19 20c10 7 24 7 34 0M19 52c10-7 24-7 34 0"/>',
    arrow: '<path d="M12 36h48M46 22l14 14-14 14"/>',
  };
  const host = element('div'); host.innerHTML = `<svg viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[kind] ?? shapes.wallets}</svg>`; return host.firstElementChild as SVGElement;
}
function scopeText(journal = true): string { return selection === null ? journal ? 'ข้อมูลทั้งเมือง · เรียงจากรายการล่าสุด' : 'ข้อมูลทั้งเมือง · แยกตามประเภทบัญชี' : 'ข้อมูลทั้งเมือง · ไม่ได้กรองตามสถานที่ที่เลือก'; }
function intro(kind: string, title: string, description: string): HTMLElement {
  const intro = element('p', 'sm-intro', description); Object.assign(intro.dataset, { sectionTitle: title, symbol: kind }); return intro;
}
function rowIdentity(row: Pick<FlowRow, 'tick' | 'from' | 'to' | 'value' | 'reason'>): string {
  return JSON.stringify([row.tick, row.from, row.to, row.value, row.reason]);
}
function rememberExpanded(state: Journal) {
  for (const card of state.list.querySelectorAll<HTMLDetailsElement>('details.sm-flow-card')) {
    const index = Number(card.dataset.index);
    if (card.open) state.expanded.set(index, rowIdentity({ tick: Number(card.dataset.tick), from: card.dataset.from!, to: card.dataset.to!, value: Number(card.dataset.value), reason: card.dataset.reason! }));
    else state.expanded.delete(index);
  }
}
function clearJournalInput(state: Journal) {
  state.heldPointers.clear(); state.heldKeys.clear(); state.releaseBarrier = false; state.pending = false;
  if (state.flushTimer !== null) clearTimeout(state.flushTimer); state.flushTimer = null;
}
function flushJournalAfterActivation(state: Journal, waitForClick = false) {
  // Touch may send its compatibility click in a later task. Keep the original
  // node until that trusted click finishes; the bounded fallback handles aborts.
  state.releaseBarrier = true;
  if (state.flushTimer !== null) clearTimeout(state.flushTimer);
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null; state.releaseBarrier = false;
    if (state.heldPointers.size || state.heldKeys.size || !state.pending) return;
    state.pending = false; rememberExpanded(state); updateJournal(state);
  }, waitForClick ? 750 : 0);
}
function installJournalInputGuard(state: Journal) {
  state.list.addEventListener('pointerdown', event => {
    if (event.isTrusted && event.target instanceof Element && event.target.closest('.sm-flow-toggle')) state.heldPointers.add(event.pointerId);
  }, true);
  state.list.addEventListener('keydown', event => {
    if (event.isTrusted && (event.key === ' ' || event.key === 'Enter') && event.target instanceof Element && event.target.closest('.sm-flow-toggle')) state.heldKeys.add(event.key);
  }, true);
  document.addEventListener('pointerup', event => { if (state.heldPointers.delete(event.pointerId)) flushJournalAfterActivation(state, true); }, true);
  document.addEventListener('pointercancel', event => { if (state.heldPointers.delete(event.pointerId)) flushJournalAfterActivation(state); }, true);
  document.addEventListener('keyup', event => { if (state.heldKeys.delete(event.key)) flushJournalAfterActivation(state, event.key === ' '); }, true);
  document.addEventListener('click', event => { if (event.isTrusted && state.releaseBarrier) flushJournalAfterActivation(state); }, true);
  window.addEventListener('blur', () => {
    if (state.heldPointers.size || state.heldKeys.size || state.releaseBarrier) { state.heldPointers.clear(); state.heldKeys.clear(); flushJournalAfterActivation(state); }
  });
}
function action(label: string, kind: JournalKind, name: string): HTMLButtonElement {
  const button = element('button', `sm-button${name === 'more' ? ' primary' : ''}`, label); button.type = 'button'; button.dataset.journalAction = name; button.dataset.kind = kind; return button;
}
function setupJournal(kind: JournalKind, id: string, initial: number) {
  const host = root(id); host.classList.add('sm-content', 'sm-journal'); host.dataset.scope = 'city';
  const scope = element('p', 'sm-scope', scopeText()), count = element('span', 'sm-count'), order = element('span', 'sm-order', 'ใหม่ → เก่า');
  const countbar = element('div', 'sm-countbar'); countbar.append(count, order);
  const list = element('div', 'sm-journal-list'); list.dataset.journal = kind;
  const more = action(`ดูเพิ่ม ${initial} รายการ`, kind, 'more'), all = action('ดูทั้งหมด', kind, 'all'), recent = action('กลับรายการล่าสุด', kind, 'recent');
  const buttons = element('div', 'sm-pagination'); buttons.append(more, all, recent);
  const note = element('p', 'sm-footnote', kind === 'money' ? 'แต่ละรายการหักต้นทางและเพิ่มปลายทางด้วยจำนวนเงินเดียวกัน ยอดเป็นบาทและสตางค์' : kind === 'crops' ? 'บัญชีนี้ใช้หน่วยล็อตพืชผล แยกจากสินค้าสำเร็จรูป แสดงมูลค่าที่ตัด/เพิ่มสต็อกและเงินจริงตามแต่ละเหตุการณ์' : 'หน่วยสินค้าสำเร็จรูปเป็นหน่วยนามธรรมของต้นแบบ การตัดสต็อกจากการรื้อถอนไม่ใช่รายได้ขายสินค้า');
  host.replaceChildren(scope, countbar, list, buttons, note);
  const state: Journal = { kind, initial, limit: initial, count, scope, list, more, all, recent, revision: '', expanded: new Map(), heldPointers: new Set(), heldKeys: new Set(), releaseBarrier: false, pending: false, flushTimer: null }; journals.set(kind, state); installJournalInputGuard(state);
  more.addEventListener('click', () => { state.limit += initial; updateJournal(state); if (more.hidden) recent.focus(); });
  all.addEventListener('click', () => { state.limit = Infinity; updateJournal(state); recent.focus(); });
  recent.addEventListener('click', () => { state.limit = initial; updateJournal(state); if (!more.hidden) more.focus(); });
}
function eventCard(row: JournalRow, state: Journal): HTMLElement {
  const card = element('details', `sm-flow-card${row.kind === 'money' && row.to === 'treasury' ? ' income' : row.kind === 'money' && row.from === 'treasury' ? ' outgoing' : ''}`);
  Object.assign(card.dataset, { kind: row.kind, index: String(row.index), tick: String(row.tick), from: row.from, to: row.to, value: String(row.value), reason: row.reason });
  if (row.kind === 'crops') Object.assign(card.dataset, { id: String(row.id), cropKind: row.cropKind, fromValue: String(row.fromValue), toValue: String(row.toValue), cash: String(row.cash), workers: String(row.workers), batches: String(row.batches), outputQuantity: String(row.outputQuantity) });
  const top = element('summary', 'sm-flow-top sm-flow-toggle'), value = element('strong', 'sm-flow-value', row.kind === 'money' ? `${formatMoney(row.value)} ฿` : `${row.value.toLocaleString('th-TH')} ${row.kind === 'crops' ? 'ล็อตพืชผล' : 'หน่วย'}`);
  Object.assign(top.dataset, { journalRowToggle: '', kind: row.kind, index: String(row.index) });
    const direction = row.kind === 'crops' ? `บัญชีล็อตพืชผล #${row.id}` : row.kind === 'goods' ? 'ย้ายสินค้าสำเร็จรูป' : row.to === 'treasury' ? 'เข้าคลังเมือง' : row.from === 'treasury' ? 'ออกจากคลังเมือง' : 'โอนระหว่างบัญชี';
  const title = element('span', 'sm-event-title', row.label), badge = iconElement(row.kind === 'crops' ? 'crop' : row.kind === 'goods' ? 'box' : row.to === 'treasury' ? 'import' : row.from === 'treasury' ? 'export' : 'link', 'ui-icon sm-flow-direction');
  title.title = row.label; badge.title = direction; badge.removeAttribute('aria-hidden'); badge.setAttribute('role', 'img'); badge.setAttribute('aria-label', direction); top.append(badge, title, value);
  const body = element('div', 'sm-flow-details'); body.id = `sm-${row.kind}-entry-${row.index}`; top.setAttribute('aria-controls', body.id);
  const meta = element('p', 'sm-flow-meta', `วัน ${row.tick} · เดือน ${Math.floor(row.tick / MONTH) + 1} · รายการ #${row.index + 1} · ${direction}`), route = element('div', 'sm-flow-route');
  const from = element('div', 'sm-party'), to = element('div', 'sm-party'), arrow = element('span', 'sm-route-arrow'); arrow.append(svg('arrow')); arrow.setAttribute('aria-label', 'ไปยัง');
  from.append(element('small', '', 'ต้นทาง'), element('strong', '', row.fromLabel), element('code', '', row.from)); to.append(element('small', '', 'ปลายทาง'), element('strong', '', row.toLabel), element('code', '', row.to)); route.append(from, arrow, to);
  const reason = element('p', 'sm-flow-reason'); reason.append(element('span', '', 'เหตุผล: '), element('code', '', row.reason)); body.append(meta, route, reason); card.append(top, body);
  if (row.kind === 'crops') {
    body.append(element('p', 'sm-flow-meta', `มูลค่าตัดต้นทาง ${formatMoney(row.fromValue)} ฿ · มูลค่าเข้าสินค้าคงคลัง ${formatMoney(row.toValue)} ฿ · เงินโอน ${formatMoney(row.cash)} ฿`));
    if (row.cropKind === 'process') body.append(element('p', 'sm-flow-meta', `แปรรูป ${row.batches} ชุด → สินค้าสำเร็จรูป ${row.outputQuantity} หน่วย · แรงงาน ${row.workers} คน`));
  }
  const identity = rowIdentity(row), renderedCity = current;
  card.open = state.expanded.get(row.index) === identity; top.setAttribute('aria-expanded', String(card.open));
  card.addEventListener('toggle', () => {
    if (!card.isConnected || current !== renderedCity) return;
    top.setAttribute('aria-expanded', String(card.open));
    if (card.open) state.expanded.set(row.index, identity); else state.expanded.delete(row.index);
  });
  return card;
}
function empty(title: string, description: string, kind: string): HTMLElement {
  const card = element('div', 'sm-empty'); card.append(svg(kind), element('h4', '', title), element('p', '', description)); return card;
}
function updateJournal(state: Journal) {
  if (!current) return;
  state.scope.textContent = scopeText();
  if (state.heldPointers.size || state.heldKeys.size || state.releaseBarrier) { state.pending = true; return; }
  const rows: JournalRow[] = state.kind === 'crops' ? cropFlowRows(current) : flowRows(current, state.kind), shown = Math.min(rows.length, state.limit), revision = `${rows.length}:${shown}:${JSON.stringify(rows[0] ?? null)}`;
  if (revision === state.revision) return; state.revision = revision;
  rememberExpanded(state);
  const focused = document.activeElement instanceof HTMLElement && state.list.contains(document.activeElement) ? document.activeElement.closest<HTMLElement>('.sm-flow-toggle')?.dataset.index : undefined;
  state.count.textContent = `แสดง ${shown.toLocaleString('th-TH')} จาก ${rows.length.toLocaleString('th-TH')} รายการ`;
  state.count.dataset.shown = String(shown); state.count.dataset.total = String(rows.length);
  state.list.replaceChildren(...(rows.length ? rows.slice(0, shown).map(row => eventCard(row, state)) : [empty('ยังไม่มีรายการ', state.kind === 'money' ? 'รายการโอนเงินจริงจะแสดงเมื่อเมืองเริ่มดำเนินการ' : state.kind === 'crops' ? 'พืชผลเริ่มมีบัญชีเมื่อเก็บเกี่ยว ซื้อขาย แปรรูป หรือบริโภคจริง เซฟเดิมเริ่มพืชผลที่ศูนย์' : 'สินค้าเริ่มเคลื่อนย้ายเมื่อมีการผลิต นำเข้า ซื้อ หรือส่งออก', state.kind === 'crops' ? 'goods' : state.kind)]));
  if (focused !== undefined) state.list.querySelector<HTMLElement>(`.sm-flow-toggle[data-index="${focused}"]`)?.focus({ preventScroll: true });
  state.more.hidden = shown >= rows.length; state.all.hidden = shown >= rows.length; state.recent.hidden = shown <= state.initial;
  state.all.textContent = `ดูทั้งหมด ${rows.length.toLocaleString('th-TH')} รายการ`;
}
function setupWallets() {
  const host = root('accounts'); host.classList.add('sm-content', 'sm-wallets'); host.dataset.scope = 'city';
  host.replaceChildren(intro('wallets', 'กระเป๋าเงินของทั้งเมือง', 'ยอดคงเหลือจริง แยกคลังเมือง ครัวเรือน บริษัท และคู่บัญชีภายนอก'), element('p', 'sm-scope', scopeText(false)), element('p', 'sm-wallet-count sm-count'), element('div', 'sm-wallet-groups'), element('p', 'sm-footnote', 'แสดงทุกบัญชี รวมบัญชีที่ยอดเป็นศูนย์และบัญชีในประวัติ ยอดบริษัทอาจมีค่าจ้างที่สำรองไว้ จึงไม่ใช่เงินที่ใช้จ่ายได้ทั้งหมด'));
}
function updateWallets() {
  if (!current) return;
  const host = root('accounts'), groups = walletGroups(current), accounts = groups.flatMap(group => group.accounts);
  host.querySelector('.sm-scope')!.textContent = scopeText(false);
  const revision = accounts.map(account => `${account.id}:${account.balance}`).join('|'); if (revision === walletRevision) return; walletRevision = revision;
  host.querySelector('.sm-wallet-count')!.textContent = `แสดงครบ ${accounts.length.toLocaleString('th-TH')} บัญชี · ${groups.length} หมวด`;
  const cards = groups.map(group => {
    const section = element('div', `sm-wallet-group${group.key === 'outside' ? ' counterparty' : ''}`); section.dataset.group = group.key; section.dataset.total = String(group.total);
    const head = element('div', 'sm-wallet-group-head'), title = element('div'), total = element('strong', 'sm-group-total', `${formatMoney(group.total, true)} ฿`);
    title.append(element('h4', '', group.label), element('p', '', `${group.accounts.length} บัญชี`)); head.append(title, total);
    const grid = element('div', 'sm-wallet-grid');
    // Each card carries a bar scaled to the largest balance in its group, so sizes read at a glance.
    const largest = Math.max(1, ...group.accounts.map(account => Math.abs(account.balance)));
    for (const account of group.accounts) {
      const card = element('article', `sm-wallet-card${account.id === 'outside' ? ' counterparty' : ''}${account.balance < 0 ? ' negative' : ''}`); Object.assign(card.dataset, { id: account.id, balance: String(account.balance) });
      const bar = element('span', 'sm-wallet-bar'); bar.setAttribute('aria-hidden', 'true'); bar.style.setProperty('--share', (Math.abs(account.balance) / largest).toFixed(3));
      card.title = account.id;
      card.append(element('span', '', account.label), element('strong', '', `${formatMoney(account.balance, true)} ฿`), bar, element('small', '', account.id)); grid.append(card);
    }
    if (!group.accounts.length) grid.append(element('p', 'sm-footnote', 'ยังไม่มีบัญชีในหมวดนี้'));
    section.append(head, element('p', 'sm-group-description', group.description), grid); return section;
  });
  host.querySelector('.sm-wallet-groups')!.replaceChildren(...cards);
}
function replaceDetailsBody(id: string, content: HTMLElement) {
  const details = root(id), summary = Array.from(details.children).find(child => child.tagName === 'SUMMARY'); if (!summary) throw new Error(`Missing summary in #${id}`); details.replaceChildren(summary, content);
}
const SHORTCUTS: readonly [string, string, string][] = [
  ['V', 'cursor', 'เลือก'], ['R', 'road', 'ถนน'], ['1', 'R', 'บ้าน'], ['2', 'shop', 'พาณิชย์'], ['3', 'I', 'โรงงาน'], ['4', 'F', 'ฟาร์ม'],
  ['B', 'bulldoze', 'รื้อ'], ['P', 'move', 'เลื่อน'], ['Space', 'clock', 'หยุด/เล่น'], ['T', 'chart', 'สถิติเมือง'], ['Q / E', 'gear', 'หมุนกล้อง'], ['Esc', 'link', 'ยกเลิก/ย้อน'],
];
function shortcutTable(): HTMLElement {
  const box = element('section', 'sm-shortcuts'), grid = element('div', 'sm-shortcut-grid'); box.append(element('h4', '', 'ปุ่มลัด'));
  for (const [key, icon, label] of SHORTCUTS) { const cell = element('div', 'sm-shortcut'); cell.append(iconElement(icon, 'ui-icon'), element('kbd', '', key), element('span', '', label)); grid.append(cell); }
  box.append(grid); return box;
}
const LEGEND: readonly [string, string, string][] = [
  ['R', 'zone-R', 'บ้าน'], ['shop', 'zone-shop', 'พาณิชย์/ร้าน'], ['market', 'zone-market', 'ตลาดพืชผล'], ['I', 'zone-I', 'โรงงาน'], ['F', 'zone-F', 'ฟาร์ม'],
  ['person', 'legend-work', 'ทำงาน'], ['person', 'legend-idle', 'ว่างงาน'], ['person', 'legend-dep', 'ผู้พึ่งพิง'],
  ['import', 'legend-good', 'เงินเข้า'], ['export', 'legend-bad', 'เงินออก'], ['shield', 'legend-good', 'ผ่านเงื่อนไข'], ['info', 'legend-warn', 'ยังติดเงื่อนไข'],
];
function colourLegend(): HTMLElement {
  const box = element('section', 'sm-legend'), grid = element('div', 'sm-legend-grid'); box.append(element('h4', '', 'สีและไอคอน'));
  for (const [icon, tone, label] of LEGEND) { const cell = element('div', `sm-legend-item ${tone}`); cell.append(iconElement(icon, 'ui-icon'), element('span', '', label)); grid.append(cell); }
  box.append(grid); return box;
}
function setupGuide() {
  const content = element('div', 'sm-content sm-guide'), steps = element('div', 'sm-steps');
  content.append(intro('road', 'สร้างเมืองทีละขั้น', 'วางถนนและโซน แล้วให้ครัวเรือนกับบริษัทตัดสินใจภายใต้กติกาจำลอง เกมใหม่มีผู้ช่วยสอนพาทำทีละขั้น หรือเลือกเมืองตัวอย่างในเมนูเกม → เริ่มใหม่'));
  const definitions = [
    { art: 'road', title: 'เชื่อมถนนกับโลกภายนอก', text: `เลือกถนนแล้วลาก หรือแตะจุดเริ่มและจุดจบเป็นรูป L ต่อจากประตูสีเหลืองฝั่งตะวันตก ค่าสร้าง ${formatMoney(ROAD_COST)} บาทต่อช่อง`, keys: ['R · ถนน', 'Esc · ยกเลิกจุดเริ่ม'] },
    { art: 'zones', title: 'กำหนดโซนข้างถนน', text: 'เลือก R บ้าน / C พาณิชย์ / I โรงงาน / F ฟาร์ม แล้วแตะแปลงข้างถนนที่เชื่อมถึงประตู พาณิชย์ใหม่เริ่มเป็นตลาดระดับ 1 ใช้ทุนและแรงงานของเจ้าของ ฟาร์มต้องมีความอุดมสมบูรณ์อย่างน้อย 50% อาคารเกิดเองเมื่อผ่านเงื่อนไขทุก 3 วัน', keys: ['1 · บ้าน', '2 · พาณิชย์', '3 · โรงงาน', '4 · ฟาร์ม'] },
    { art: 'growth', title: 'ดูเงื่อนไขก่อนขยายเมือง', text: 'กดเล่นต่อและเลือกความเร็ว แตะอาคารเพื่อดูแรงงาน เงินสด สินค้า และเหตุผลที่หยุดนิ่ง บ้านว่างไม่เพิ่มคนเอง เมื่อรับคนเต็มงานแล้ว ให้ดูทุนขยายโรงงานในภาพรวมเมือง เตรียมแปลง I ที่เชื่อมถนน และวางฟาร์มเพิ่มเมื่อวัตถุดิบไม่พอ', keys: ['Space · หยุด/เล่นต่อ', 'V · เลือกข้อมูล'] },
    { art: 'view', title: 'ปรับมุมมองและเก็บเมืองไว้', text: 'ใช้โหมดเลื่อนหรือลากสองนิ้วเพื่อเลื่อน บีบนิ้วหรือล้อเมาส์เพื่อซูม ลากปุ่มขวาเพื่อหมุน เปิดเมนูเกมเพื่อบันทึก/โหลดเมืองในเบราว์เซอร์นี้ เริ่มใหม่มีปุ่มกลับเพื่อยกเลิก', keys: ['P · เลื่อน', 'Q / E · หมุน', 'ปุ่มกล้อง · จอสัมผัส'] },
  ];
  definitions.forEach((definition, i) => {
    const card = element('article', 'sm-step'), art = element('div', 'sm-step-art'), body = element('div', 'sm-step-body'), keys = element('div', 'sm-keycaps'); art.append(svg(definition.art), element('span', 'sm-step-index', String(i + 1)));
    definition.keys.forEach(key => keys.append(element('kbd', '', key))); body.append(element('h4', '', definition.title), element('p', 'sm-fold', definition.text), keys); card.append(art, body); steps.append(expandable(card));
  });
  content.append(steps, shortcutTable(), colourLegend(), element('p', 'sm-footnote', 'ปุ่มกลับ / Esc ยกเลิกจุดเริ่มถนนก่อน กดอีกครั้งจึงกลับเครื่องมือเลือก การดูบัญชีหรือเปลี่ยนมุมมองไม่เปลี่ยนยอดเงินในเมือง'));
  replaceDetailsBody('guide', content);
}
/** Long explanations show their first line; tapping the card (or Enter/Space) reveals the rest. */
function expandable(card: HTMLElement): HTMLElement {
  card.classList.add('sm-expandable'); card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-expanded', 'false');
  const toggle = () => { const open = card.getAttribute('aria-expanded') !== 'true'; card.setAttribute('aria-expanded', String(open)); };
  card.addEventListener('click', event => { if (!(event.target as Element).closest('a, button, kbd')) toggle(); });
  card.addEventListener('keydown', event => { if (event.target === card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggle(); } });
  return card;
}
function ruleCard(icon: string, title: string, text: string, id?: string): HTMLElement {
  const card = element('article', 'sm-rule-card'), art = element('div', 'sm-rule-icon'); art.append(svg(icon)); card.append(art, element('h4', '', title), element('p', 'sm-fold', text)); if (id) card.dataset.rule = id; return expandable(card);
}
function setupRules() {
  const content = element('div', 'sm-content sm-rules'), grid = element('div', 'sm-rule-grid');
  content.append(intro('limits', 'รู้ขอบเขตก่อนวางแผน', 'สิ่งที่จำลองแล้ว สมมติฐานที่ใช้ และระบบที่ยังอยู่ในระยะถัดไป'));
  grid.append(
    ruleCard('calendar', 'วันและเงินเป็นจำนวนแน่นอน', `1 tick เท่ากับ 1 วัน มี ${MONTH} วันต่อเดือน ค่าจ้างสะสมตามวันที่ทำงานและจ่ายรายเดือน เช่นเดียวกับค่าเช่าและภาษี เงินคำนวณเป็นสตางค์จำนวนเต็ม`),
    ruleCard('utilities', 'น้ำและไฟตามถนนและกำลังผลิต', 'ประตูเมืองจ่ายน้ำและไฟตามสัญญาจำกัด เมืองสร้างโรงไฟฟ้าและโรงสูบน้ำริมถนนเพื่อเพิ่มกำลังผลิต น้ำไฟวิ่งไปตามถนนที่ต่อกัน ถ้าไม่พอ อาคารที่ไกลจากแหล่งจ่ายที่สุดจะหยุดงาน ผลิต และเติบโตก่อน ครัวเรือนและกิจการจ่ายค่าน้ำค่าไฟให้เมืองทุกเดือน เมืองจ่ายค่าโรงงานและค่าซื้อจากภายนอก', 'utilities'),
    ruleCard('outside', 'ทุนเริ่มต้นและทุนขยายมีต้นทาง', 'โรงงานแรกเปิดได้ก่อนมีคนงาน สองครัวเรือนแรกยกเว้นเงื่อนไขงาน แต่ยังต้องมีบ้าน ถนน น้ำ และไฟ บ้าน ฟาร์ม และโรงงานแรกใช้ทุนภายนอกที่มีบัญชีคู่ โรงงานเพิ่มใช้ทุนจริงจากกิจการที่ผ่านเงื่อนไขและกันค่าจ้าง ภาษี ค่าเช่า กับเงินหมุนเวียนก่อน ไม่แจกทุนเมื่อโหลดเซฟ พาณิชย์ใหม่เป็นตลาดระดับ 1 ใช้เงินครัวเรือนเจ้าของ 600 บาท จ่ายก่อสร้าง 100 บาท เหลือหมุนเวียน 500 บาท ร้านค้าเปิดเมื่อโรงงานมีคนงาน ครัวเรือนที่มีเงินออม 600 บาทเป็นเจ้าของและยืนร้านเอง ถ้าไม่มีจึงใช้ทุนภายนอก ฟาร์มขยายได้ถึงระดับ 3 ด้วยกำไรของตัวเอง เมื่อเมืองต้องการร้านเพิ่ม ตลาดที่มีกำไรและมีเงิน 400 บาทขึ้นไปยกระดับเป็นร้านค้าได้ (จ่ายค่าปรับปรุง 200 บาทจากเงินกิจการ พืชผลที่เหลือตัดออก) ถ้ายังมีตลาดอื่นขายพืชผลสด รื้อบ้านไม่คืนสิทธิเริ่มต้น', 'bootstrap'),
    ruleCard('goods', 'อาหารหนึ่งหน่วยต่อคนต่อวัน', 'สมาชิกแต่ละคนต้องการอาหารวันละหนึ่งหน่วย ซื้อพืชผลจากตลาดหรือสินค้าจากร้านค้า โดยจ่ายจากเงินร่วมครัวเรือนและตัดสต็อกจริง หากเงินหรือของไม่พอจะซื้อได้บางส่วน'),
    ruleCard('growth', 'พืชผลและวัตถุดิบมีต้นทาง', 'ฟาร์มเก็บเกี่ยวพืชผลหมุนเวียนตามความอุดมสมบูรณ์และแรงงาน โรงงานใช้พืชผลจริง 2 ล็อตเป็นสำเร็จรูป 8 หน่วยต่อชุด ตลาดไม่ผลิตเอง สต็อกที่เพิ่งซื้อเริ่มขายได้วันถัดไป บัญชีพืชผลแยกล็อตและต้นทุนจากสินค้าสำเร็จรูป เซฟเดิมไม่มีวัตถุดิบแจก ต้องสร้างห่วงโซ่เกษตรก่อน', 'agriculture'),
    ruleCard('wallets', 'ลูกจ้างและผู้ทำกิจการเอง', 'แรงงานรับจ้างรับค่าจ้างเข้ากระเป๋าครัวเรือน ตลาดขนาดเล็กใช้แรงงานเจ้าของ 1 คน ไม่มีเงินเดือนเจ้าของ ยอดขายอยู่บัญชีกิจการ ถอนเฉพาะกำไรที่มีสิทธิ์และเหลือเงินหมุนเวียน 200 บาท การเติมทุน ถอนกำไร และทุนขยายโรงงานไม่ใช่ยอดขายซ้ำ ยังไม่มีหน้าบริหารกลุ่มกิจการ ตลาดลงทุน หนี้ หรือผลตอบแทนรับประกัน', 'income-roles'),
    ruleCard('limits', `แผนที่กริดราบ ${SIZE} × ${SIZE}`, 'ขอบเขตสูงสุด 192 อาคาร 128 ครัวเรือน 64 บริษัท และ 32 โรงน้ำไฟ ถนนโค้ง การจราจรรายช่องจราจร และเมืองขนาดใหญ่ยังเป็นงานระยะถัดไป'),
    ruleCard('growth', 'ต้นแบบแรกที่ตรวจสอบได้', 'ได้รับแรงบันดาลใจด้านการเล่นจาก Cities: Skylines II ยังไม่ครอบคลุมระบบทั้งหมด โค้ดจำลองและถนนเขียนใหม่ทั้งหมด', 'version'),
  );
  const attribution = element('div', 'sm-attribution'); attribution.append(element('h4', '', 'แหล่งภาพและสิทธิ์ใช้งาน'), element('p', '', 'โมเดลเมือง 8 แบบและไอคอน GUI 4 ภาพจาก Kenney ภายใต้ CC0 สัญลักษณ์เส้นในคู่มือสร้างขึ้นใหม่ในโค้ด'));
  const kenney = element('a', '', 'Kenney · แหล่งต้นฉบับ'), license = element('a', '', 'CC0 · อ่านใบอนุญาต'); kenney.href = 'https://kenney.nl/assets'; license.href = 'https://creativecommons.org/publicdomain/zero/1.0/';
  for (const link of [kenney, license]) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  attribution.append(kenney, license); content.append(grid, attribution); replaceDetailsBody('simulation-rules', content);
}
function updateRules() {
  if (!current) return;
  const utilities = root('simulation-rules').querySelector('[data-rule=utilities]')!;
  let status = utilities.querySelector('.sm-rule-status'); if (!status) { status = element('div', 'sm-rule-status'); utilities.append(status); }
  const u = utilityStatus(current), power = u.power, water = u.water; status.replaceChildren(image(power && water ? 'status-ok' : 'status-alert'), document.createTextNode(`ขณะนี้: ไฟฟ้า ${u.used.power}/${u.capacity.power} ${power ? 'พร้อม' : 'ไม่พอ'} · น้ำ ${u.used.water}/${u.capacity.water} ${water ? 'พร้อม' : 'ไม่พอ'}`));
  const bootstrap = root('simulation-rules').querySelector('[data-rule=bootstrap]')!, grant = current.ledger.find(entry => entry.reason === 'Initial municipal grant');
  let grantLabel = bootstrap.querySelector('.sm-rule-status'); if (!grantLabel) { grantLabel = element('div', 'sm-rule-status'); bootstrap.append(grantLabel); }
  grantLabel.textContent = grant ? `ทุนตั้งเมืองที่บันทึก: ${formatMoney(grant.amount)} บาท` : 'ยังไม่มีรายการทุนตั้งเมืองในบัญชีนี้';
  const version = root('simulation-rules').querySelector('[data-rule=version]')!;
  let label = version.querySelector('.sm-footnote'); if (!label) { label = element('p', 'sm-footnote'); version.append(label); } label.textContent = `CityManager ${GAME_VERSION} · บันทึกเวอร์ชัน ${current.version} · รหัสเมือง ${current.seed} · วันที่ ${current.tick}`;
}

/** Installs presentation only; preserves native outer details/summary behavior. */
export function setupSubmenus(): void {
  if (ready) return; setupJournal('money', 'ledger', 12); setupJournal('goods', 'goods-ledger', 10); setupJournal('crops', 'crop-ledger', 10); setupWallets(); setupGuide(); setupRules(); ready = true;
}
/** Reads the actual simulation. Pagination and disclosure state belong only to the UI. */
export function renderSubmenus(city: City, selected: number | null): void {
  if (!ready) setupSubmenus();
  if (current && current !== city) { for (const state of journals.values()) { clearJournalInput(state); state.expanded.clear(); state.limit = state.initial; state.revision = ''; state.list.replaceChildren(); } walletRevision = ''; }
  current = city; selection = selected;
  for (const state of journals.values()) updateJournal(state); updateWallets(); updateRules();
}
