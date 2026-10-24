import './submenus.css';
import { MONTH, SIZE, ROAD_COST, type City } from './sim.ts';
import { flowRows, walletGroups, formatMoney, type FlowKind, type FlowRow } from './inspector-data.ts';

const BASE = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
type Journal = { kind: FlowKind; initial: number; limit: number; count: HTMLElement; scope: HTMLElement; list: HTMLElement; more: HTMLButtonElement; all: HTMLButtonElement; recent: HTMLButtonElement; revision: string };
const journals = new Map<FlowKind, Journal>();
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
  const intro = element('div', 'sm-intro'), art = element('div', 'sm-section-symbol'), content = element('div'); art.append(svg(kind));
  content.append(element('span', 'sm-kicker', 'สมุดข้อมูลเมือง'), element('h3', '', title), element('p', '', description)); intro.append(art, content); return intro;
}
function action(label: string, kind: FlowKind, name: string): HTMLButtonElement {
  const button = element('button', `sm-button${name === 'more' ? ' primary' : ''}`, label); button.type = 'button'; button.dataset.journalAction = name; button.dataset.kind = kind; return button;
}
function setupJournal(kind: FlowKind, id: string, initial: number) {
  const host = root(id); host.classList.add('sm-content', 'sm-journal'); host.dataset.scope = 'city';
  const scope = element('p', 'sm-scope', scopeText()), count = element('span', 'sm-count'), order = element('span', 'sm-order', 'ใหม่ → เก่า');
  const countbar = element('div', 'sm-countbar'); countbar.append(count, order);
  const list = element('div', 'sm-journal-list'); list.dataset.journal = kind;
  const more = action(`ดูเพิ่ม ${initial} รายการ`, kind, 'more'), all = action('ดูทั้งหมด', kind, 'all'), recent = action('กลับรายการล่าสุด', kind, 'recent');
  const buttons = element('div', 'sm-pagination'); buttons.append(more, all, recent);
  const note = element('p', 'sm-footnote', kind === 'money' ? 'แต่ละรายการหักต้นทางและเพิ่มปลายทางด้วยจำนวนเงินเดียวกัน ยอดเป็นบาทและสตางค์' : 'หน่วยสินค้าเป็นหน่วยนามธรรมของต้นแบบ การตัดสต็อกจากการรื้อถอนไม่ใช่รายได้ขายสินค้า');
  host.replaceChildren(intro(kind, kind === 'money' ? 'เงินเดินทางไปที่ไหน' : 'จากผู้ผลิตสู่ผู้ใช้', kind === 'money' ? 'ตามรอยเงินจริงตั้งแต่เงินลงทุน ค่าจ้าง การซื้อสินค้า ไปจนถึงภาษี' : 'ดูต้นทาง ปลายทาง และจำนวนสินค้าของทุกรายการ'), scope, countbar, list, buttons, note);
  const state: Journal = { kind, initial, limit: initial, count, scope, list, more, all, recent, revision: '' }; journals.set(kind, state);
  more.addEventListener('click', () => { state.limit += initial; updateJournal(state); if (more.hidden) recent.focus(); });
  all.addEventListener('click', () => { state.limit = Infinity; updateJournal(state); recent.focus(); });
  recent.addEventListener('click', () => { state.limit = initial; updateJournal(state); if (!more.hidden) more.focus(); });
}
function eventCard(row: FlowRow): HTMLElement {
  const card = element('article', `sm-flow-card${row.kind === 'money' && row.to === 'treasury' ? ' income' : row.kind === 'money' && row.from === 'treasury' ? ' outgoing' : ''}`);
  Object.assign(card.dataset, { kind: row.kind, index: String(row.index), tick: String(row.tick), from: row.from, to: row.to, value: String(row.value), reason: row.reason });
  const top = element('div', 'sm-flow-top'), value = element('strong', 'sm-flow-value', row.kind === 'money' ? `${formatMoney(row.value)} ฿` : `${row.value.toLocaleString('th-TH')} หน่วย`);
  if (row.kind === 'money' && (row.to === 'treasury' || row.from === 'treasury')) value.prepend(image(row.to === 'treasury' ? 'arrow-up' : 'arrow-down'));
  top.append(element('h4', 'sm-event-title', row.label), value);
  const direction = row.kind === 'goods' ? 'ย้ายสินค้า' : row.to === 'treasury' ? 'เข้าคลังเมือง' : row.from === 'treasury' ? 'ออกจากคลังเมือง' : 'โอนระหว่างบัญชี';
  const meta = element('p', 'sm-flow-meta', `วัน ${row.tick} · รายการ #${row.index + 1} · ${direction}`), route = element('div', 'sm-flow-route');
  const from = element('div', 'sm-party'), to = element('div', 'sm-party'), arrow = element('span', 'sm-route-arrow'); arrow.append(svg('arrow')); arrow.setAttribute('aria-label', 'ไปยัง');
  from.append(element('small', '', 'ต้นทาง'), element('strong', '', row.fromLabel)); to.append(element('small', '', 'ปลายทาง'), element('strong', '', row.toLabel)); route.append(from, arrow, to); card.append(top, meta, route); return card;
}
function empty(title: string, description: string, kind: string): HTMLElement {
  const card = element('div', 'sm-empty'); card.append(svg(kind), element('h4', '', title), element('p', '', description)); return card;
}
function updateJournal(state: Journal) {
  if (!current) return;
  state.scope.textContent = scopeText();
  const rows = flowRows(current, state.kind), shown = Math.min(rows.length, state.limit), revision = `${rows.length}:${shown}:${rows[0]?.index}:${rows[0]?.tick}:${rows[0]?.value}`;
  if (revision === state.revision) return; state.revision = revision;
  state.count.textContent = `แสดง ${shown.toLocaleString('th-TH')} จาก ${rows.length.toLocaleString('th-TH')} รายการ`;
  state.count.dataset.shown = String(shown); state.count.dataset.total = String(rows.length);
  state.list.replaceChildren(...(rows.length ? rows.slice(0, shown).map(eventCard) : [empty('ยังไม่มีรายการ', state.kind === 'money' ? 'รายการโอนเงินจริงจะแสดงเมื่อเมืองเริ่มดำเนินการ' : 'สินค้าเริ่มเคลื่อนย้ายเมื่อมีการผลิต นำเข้า ซื้อ หรือส่งออก', state.kind)]));
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
    for (const account of group.accounts) {
      const card = element('article', `sm-wallet-card${account.id === 'outside' ? ' counterparty' : ''}`); Object.assign(card.dataset, { id: account.id, balance: String(account.balance) });
      card.append(element('span', '', account.label), element('strong', '', `${formatMoney(account.balance, true)} ฿`), element('small', '', account.id)); grid.append(card);
    }
    if (!group.accounts.length) grid.append(element('p', 'sm-footnote', 'ยังไม่มีบัญชีในหมวดนี้'));
    section.append(head, element('p', 'sm-group-description', group.description), grid); return section;
  });
  host.querySelector('.sm-wallet-groups')!.replaceChildren(...cards);
}
function replaceDetailsBody(id: string, content: HTMLElement) {
  const details = root(id), summary = Array.from(details.children).find(child => child.tagName === 'SUMMARY'); if (!summary) throw new Error(`Missing summary in #${id}`); details.replaceChildren(summary, content);
}
function setupGuide() {
  const content = element('div', 'sm-content sm-guide'), steps = element('div', 'sm-steps');
  content.append(intro('road', 'สร้างเมืองทีละขั้น', 'วางถนนและโซน แล้วให้ครัวเรือนกับบริษัทตัดสินใจภายใต้กติกาจำลอง'));
  const definitions = [
    { art: 'road', title: 'เชื่อมถนนกับโลกภายนอก', text: `เลือกถนนแล้วลาก หรือแตะจุดเริ่มและจุดจบเป็นรูป L ต่อจากประตูสีเหลืองฝั่งตะวันตก ค่าสร้าง ${formatMoney(ROAD_COST)} บาทต่อช่อง`, keys: ['R · ถนน', 'Esc · ยกเลิกจุดเริ่ม'] },
    { art: 'zones', title: 'กำหนดโซนข้างถนน', text: 'เลือก R บ้าน / C ร้านค้า / I โรงงาน แล้วแตะแปลงข้างถนนที่เชื่อมถึงประตู อาคารไม่ได้วางด้วยมือ ระบบทบทวนการพัฒนาทุก 3 วัน', keys: ['1 · บ้าน', '2 · ร้านค้า', '3 · โรงงาน'] },
    { art: 'growth', title: 'ดูเงื่อนไขก่อนขยายเมือง', text: 'กดเล่นต่อและเลือกความเร็ว แตะอาคารเพื่อดูแรงงาน เงินสด สินค้า และเหตุผลที่หยุดนิ่ง ถนน น้ำ ไฟ ความต้องการ และรายได้ที่คุ้มค่าเช่าต้องผ่านเงื่อนไข', keys: ['Space · หยุด/เล่นต่อ', 'V · เลือกข้อมูล'] },
    { art: 'view', title: 'ปรับมุมมองและเก็บเมืองไว้', text: 'ใช้โหมดเลื่อนหรือลากสองนิ้วเพื่อเลื่อน บีบนิ้วหรือล้อเมาส์เพื่อซูม ลากปุ่มขวาเพื่อหมุน ปุ่มบันทึก/โหลดเก็บเมืองในเบราว์เซอร์นี้ เริ่มใหม่มีปุ่มกลับเพื่อยกเลิก', keys: ['P · เลื่อน', 'Q / E · หมุน', 'ปุ่มกล้อง · จอสัมผัส'] },
  ];
  definitions.forEach((definition, i) => {
    const card = element('article', 'sm-step'), art = element('div', 'sm-step-art'), body = element('div', 'sm-step-body'), keys = element('div', 'sm-keycaps'); art.append(svg(definition.art), element('span', 'sm-step-index', String(i + 1)));
    definition.keys.forEach(key => keys.append(element('kbd', '', key))); body.append(element('h4', '', definition.title), element('p', '', definition.text), keys); card.append(art, body); steps.append(card);
  });
  content.append(steps, element('p', 'sm-footnote', 'ปุ่มกลับ / Esc ยกเลิกจุดเริ่มถนนก่อน กดอีกครั้งจึงกลับเครื่องมือเลือก การดูบัญชีหรือเปลี่ยนมุมมองไม่เปลี่ยนยอดเงินในเมือง'));
  replaceDetailsBody('guide', content);
}
function ruleCard(icon: string, title: string, text: string, id?: string): HTMLElement {
  const card = element('article', 'sm-rule-card'), art = element('div', 'sm-rule-icon'); art.append(svg(icon)); card.append(art, element('h4', '', title), element('p', '', text)); if (id) card.dataset.rule = id; return card;
}
function setupRules() {
  const content = element('div', 'sm-content sm-rules'), grid = element('div', 'sm-rule-grid');
  content.append(intro('limits', 'รู้ขอบเขตก่อนวางแผน', 'สิ่งที่จำลองแล้ว สมมติฐานที่ใช้ และระบบที่ยังอยู่ในระยะถัดไป'));
  grid.append(
    ruleCard('calendar', 'วันและเงินเป็นจำนวนแน่นอน', `1 tick เท่ากับ 1 วัน มี ${MONTH} วันต่อเดือน ค่าจ้างสะสมตามวันที่ทำงานและจ่ายรายเดือน เช่นเดียวกับค่าเช่าและภาษี เงินคำนวณเป็นสตางค์จำนวนเต็ม`),
    ruleCard('utilities', 'น้ำและไฟจากภายนอก', 'ต้นแบบให้บริการภายนอกกับทุกแปลง ยังไม่มีเครือข่ายหรือข้อจำกัดกำลังผลิต หากสถานะไม่พร้อม การผลิตและการเติบโตจะหยุดตามกฎ', 'utilities'),
    ruleCard('outside', 'ทุนเริ่มต้นมีต้นทาง', 'โรงงานแรกเปิดได้ก่อนมีคนงาน และสองครัวเรือนแรกย้ายเข้าได้ก่อนมีงาน เงินทุนกิจการ เงินออมผู้ย้ายเข้า และทุนพัฒนาบ้านเริ่มต้นมาจากคู่บัญชีภายนอก มีรายการโอนให้ตรวจสอบ', 'bootstrap'),
    ruleCard('goods', 'สินค้าและตลาดแบบย่อ', 'ใช้สินค้านามธรรมชนิดเดียว มีการผลิต ซื้อขายในเมือง นำเข้า ส่งออก และการบริโภคจริงตามกระเป๋าเงินและสต็อก คู่บัญชีภายนอกติดตามเงินเข้าออก ยอดติดลบไม่ได้หมายถึงหนี้เมือง'),
    ruleCard('limits', `แผนที่กริดราบ ${SIZE} × ${SIZE}`, 'ขอบเขตสูงสุด 192 อาคาร 128 ครัวเรือน และ 64 บริษัท ถนนโค้ง การจราจรรายช่องจราจร สาธารณูปโภคแบบมีความจุ และเมืองขนาดใหญ่ยังเป็นงานระยะถัดไป'),
    ruleCard('growth', 'ต้นแบบแรกที่ตรวจสอบได้', 'ได้รับแรงบันดาลใจด้านการเล่นจาก Cities: Skylines II ยังไม่ครอบคลุมระบบทั้งหมด โค้ดจำลองและถนนเขียนใหม่ ไม่ใช้โค้ด Living City Lab หรือ novel engine', 'version'),
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
  const power = current.utilities.power, water = current.utilities.water; status.replaceChildren(image(power && water ? 'status-ok' : 'status-alert'), document.createTextNode(`ขณะนี้: ไฟฟ้า${power ? 'พร้อม' : 'ไม่พร้อม'} · น้ำ${water ? 'พร้อม' : 'ไม่พร้อม'}`));
  const bootstrap = root('simulation-rules').querySelector('[data-rule=bootstrap]')!, grant = current.ledger.find(entry => entry.reason === 'Initial municipal grant');
  let grantLabel = bootstrap.querySelector('.sm-rule-status'); if (!grantLabel) { grantLabel = element('div', 'sm-rule-status'); bootstrap.append(grantLabel); }
  grantLabel.textContent = grant ? `ทุนตั้งเมืองที่บันทึก: ${formatMoney(grant.amount)} บาท` : 'ยังไม่มีรายการทุนตั้งเมืองในบัญชีนี้';
  const version = root('simulation-rules').querySelector('[data-rule=version]')!;
  let label = version.querySelector('.sm-footnote'); if (!label) { label = element('p', 'sm-footnote'); version.append(label); } label.textContent = `บันทึกเวอร์ชัน ${current.version} · Seed ${current.seed} · วันที่ ${current.tick}`;
}

/** Installs presentation only; preserves native outer details/summary behavior. */
export function setupSubmenus(): void {
  if (ready) return; setupJournal('money', 'ledger', 12); setupJournal('goods', 'goods-ledger', 10); setupWallets(); setupGuide(); setupRules(); ready = true;
}
/** Reads the actual simulation. Pagination and disclosure state belong only to the UI. */
export function renderSubmenus(city: City, selected: number | null): void {
  if (!ready) setupSubmenus();
  if (current && current !== city) { for (const state of journals.values()) { state.limit = state.initial; state.revision = ''; } walletRevision = ''; }
  current = city; selection = selected;
  for (const state of journals.values()) updateJournal(state); updateWallets(); updateRules();
}
