import './context-panels.css';
import { MONTH, WAGES, access, type City, type Household, type Firm, type Building } from './sim.ts';
import { resolvePlace, relatedFlows, cityOverview } from './context-data.ts';
import { formatMoney, type FlowKind, type FlowRow } from './inspector-data.ts';

export type ContextSelection = { kind: 'place'; cell: number } | { kind: 'household'; id: number; sourceBuildingId: number; sourceCell: number } | null;
type HouseholdAction = (id: number, sourceBuildingId: number, sourceCell: number) => void;
let latestCity: City | null = null;
const activityLimits = new Map<string, number>();
type ContextRequest = { city: City; selection: ContextSelection; onHousehold: HouseholdAction };
let latestRequest: ContextRequest | null = null, queuedRequest: ContextRequest | null = null;
let renderedCity: City | null = null, renderedScope = '', renderedRevision = '';
let guardedHost: HTMLElement | null = null, releaseBarrier = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const heldPointers = new Map<number, HTMLElement>(), heldKeys = new Map<string, HTMLElement>();
const cash = (value: number, signed = false) => `${formatMoney(value, signed)} ฿`;
const count = (value: number) => value.toLocaleString('th-TH');

function clearHeldRender() {
  heldPointers.clear(); heldKeys.clear(); queuedRequest = null; releaseBarrier = false;
  if (flushTimer !== null) clearTimeout(flushTimer); flushTimer = null;
}
function flushAfterActivation() {
  // pointerup/keyup precedes native click. Keep this barrier through that click,
  // then flush in the next task (a microtask could still remove the pressed node).
  releaseBarrier = true;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null; releaseBarrier = false;
    if (heldPointers.size || heldKeys.size) return;
    const request = queuedRequest; queuedRequest = null;
    if (request && request === latestRequest) renderContext(request.city, request.selection, request.onHousehold);
  }, 0);
}
function installInputGuard(host: HTMLElement) {
  if (guardedHost === host) return; guardedHost = host; clearHeldRender(); renderedRevision = '';
  host.addEventListener('pointerdown', event => {
    if (event.isTrusted && event.target instanceof Element) {
      const target = event.target.closest<HTMLElement>('button') ?? (event.target instanceof HTMLElement ? event.target : host);
      heldPointers.set(event.pointerId, target);
    }
  }, true);
  host.addEventListener('keydown', event => {
    if (event.isTrusted && (event.key === ' ' || event.key === 'Enter') && event.target instanceof HTMLElement && event.target.closest('button')) heldKeys.set(event.key, event.target);
  }, true);
  document.addEventListener('pointerup', event => { if (heldPointers.delete(event.pointerId)) flushAfterActivation(); }, true);
  document.addEventListener('pointercancel', event => { if (heldPointers.delete(event.pointerId)) flushAfterActivation(); }, true);
  document.addEventListener('keyup', event => { if (heldKeys.delete(event.key)) flushAfterActivation(); }, true);
  window.addEventListener('blur', () => { if (heldPointers.size || heldKeys.size) { heldPointers.clear(); heldKeys.clear(); flushAfterActivation(); } });
}
function scopeOf(city: City, selection: ContextSelection): string {
  if (!selection) return 'none';
  if (selection.kind === 'place') return `place:${selection.cell}:${resolvePlace(city, selection.cell).building?.id ?? 'empty'}`;
  const household = city.households.find(value => value.id === selection.id), source = city.buildings.find(value => value.id === selection.sourceBuildingId && value.cell === selection.sourceCell);
  return `household:${selection.id}:${household?.home ?? 'missing'}:${selection.sourceBuildingId}:${selection.sourceCell}:${source ? 'source' : 'missing-source'}`;
}
function heldTargetsExist(city: City): boolean {
  return [...heldPointers.values(), ...heldKeys.values()].every(target => {
    if (!target.isConnected) return false;
    const button = target.closest<HTMLElement>('[data-household-id]');
    return !button || city.households.some(value => value.id === Number(button.dataset.householdId)) && city.buildings.some(value => value.id === Number(button.dataset.sourceBuildingId) && value.cell === Number(button.dataset.sourceCell));
  });
}
function navigateHousehold(id: number, sourceBuildingId: number, sourceCell: number) {
  const request = latestRequest;
  if (!request || !request.city.households.some(value => value.id === id) || !request.city.buildings.some(value => value.id === sourceBuildingId && value.cell === sourceCell)) return;
  request.onHousehold(id, sourceBuildingId, sourceCell);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); result.className = className; if (text !== undefined) result.textContent = text; return result;
}
function symbol(kind: 'household' | 'house' | 'firm' | 'empty'): SVGElement {
  const paths = kind === 'household' ? '<circle cx="25" cy="21" r="8"/><path d="M10 51V40c0-13 30-13 30 0v11M44 15h11v38H44M48 23h3m-3 8h3m-3 8h3"/>' : kind === 'house' ? '<path d="M8 29 32 10l24 19M14 26v29h36V26M26 55V38h12v17M20 30h5m14 0h5"/>' : kind === 'firm' ? '<path d="M8 55V29l17-10v10l17-10v10h14v26H8M45 29V9h8v20M17 39h5m9 0h5m9 0h4M17 47h5m9 0h5m9 0h4"/>' : '<path d="M12 16h40v40H12zM22 28h20M22 38h12"/>';
  const host = el('div'); host.innerHTML = `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${paths}</svg>`; return host.firstElementChild as SVGElement;
}
function heading(title: string, caption: string): HTMLElement { const body = el('div', 'cx-heading'); body.append(el('h3', '', title), el('p', 'cx-caption', caption)); return body; }
function metric(key: string, title: string, text: string, raw: number | string, money = false, note?: string): HTMLElement {
  const card = el('dl', `cx-metric${money ? ' money' : ''}`); card.dataset.contextMetric = key; card.dataset.value = String(raw); card.append(el('dt', '', title), el('dd', '', text)); if (note) card.append(el('small', '', note)); return card;
}
function metrics(cards: HTMLElement[]): HTMLElement { const grid = el('div', 'cx-metrics'); grid.append(...cards); return grid; }
function chip(text: string, good: boolean): HTMLElement { return el('span', `cx-chip ${good ? 'good' : 'warn'}`, text); }
function status(city: City, cell: number): HTMLElement {
  const row = el('div', 'cx-status'), connected = access(city, cell); row.append(chip(connected ? 'ถนนเชื่อมถึงเมือง' : 'ขาดถนนเชื่อม', connected), chip(city.utilities.power && city.utilities.water ? 'น้ำและไฟพร้อม' : 'น้ำหรือไฟไม่พร้อม', city.utilities.power && city.utilities.water)); return row;
}
function section(title: string, description?: string): HTMLElement {
  const body = el('section', 'cx-section'), head = el('div', 'cx-section-head'); head.append(el('h3', '', title)); if (description) head.append(el('span', 'cx-count', description)); body.append(head); return body;
}
function empty(title: string, description: string): HTMLElement {
  const body = el('div', 'cx-empty'); body.setAttribute('role', 'status'); body.append(symbol('empty'), el('h3', '', title), el('p', '', description)); return body;
}
function purchaseText(city: City, household: Household): string {
  return household.lastPurchaseTick < 0 ? 'ยังไม่เคยซื้อ' : household.lastPurchaseTick === city.tick ? 'วันนี้' : `${city.tick - household.lastPurchaseTick} วันก่อน`;
}
function householdButton(city: City, household: Household, source: Building, onHousehold: HouseholdAction): HTMLButtonElement {
  const button = el('button', 'cx-household-link'); button.type = 'button'; Object.assign(button.dataset, { householdId: String(household.id), sourceBuildingId: String(source.id), sourceCell: String(source.cell), contextFocus: `household:${household.id}` });
  const art = el('span', 'cx-person-symbol'), copy = el('span', 'cx-link-copy'); art.append(symbol('household')); copy.append(el('strong', '', `ครัวเรือน #${household.id}`), el('span', '', `${household.employer === null ? 'ว่างงาน' : `ทำงานที่บริษัท #${household.employer}`} · เงิน ${cash(city.accounts[household.wallet] ?? 0)}`));
  button.append(art, copy, el('span', 'cx-link-arrow', '→')); button.setAttribute('aria-label', `ดูข้อมูลครัวเรือน #${household.id}`); button.addEventListener('click', () => onHousehold(household.id, source.id, source.cell)); return button;
}
function flowCard(row: FlowRow): HTMLElement {
  const card = el('article', 'cx-flow-card'); Object.assign(card.dataset, { kind: row.kind, index: String(row.index), tick: String(row.tick), from: row.from, to: row.to, value: String(row.value), reason: row.reason });
  const top = el('div', 'cx-flow-top'), route = el('div', 'cx-flow-route'); top.append(el('h4', '', row.label), el('strong', 'cx-amount', row.kind === 'money' ? cash(row.value) : `${count(row.value)} หน่วย`));
  route.append(el('span', '', row.fromLabel), el('span', 'cx-route-arrow', '→'), el('span', '', row.toLabel));
  card.append(top, el('p', 'cx-flow-meta', `วัน ${row.tick} · รายการ #${row.index + 1}`), route); return card;
}
function activity(city: City, kind: FlowKind, wallet: string, owner: string): HTMLElement {
  const body = section(kind === 'money' ? 'รายการเงินของบัญชีนี้' : 'รายการสินค้าที่เกี่ยวข้อง'), rows = relatedFlows(city, kind, wallet), key = `${wallet}:${kind}`;
  body.classList.add('cx-activity'); Object.assign(body.dataset, { wallet, kind, scope: 'wallet' });
  const note = el('p', 'cx-account-note', `${owner} · ${wallet} เท่านั้น`), counter = el('p', 'cx-count'), list = el('div', 'cx-flow-list'), controls = el('div', 'cx-flow-controls'), toggle = el('button', 'cx-button'); toggle.type = 'button'; toggle.dataset.contextFlowAction = 'toggle'; toggle.dataset.kind = kind; toggle.dataset.wallet = wallet; toggle.dataset.contextFocus = `activity:${wallet}:${kind}`;
  function update() {
    const limit = activityLimits.get(key) ?? 8, shown = Math.min(rows.length, limit); counter.textContent = `แสดง ${count(shown)} จาก ${count(rows.length)} รายการ · ใหม่ → เก่า`; counter.dataset.shown = String(shown); counter.dataset.total = String(rows.length);
    list.replaceChildren(...(rows.length ? rows.slice(0, shown).map(flowCard) : [el('p', 'cx-detail-note', kind === 'money' ? 'ยังไม่มีการโอนเงินที่เกี่ยวข้องกับบัญชีนี้' : 'ยังไม่มีการเคลื่อนย้ายสินค้าที่เกี่ยวข้องกับบัญชีนี้')]));
    toggle.hidden = rows.length <= 8; toggle.textContent = limit === Infinity ? 'กลับ 8 รายการล่าสุด' : `ดูทั้งหมด ${count(rows.length)} รายการ`; toggle.setAttribute('aria-expanded', String(limit === Infinity));
  }
  toggle.addEventListener('click', () => { activityLimits.set(key, activityLimits.get(key) === Infinity ? 8 : Infinity); update(); }); controls.append(toggle); body.append(note, counter, list, controls); update(); return body;
}
function renderHouse(city: City, building: Building, households: Household[], onHousehold: HouseholdAction): HTMLElement[] {
  const residents = section('ครัวเรือนที่พักอาศัย', `${households.length} ครัวเรือน`), list = el('div', 'cx-household-list');
  for (const household of households) list.append(householdButton(city, household, building, onHousehold));
  if (!households.length) list.append(empty('ยังไม่มีครัวเรือน', 'อาคารนี้ยังไม่มีรายการครัวเรือนที่อ้างอิงเป็นบ้านพัก'));
  residents.append(list);
  return [heading(`บ้านพัก #${building.id}`, `${households.length ? 'มีครัวเรือนพักอาศัย' : 'บ้านว่าง'} · ยังไม่จำลองจำนวนคนหรือความจุตามระดับบ้าน`), status(city, building.cell), metrics([metric('level', 'ระดับอาคาร', String(building.level), building.level), metric('age', 'อายุอาคาร', `${building.age} วัน`, building.age), metric('households', 'ครัวเรือนในบ้านนี้', String(households.length), households.length)]), residents];
}
function renderFirm(city: City, building: Building, firm: Firm, onHousehold: HouseholdAction): HTMLElement[] {
  const wallet = city.accounts[firm.wallet] ?? 0, reserved = Object.values(firm.workDays).reduce((sum, days) => sum + days * WAGES[firm.zone] / MONTH, 0), spendable = Math.max(0, wallet - reserved), capacity = firm.zone === 'I' ? building.level + 3 : building.level;
  const lastSettlement = city.tick - city.tick % MONTH, hasClosedMonth = lastSettlement > 0 && city.tick - building.age < lastSettlement;
  const employees = section('ครัวเรือนที่ทำงานที่นี่', `${firm.employees.length} / ${capacity} ตำแหน่ง`), list = el('div', 'cx-household-list');
  for (const id of firm.employees) { const household = city.households.find(value => value.id === id); if (household) list.append(householdButton(city, household, building, onHousehold)); else list.append(el('p', 'cx-detail-note', `ไม่พบครัวเรือน #${id} ที่บริษัทอ้างอิง`)); }
  if (!firm.employees.length) list.append(el('p', 'cx-detail-note', 'ยังไม่มีครัวเรือนเข้าทำงานที่บริษัทนี้'));
  employees.append(list);
  return [heading(`${firm.zone === 'I' ? 'โรงงาน' : 'ร้านค้า'} · บริษัท #${firm.id}`, `อาคาร #${building.id} · บัญชี ${firm.wallet} · ระดับ ${building.level}`), status(city, building.cell), metrics([
    metric('cash', 'เงินในกระเป๋า', cash(wallet), wallet, true), metric('reserved', 'สำรองค่าจ้าง', cash(reserved), reserved, true), metric('spendable', 'ใช้จ่ายได้', cash(spendable), spendable, true), metric('stock', 'สินค้าคงคลัง', `${count(firm.inventory)} หน่วย`, firm.inventory), metric('workers', 'แรงงาน / รับได้', `${firm.employees.length} / ${capacity}`, firm.employees.length), metric('profit', 'กำไรรอบก่อนภาษี', cash(firm.lastMonthProfit, true), firm.lastMonthProfit, true, hasClosedMonth ? 'เดือนล่าสุดที่ปิดบัญชี' : 'ยังไม่มีเดือนที่ปิดบัญชี')
  ]), el('p', 'cx-detail-note', 'เงินในกระเป๋ารวมค่าจ้างที่ต้องสำรองไว้แล้ว ยอดใช้จ่ายได้จึงหักเงินสำรองออกก่อน สินค้าคงคลังเป็นจำนวนปัจจุบัน'), employees, activity(city, 'money', firm.wallet, `บริษัท #${firm.id}`), activity(city, 'goods', firm.wallet, `บริษัท #${firm.id}`)];
}
function renderHousehold(city: City, selected: Exclude<ContextSelection, { kind: 'place' } | null>): HTMLElement[] {
  const household = city.households.find(value => value.id === selected.id);
  if (!household) return [empty('ไม่พบครัวเรือนนี้แล้ว', 'ครัวเรือนอาจย้ายออกหลังรื้อบ้าน ข้อมูลเดิมจึงไม่ถูกแสดงแทนข้อมูลปัจจุบัน')];
  const home = city.buildings.find(value => value.id === household.home), employer = household.employer === null ? null : city.firms.find(value => value.id === household.employer), wallet = city.accounts[household.wallet] ?? 0;
  const identity = el('div', 'cx-identity'), art = el('span', 'cx-person-symbol'); art.append(symbol('household')); identity.append(art, heading(`ครัวเรือน #${household.id}`, 'หน่วยข้อมูลเป็นครัวเรือน ไม่ได้จำลองรายบุคคล'));
  const job = household.employer === null ? 'ว่างงาน' : employer ? `บริษัท #${employer.id}` : `ไม่พบบริษัท #${household.employer}`;
  const origin = el('p', 'cx-backref', `เปิดจากอาคาร #${selected.sourceBuildingId} · บ้านพักปัจจุบัน ${home ? `#${home.id}` : `ไม่พบ #${household.home}`}`);
  const output: HTMLElement[] = [identity, origin, metrics([
    metric('cash', 'เงินในกระเป๋า', cash(wallet), wallet, true), metric('home', 'บ้านพักปัจจุบัน', home ? `อาคาร #${home.id}` : 'ไม่พบอาคาร', household.home), metric('employer', 'งานปัจจุบัน', job, household.employer === null ? 'null' : household.employer), metric('needs', 'ยังไม่ได้ซื้อสินค้า', `${household.needs} วัน`, household.needs), metric('last-purchase', 'ซื้อครั้งล่าสุด', purchaseText(city, household), household.lastPurchaseTick)
  ])];
  if (home) output.push(status(city, home.cell));
  output.push(el('p', 'cx-detail-note', household.lastPurchaseTick === city.tick ? 'วันนี้ครัวเรือนนี้ซื้อสินค้า 1 หน่วยแล้ว ตรวจคู่บัญชีและการใช้สินค้าได้ด้านล่าง' : 'รายการซื้อจะเกิดเมื่อครัวเรือนมีเงิน และเข้าถึงร้านค้าที่มีคนงานกับสินค้า ตัวเลขวันไม่ได้ซื้ออ้างอิงจากความต้องการค้างของครัวเรือนนี้'), activity(city, 'money', household.wallet, `ครัวเรือน #${household.id}`), activity(city, 'goods', household.wallet, `ครัวเรือน #${household.id}`)); return output;
}

/** Entity-only content. Parent owns modes, headings, parcel explanations and navigation. */
export function renderContext(city: City, selection: ContextSelection, onHousehold: HouseholdAction): void {
  const host = document.getElementById('entity-content'); if (!host) return; host.classList.add('cx-content');
  installInputGuard(host);
  const request: ContextRequest = { city, selection: selection ? { ...selection } : null, onHousehold }; latestRequest = request;
  const scope = scopeOf(city, selection), revision = `${city.tick}:${city.ledger.length}:${city.goodsLedger.length}:${city.buildings.length}:${city.households.length}:${city.firms.length}:${city.utilities.power}:${city.utilities.water}`;
  const changedScope = renderedCity !== city || renderedScope !== scope;
  if (changedScope || !heldTargetsExist(city)) clearHeldRender();
  // Do not replace a real pressed control on a tick. Its click remains native
  // and synchronous; only a same-context presentation refresh is queued.
  if (!changedScope && (heldPointers.size || heldKeys.size || releaseBarrier)) { queuedRequest = request; return; }
  if (!changedScope && renderedRevision === revision) return;
  queuedRequest = null; renderedCity = city; renderedScope = scope; renderedRevision = revision;
  if (latestCity && latestCity !== city) activityLimits.clear(); latestCity = city;
  const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement.dataset.contextFocus : undefined;
  delete host.dataset.wallet; delete host.dataset.buildingId; delete host.dataset.cell; delete host.dataset.entityId;
  if (selection === null) { host.dataset.scope = 'none'; host.replaceChildren(); return; }
  host.dataset.scope = selection.kind;
  if (selection.kind === 'household') {
    host.dataset.entityId = String(selection.id); const household = city.households.find(value => value.id === selection.id); if (household) host.dataset.wallet = household.wallet; host.replaceChildren(...renderHousehold(city, selection));
  } else {
    const place = resolvePlace(city, selection.cell); host.dataset.cell = String(selection.cell);
    if (!place.building) { host.replaceChildren(); return; }
    host.dataset.entityId = String(place.building.id); host.dataset.buildingId = String(place.building.id);
    if (place.building.zone === 'R') host.replaceChildren(...renderHouse(city, place.building, place.households, navigateHousehold));
    else if (place.firm) { host.dataset.wallet = place.firm.wallet; host.replaceChildren(...renderFirm(city, place.building, place.firm, navigateHousehold)); }
    else host.replaceChildren(empty('ไม่พบข้อมูลบริษัท', 'อาคารนี้ไม่มีบริษัทที่อ้างอิงอยู่ในข้อมูลเมืองปัจจุบัน'));
  }
  if (focused) [...host.querySelectorAll<HTMLElement>('[data-context-focus]')].find(node => node.dataset.contextFocus === focused)?.focus({ preventScroll: true });
}

/** Current stocks and actual inclusive last-30-day flows are kept visually separate. */
export function renderCityOverview(city: City): void {
  const host = document.getElementById('city-overview'); if (!host) return; host.classList.add('cx-content'); host.dataset.scope = 'city';
  const data = cityOverview(city); Object.assign(host.dataset, { fromTick: String(data.fromTick), toTick: String(data.toTick) });
  const stocks = section('ยอดและจำนวนปัจจุบัน', `ณ วันที่ ${data.toTick}`); stocks.classList.add('cx-stock-card');
  stocks.append(metrics([metric('treasury', 'คลังเมืองตอนนี้', cash(data.treasury), data.treasury, true), metric('households', 'ครัวเรือน', count(data.households), data.households), metric('employed', 'ครัวเรือนมีงาน', count(data.employed), data.employed), metric('jobs', 'ตำแหน่งงาน', count(data.jobs), data.jobs), metric('firms', 'บริษัท', count(data.firms), data.firms), metric('inventory', 'สินค้าคงคลังตอนนี้', `${count(data.inventory)} หน่วย`, data.inventory)]));
  const period = el('div', 'cx-period-banner'); period.append(el('h3', '', `รายการช่วงวันที่ ${data.fromTick}–${data.toTick}`), el('p', '', 'รวมรายการจริงในช่วงไม่เกิน 30 วันล่าสุด รวมวันต้นและวันปลาย ไม่ใช่ยอดคงเหลือปัจจุบัน'));
  const flows = section('เงินเข้าออกคลังในช่วงนี้'); flows.classList.add('cx-periodflows'); flows.append(metrics([metric('income', 'เงินเข้าคลัง', cash(data.income), data.income, true), metric('expense', 'เงินออกคลัง', cash(data.expense), data.expense, true), metric('net', 'สุทธิของช่วงนี้', cash(data.net, true), data.net, true)]), el('p', 'cx-detail-note', 'นับเฉพาะรายการที่ต้นทางหรือปลายทางเป็นคลังเมือง หากเงินตั้งเมืองยังอยู่ในช่วงนี้ จะรวมเป็นเงินเข้าด้วย'));
  const goods = section('สินค้าเคลื่อนย้ายในช่วงนี้'); goods.classList.add('cx-periodflows'); goods.append(metrics([metric('produced', 'ผลิต', `${count(data.produced)} หน่วย`, data.produced), metric('imported', 'นำเข้า', `${count(data.imported)} หน่วย`, data.imported), metric('consumed', 'บริโภค', `${count(data.consumed)} หน่วย`, data.consumed), metric('exported', 'ส่งออกขาย', `${count(data.exported)} หน่วย`, data.exported)]), el('p', 'cx-detail-note', 'การส่งออกขายไม่รวมการตัดสต็อกทิ้งจากการรื้อถอน สินค้าคงคลังในกล่องด้านบนเป็นจำนวนที่เหลืออยู่ตอนนี้'));
  const utilities = el('div', 'cx-status'); utilities.append(chip(data.power ? 'ไฟฟ้าภายนอกพร้อม' : 'ไฟฟ้าภายนอกไม่พร้อม', data.power), chip(data.water ? 'น้ำภายนอกพร้อม' : 'น้ำภายนอกไม่พร้อม', data.water));
  const warnings = section('สิ่งที่ควรตรวจสอบ'), list = el('ul', 'cx-warning-list');
  if (data.warnings.length) for (const warning of data.warnings) list.append(el('li', '', warning)); else list.append(el('li', '', 'ไม่พบคำเตือนจากการตรวจข้อมูลเมืองรอบนี้'));
  warnings.append(list); host.replaceChildren(heading('ภาพรวมเมือง', 'ยอดรวมของทั้งเมือง แยกจำนวนปัจจุบันออกจากรายการในช่วงเวลา'), stocks, period, flows, goods, utilities, warnings);
}
