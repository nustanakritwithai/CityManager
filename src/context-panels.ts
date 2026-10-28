import './context-panels.css';
import './building-cards.css';
import { householdFoodToday } from './food-demand.ts';
import { firmGoodsLine, firmGoodsName } from './goods-view.ts';
import { CROPS, CROP_LABELS, PRODUCT_LABELS, RECIPE, RECIPE_LABELS } from './goods.ts';
import { MONTH, access, departureDay, farmCrop, farmCropMode, householdWorkerCount, employmentForHousehold, housingCapacity, homeOccupancy, explainMigration, utilityAt, firmCapacity, firmRent, firmWage, ownerFinance, deadFirm, factoryTakeoverRecipe, isMarket, isRetail, type City, type Household, type Firm, type Building } from './sim.ts';
import { resolvePlace, relatedFlows, cityOverview, householdLabor, firmLabor, contextRevision, householdConsumption, growthStatusText, WORKER_SKILL_LABELS, WORKER_SKILL_ROLES } from './context-data.ts';
import { formatMoney, cropFlowRows, accountLabel, reasonLabel, type CropFlowRow, type FlowKind, type FlowRow } from './inspector-data.ts';
import { CROP_STOCK_CAPS, CHAIN_CROP_PRICES as CROP_PRICES, CROP_RECIPE, harvestYield } from './agriculture.ts';
import { buildingCardData, householdCardData } from './building-card-data.ts';
import { growthChecklist } from './overview-data.ts';
import { buildingIssues } from './map-overlay.ts';
import { iconElement } from './ui-icons.ts';

export type ContextSelection = { kind: 'place'; cell: number } | { kind: 'household'; id: number; sourceBuildingId: number; sourceCell: number } | null;
type HouseholdAction = (id: number, sourceBuildingId: number, sourceCell: number) => void;
type FarmCropAction = (firmId: number, crop: typeof CROPS[number] | 'auto') => void;
type OwnerFinanceAction = (action: 'contribute' | 'withdraw', firmId: number) => void;
let latestCity: City | null = null;
const activityLimits = new Map<string, number>();
const expandedActivity = new Set<string>(), expandedFacts = new Set<string>();
const ownerFeedback = new Map<number, string>();
type ContextRequest = { city: City; selection: ContextSelection; onHousehold: HouseholdAction; onOwnerFinance?: OwnerFinanceAction; onFarmCrop?: FarmCropAction };
let latestRequest: ContextRequest | null = null, queuedRequest: ContextRequest | null = null;
let renderedCity: City | null = null, renderedScope = '', renderedRevision = '';
let guardedHost: HTMLElement | null = null, releaseBarrier = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const heldPointers = new Map<number, HTMLElement>(), heldKeys = new Map<string, HTMLElement>();
const cash = (value: number, signed = false) => `${formatMoney(value, signed)} ฿`;
const count = (value: number) => value.toLocaleString('th-TH');

/** UI-only feedback survives a native click's deferred same-context refresh. */
export function showOwnerFinanceResult(firmId: number, message: string): void {
  const request = latestRequest;
  if (!request || request.selection?.kind !== 'place' || resolvePlace(request.city, request.selection.cell).firm?.id !== firmId) return;
  ownerFeedback.set(firmId, message);
  const node = document.getElementById('owner-finance-status'); if (node?.dataset.firmId === String(firmId)) node.textContent = message;
}

function clearHeldRender() {
  heldPointers.clear(); heldKeys.clear(); queuedRequest = null; releaseBarrier = false;
  if (flushTimer !== null) clearTimeout(flushTimer); flushTimer = null;
}
function flushAfterActivation(waitForClick = false) {
  // A touch compatibility click may follow pointerup in a later task. Retain
  // its node until the trusted click, then flush after native activation.
  releaseBarrier = true;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null; releaseBarrier = false;
    if (heldPointers.size || heldKeys.size) return;
    const request = queuedRequest; queuedRequest = null;
    if (request && request === latestRequest) renderContext(request.city, request.selection, request.onHousehold, request.onOwnerFinance, request.onFarmCrop);
  }, waitForClick ? 750 : 0);
}
function installInputGuard(host: HTMLElement) {
  if (guardedHost === host) return; guardedHost = host; clearHeldRender(); renderedRevision = '';
  host.addEventListener('pointerdown', event => {
    if (event.isTrusted && event.target instanceof Element) {
      const target = event.target.closest<HTMLElement>('button, summary') ?? (event.target instanceof HTMLElement ? event.target : host);
      heldPointers.set(event.pointerId, target);
    }
  }, true);
  host.addEventListener('keydown', event => {
    if (event.isTrusted && (event.key === ' ' || event.key === 'Enter') && event.target instanceof HTMLElement && event.target.closest('button, summary')) heldKeys.set(event.key, event.target);
  }, true);
  document.addEventListener('pointerup', event => { if (heldPointers.delete(event.pointerId)) flushAfterActivation(true); }, true);
  document.addEventListener('pointercancel', event => { if (heldPointers.delete(event.pointerId)) flushAfterActivation(); }, true);
  document.addEventListener('keyup', event => { if (heldKeys.delete(event.key)) flushAfterActivation(event.key === ' '); }, true);
  document.addEventListener('click', event => { if (event.isTrusted && releaseBarrier) flushAfterActivation(); }, true);
  window.addEventListener('blur', () => { if (heldPointers.size || heldKeys.size || releaseBarrier) { heldPointers.clear(); heldKeys.clear(); flushAfterActivation(); } });
}
function scopeOf(city: City, selection: ContextSelection): string {
  if (!selection) return 'none';
  if (selection.kind === 'place') return `place:${selection.cell}:${resolvePlace(city, selection.cell).building?.id ?? 'empty'}`;
  const household = city.households.find(value => value.id === selection.id), source = city.buildings.find(value => value.id === selection.sourceBuildingId && value.cell === selection.sourceCell);
  return `household:${selection.id}:${household ? household.home ?? 'homeless' : 'missing'}:${selection.sourceBuildingId}:${selection.sourceCell}:${source ? 'source' : 'missing-source'}`;
}
function heldTargetsExist(city: City): boolean {
  return [...heldPointers.values(), ...heldKeys.values()].every(target => {
    if (!target.isConnected) return false;
    const button = target.closest<HTMLElement>('button[data-household-id]');
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
function facts(key: string, title: string, ...content: HTMLElement[]): HTMLDetailsElement {
  const body = el('details', 'cx-facts'), summary = el('summary', '', title), copy = el('div', 'cx-facts-copy');
  summary.dataset.contextFocus = `facts:${key}`; copy.append(...content); body.append(summary, copy); body.open = expandedFacts.has(key);
  const remember = () => { if (body.isConnected) { if (body.open) expandedFacts.add(key); else expandedFacts.delete(key); } };
  // The native click default toggles details before this microtask. Cache it
  // before the held-input guard's next-task refresh can replace the element.
  summary.addEventListener('click', () => queueMicrotask(remember)); body.addEventListener('toggle', remember);
  return body;
}
function metric(key: string, title: string, text: string, raw: number | string, money = false, note?: string): HTMLElement {
  const card = el('dl', `cx-metric${money ? ' money' : ''}`); card.dataset.contextMetric = key; card.dataset.value = String(raw); card.append(el('dt', '', title), el('dd', '', text)); if (note) card.append(el('small', '', note)); return card;
}
function metrics(cards: HTMLElement[]): HTMLElement { const grid = el('div', 'cx-metrics'); grid.append(...cards); return grid; }
function chip(text: string, good: boolean): HTMLElement { return el('span', `cx-chip ${good ? 'good' : 'warn'}`, text); }
function status(city: City, cell: number): HTMLElement {
  const row = el('div', 'cx-status'), connected = access(city, cell); row.append(chip(connected ? 'ถนนเชื่อมถึงเมือง' : 'ขาดถนนเชื่อม', connected), chip(utilityAt(city, cell) ? 'น้ำและไฟพร้อม' : 'น้ำหรือไฟไม่พร้อม', utilityAt(city, cell))); return row;
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
const businessName = (firm: Firm) => firm.zone === 'F' ? 'ฟาร์ม' : isMarket(firm) ? 'พาณิชย์ระดับ 1 · ตลาดพืชผล' : firm.zone === 'I' ? (firm.recipe ? RECIPE_LABELS[firm.recipe] : 'โรงงาน') : 'พาณิชย์ · ร้านค้าสำเร็จรูป';
/** Members as figures (working, idle, dependents) and the household purse as one coin chip. */
function householdVisual(household: Household, employed: number, wallet: number, label: string): HTMLElement {
  const row = el('span', 'cx-hh-visual'); row.title = label; row.setAttribute('aria-label', label);
  const figures = el('span', 'cx-hh-figures'), idle = Math.max(0, household.workforce - employed);
  for (const [n, tone] of [[employed, 'work'], [idle, 'idle'], [household.dependents, 'dep']] as const) for (let i = 0; i < n; i++) figures.append(iconElement('person', `ui-icon figure ${tone}`));
  const purse = el('span', 'cx-hh-cash'); purse.append(iconElement('coin', 'ui-icon'), el('span', '', `${Math.round(wallet / 100).toLocaleString('th-TH')} ฿`));
  row.append(figures, purse); return row;
}
function householdButton(city: City, household: Household, source: Building, onHousehold: HouseholdAction, assignedWorkers?: number, assignments: ReturnType<typeof employmentForHousehold> = [], ownerAssignments: City['ownerLabor'] = []): HTMLButtonElement {
  const button = el('button', 'cx-household-link'); button.type = 'button'; Object.assign(button.dataset, { householdId: String(household.id), sourceBuildingId: String(source.id), sourceCell: String(source.cell), contextFocus: `household:${household.id}` });
  Object.assign(button.dataset, { members: String(household.members), workforce: String(household.workforce), dependents: String(household.dependents), employedWorkers: String(householdWorkerCount(city, household.id)) });
  if (assignedWorkers !== undefined) button.dataset.assignedWorkers = String(assignedWorkers);
  if (assignedWorkers !== undefined) button.dataset.incomeRole = ownerAssignments.length ? 'self-employed' : 'employee';
  const labor = assignedWorkers === undefined ? `ทำงาน ${householdWorkerCount(city, household.id)}/${household.workforce} คน` : `จากแรงงานในบ้าน ${household.workforce} คน`;
  const art = el('span', 'cx-person-symbol'), copy = el('span', 'cx-link-copy'); art.append(symbol('household'));
  copy.append(el('strong', '', assignedWorkers === undefined ? `ครัวเรือน #${household.id}` : `${ownerAssignments.length ? 'ทำกิจการเอง' : 'รับแรงงาน'} ${assignedWorkers} คน · ครัวเรือน #${household.id}`));
  if (assignedWorkers === undefined) copy.append(householdVisual(household, householdWorkerCount(city, household.id), city.accounts[household.wallet] ?? 0, `${labor} · เงินร่วม ${cash(city.accounts[household.wallet] ?? 0)}`));
  else copy.append(el('span', '', `${labor} · เงินร่วม ${cash(city.accounts[household.wallet] ?? 0)}`));
  for (const allocation of assignments) {
    const role = el('span', 'cx-assigned-role', `${allocation.occupation === 'manufacturing' ? 'งานผลิต' : 'งานค้าปลีก'} · ${WORKER_SKILL_LABELS[allocation.skill]} ${allocation.workers} คน`);
    Object.assign(role.dataset, { skill: allocation.skill, occupation: allocation.occupation, workers: String(allocation.workers) }); copy.append(role);
  }
  for (const allocation of ownerAssignments) {
    const role = el('span', 'cx-assigned-role', `ทำตลาดเอง · ${WORKER_SKILL_LABELS[allocation.skill]} ${allocation.workers} คน · ไม่มีเงินเดือน`);
    Object.assign(role.dataset, { skill: allocation.skill, occupation: 'retail', workers: String(allocation.workers), incomeRole: 'self-employed' }); copy.append(role);
  }
  if (household.origin === 'legacy-v1') copy.append(el('small', 'cx-legacy-tag', 'สมาชิกจาก v1: สมมติขั้นต่ำ'));
  button.append(art, copy, el('span', 'cx-link-arrow', '→')); button.setAttribute('aria-label', `ดูข้อมูลครัวเรือน #${household.id}`); button.addEventListener('click', () => onHousehold(household.id, source.id, source.cell)); return button;
}
/** Provenance in words: who paid whom and why, then the ledger's own ids in small print for tracing. */
function rawLine(row: { from: string; to: string; reason: string }): HTMLElement {
  const line = el('p', 'cx-flow-raw', `${accountLabel(row.from)} → ${accountLabel(row.to)} · ${reasonLabel(row.reason)}`);
  line.append(el('small', 'cx-flow-id', `รหัสบัญชี ${row.from} → ${row.to} · ${row.reason}`)); return line;
}
function flowCard(row: FlowRow, wallet: string): HTMLElement {
  const key = JSON.stringify([wallet, row.kind, row.index, row.tick, row.from, row.to, row.value, row.reason]);
  const card = el('details', 'cx-flow-card'); Object.assign(card.dataset, { kind: row.kind, index: String(row.index), tick: String(row.tick), from: row.from, to: row.to, value: String(row.value), reason: row.reason });
  const summary = el('summary', 'cx-flow-summary'), top = el('div', 'cx-flow-top'), route = el('div', 'cx-flow-route'), detail = el('div', 'cx-flow-details');
  summary.dataset.contextFocus = `flow:${key}`;
  const incoming = row.to === wallet, direction = iconElement(row.kind !== 'money' ? 'box' : incoming ? 'import' : 'export', `ui-icon cx-flow-direction ${row.kind !== 'money' ? 'goods' : incoming ? 'in' : 'out'}`);
  top.append(direction, el('h4', '', row.label), el('strong', 'cx-amount cx-flow-value', row.kind === 'money' ? cash(row.value) : `${count(row.value)} หน่วย`));
  summary.append(top, el('span', 'cx-flow-inline', `วัน ${row.tick} · ${row.fromLabel} → ${row.toLabel}`));
  route.append(el('span', '', row.fromLabel), el('span', 'cx-route-arrow', '→'), el('span', '', row.toLabel));
  detail.append(el('p', 'cx-flow-meta', `วัน ${row.tick} · รายการ #${row.index + 1}`), route, rawLine(row));
  card.append(summary, detail); card.open = expandedActivity.has(key);
  const remember = () => { if (card.isConnected) { if (card.open) expandedActivity.add(key); else expandedActivity.delete(key); } };
  summary.addEventListener('click', () => queueMicrotask(remember)); card.addEventListener('toggle', remember);
  return card;
}
function activity(city: City, kind: FlowKind, wallet: string, owner: string): HTMLElement {
  const body = section(kind === 'money' ? 'รายการเงินของบัญชีนี้' : 'รายการสินค้าที่เกี่ยวข้อง'), rows = relatedFlows(city, kind, wallet), key = `${wallet}:${kind}`;
  body.classList.add('cx-activity'); Object.assign(body.dataset, { wallet, kind, scope: 'wallet' });
  const note = el('p', 'cx-account-note', `${owner} · ${wallet} เท่านั้น`), counter = el('p', 'cx-count'), list = el('div', 'cx-flow-list'), controls = el('div', 'cx-flow-controls'), toggle = el('button', 'cx-button'); toggle.type = 'button'; toggle.dataset.contextFlowAction = 'toggle'; toggle.dataset.kind = kind; toggle.dataset.wallet = wallet; toggle.dataset.contextFocus = `activity:${wallet}:${kind}`;
  function update() {
    const limit = activityLimits.get(key) ?? 8, shown = Math.min(rows.length, limit); counter.textContent = `แสดง ${count(shown)} จาก ${count(rows.length)} รายการ · ใหม่ → เก่า`; counter.dataset.shown = String(shown); counter.dataset.total = String(rows.length);
    list.replaceChildren(...(rows.length ? rows.slice(0, shown).map(row => flowCard(row, wallet)) : [el('p', 'cx-detail-note', kind === 'money' ? 'ยังไม่มีการโอนเงินที่เกี่ยวข้องกับบัญชีนี้' : 'ยังไม่มีการเคลื่อนย้ายสินค้าที่เกี่ยวข้องกับบัญชีนี้')]));
    toggle.hidden = rows.length <= 8; toggle.textContent = limit === Infinity ? 'กลับ 8 รายการล่าสุด' : `ดูทั้งหมด ${count(rows.length)} รายการ`; toggle.setAttribute('aria-expanded', String(limit === Infinity));
  }
  toggle.addEventListener('click', () => { activityLimits.set(key, activityLimits.get(key) === Infinity ? 8 : Infinity); update(); }); controls.append(toggle); body.append(note, counter, list, controls); update(); return body;
}
function capacityMetric(key: string, title: string, occupied: number, capacity: number, unit: string): HTMLElement {
  const card = metric(key, title, `${count(occupied)} / ${count(capacity)} ${unit}`, occupied); card.dataset.capacity = String(capacity);
  const share = capacity > 0 ? Math.min(1, occupied / capacity) : 0;
  if (capacity > 0 && capacity <= 16) { // small capacities read better as one dot per slot
    const dots = el('span', 'cx-capacity-dots'); dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < capacity; i++) dots.append(el('i', i < occupied ? 'on' : ''));
    card.append(dots); return card;
  }
  const bar = el('span', 'cx-capacity-bar'); bar.setAttribute('aria-hidden', 'true');
  bar.style.setProperty('--share', share.toFixed(3)); if (share >= 1) bar.classList.add('full'); card.append(bar); return card;
}
function cropCard(row: CropFlowRow, wallet: string): HTMLElement {
  const key = JSON.stringify([wallet, 'crops', row.id, row.tick, row.cropKind, row.from, row.to, row.value, row.fromValue, row.toValue, row.cash]);
  const card = el('details', 'cx-flow-card cx-crop-card');
  Object.assign(card.dataset, { kind: 'crops', index: String(row.index), id: String(row.id), tick: String(row.tick), from: row.from, to: row.to, value: String(row.value), reason: row.reason, cropKind: row.cropKind, fromValue: String(row.fromValue), toValue: String(row.toValue), cash: String(row.cash), workers: String(row.workers), batches: String(row.batches), outputQuantity: String(row.outputQuantity) });
  const summary = el('summary', 'cx-flow-summary'), top = el('div', 'cx-flow-top'), detail = el('div', 'cx-flow-details');
  summary.dataset.contextFocus = `crop:${key}`;
  top.append(el('h4', '', `${row.label} #${row.id}`), el('strong', 'cx-amount', `${count(row.value)} ล็อตพืชผล`));
  summary.append(top, el('span', 'cx-flow-inline', `วัน ${row.tick} · ${row.fromLabel} → ${row.toLabel}`));
  detail.append(el('p', 'cx-flow-meta', `วัน ${row.tick} · รหัสพืชผล #${row.id} · แยกจากบัญชีสินค้าสำเร็จรูป`), el('p', '', `มูลค่าตัดจากต้นทาง ${cash(row.fromValue)} · มูลค่าเข้าสต็อก ${cash(row.toValue)} · เงินโอน ${cash(row.cash)}`));
  if (row.cropKind === 'process') detail.append(el('p', '', `แปรรูป ${row.batches} ชุด → สินค้าสำเร็จรูป ${row.outputQuantity} หน่วย · แรงงาน ${row.workers} คน`));
  detail.append(rawLine(row)); card.append(summary, detail); card.open = expandedActivity.has(key);
  const remember = () => { if (card.isConnected) { if (card.open) expandedActivity.add(key); else expandedActivity.delete(key); } };
  summary.addEventListener('click', () => queueMicrotask(remember)); card.addEventListener('toggle', remember); return card;
}
function cropActivity(city: City, wallet: string, owner: string): HTMLElement {
  const body = section('บัญชีพืชผลของจุดนี้'), rows = cropFlowRows(city).filter(row => row.from === wallet || row.to === wallet), key = `${wallet}:crops`;
  body.classList.add('cx-activity', 'cx-crop-activity'); Object.assign(body.dataset, { wallet, kind: 'crops', scope: 'wallet' });
  const note = el('p', 'cx-account-note', `${owner} · ${wallet} เท่านั้น · หน่วยเป็นล็อตพืชผล`), counter = el('p', 'cx-count'), list = el('div', 'cx-flow-list'), controls = el('div', 'cx-flow-controls'), toggle = el('button', 'cx-button'); toggle.type = 'button'; toggle.dataset.contextFocus = `limit:${key}`;
  const update = () => {
    const limit = activityLimits.get(key) ?? 8, shown = Math.min(rows.length, limit);
    counter.textContent = `แสดง ${count(shown)} จาก ${count(rows.length)} รายการ · ใหม่ → เก่า`; Object.assign(counter.dataset, { shown: String(shown), total: String(rows.length) });
    list.replaceChildren(...(rows.length ? rows.slice(0, shown).map(row => cropCard(row, wallet)) : [el('p', 'cx-detail-note', 'ยังไม่มีบัญชีเก็บเกี่ยว ซื้อขาย แปรรูป หรือตะกร้าพืชผลที่เกี่ยวข้องกับจุดนี้')]));
    toggle.hidden = rows.length <= 8; toggle.textContent = limit === Infinity ? 'กลับ 8 รายการล่าสุด' : `ดูทั้งหมด ${count(rows.length)} รายการ`; toggle.setAttribute('aria-expanded', String(limit === Infinity));
  };
  toggle.addEventListener('click', () => { activityLimits.set(key, activityLimits.get(key) === Infinity ? 8 : Infinity); update(); }); controls.append(toggle); body.append(note, counter, list, controls); update(); return body;
}
function legacyAssumption(household: Household): HTMLElement | null {
  if (household.origin !== 'legacy-v1') return null;
  const note = el('p', 'cx-legacy-assumption', 'ข้อมูล v1 ไม่มีจำนวนสมาชิก จึงตั้งต้นแบบสมมติขั้นต่ำ 1 คน / 1 แรงงาน / 0 ผู้พึ่งพิง ไม่ใช่ข้อมูลบุคคลย้อนหลังที่วัดไว้');
  Object.assign(note.dataset, { origin: household.origin, profile: household.profile, members: String(household.members), workforce: String(household.workforce), dependents: String(household.dependents) }); return note;
}
function renderHouse(city: City, building: Building, households: Household[], onHousehold: HouseholdAction): HTMLElement[] {
  const occupied = homeOccupancy(city, building.id), capacity = housingCapacity(building);
  const residents = section('ครัวเรือนที่พักอาศัย', `${households.length} ครัวเรือน · ${occupied.persons} คน`), list = el('div', 'cx-household-list');
  residents.classList.add('bc-residents-source');
  for (const household of households) list.append(householdButton(city, household, building, onHousehold));
  if (!households.length) list.append(empty('บ้านว่าง', 'ยังไม่มีครัวเรือนพักอาศัย การรับผู้ย้ายเข้าแยกจากการสร้างอาคารและเริ่มได้ในวันถัดไปเมื่อผ่านเงื่อนไข'));
  residents.append(list);
  const conditions = explainMigration(city, building.id).map(reason => el('p', '', reason));
  return [status(city, building.cell), metrics([
    capacityMetric('households', 'พักอยู่ / รับได้', occupied.households, capacity.households, 'ครัวเรือน'),
    capacityMetric('persons', 'สมาชิก / รับได้', occupied.persons, capacity.persons, 'คน'),
    metric('vacant-households', 'ช่องครัวเรือนว่าง', count(Math.max(0, capacity.households - occupied.households)), Math.max(0, capacity.households - occupied.households)),
    metric('vacant-persons', 'ความจุสมาชิกว่าง', `${count(Math.max(0, capacity.persons - occupied.persons))} คน`, Math.max(0, capacity.persons - occupied.persons)),
    metric('level', 'ระดับอาคาร', String(building.level), building.level), metric('age', 'อายุอาคาร', `${building.age} วัน`, building.age)
  ]), residents, facts(`house:${building.id}`, 'เงื่อนไขรับครัวเรือนและความจุ', ...conditions, el('p', '', `ความจุบ้านเป็นค่าที่เกมกำหนด ต้องเหลือทั้งช่องครัวเรือนและจำนวนคน การอัปเกรดเพิ่มความจุ ไม่ได้เพิ่มสมาชิกให้บ้านเอง`))];
}
function renderFirm(city: City, building: Building, firm: Firm, onHousehold: HouseholdAction): HTMLElement[] {
  const wallet = city.accounts[firm.wallet] ?? 0, reserved = Object.values(firm.workDays).reduce((sum, days) => sum + days * firmWage(firm) / MONTH, 0), spendable = Math.max(0, wallet - reserved), capacity = firmCapacity(building);
  const labor = firmLabor(city, firm.id)!, workers = labor.workers;
  const lastSettlement = city.tick - city.tick % MONTH, hasClosedMonth = lastSettlement > 0 && city.tick - building.age < lastSettlement;
  const employees = section('แรงงานที่รับจากแต่ละครัวเรือน', `${workers} คน · ${labor.householdCount} บัญชีครัวเรือน`), list = el('div', 'cx-household-list');
  employees.classList.add('bc-employment-source');
  for (const group of labor.households) {
    const household = city.households.find(value => value.id === group.householdId);
    if (household) list.append(householdButton(city, household, building, onHousehold, group.workers, group.allocations, group.ownerAllocations));
    else list.append(el('p', 'cx-detail-note', `ไม่พบครัวเรือน #${group.householdId} ในการจัดสรรแรงงาน`));
  }
  if (!labor.householdCount) list.append(el('p', 'cx-detail-note', isMarket(firm) ? 'เจ้าของยังไม่ได้ใช้แรงงานทำตลาดในวันนี้ กิจการและเงินยังคงแยกจากบ้านพัก' : 'ยังไม่มีแรงงานที่มีความสามารถตรงกับงานและสำรองค่าจ้างได้'));
  employees.append(list);
  if (isRetail(firm)) employees.append(el('p', 'cx-detail-note', firm.owner
    ? `ร้านค้าของครัวเรือน #${firm.owner.householdId}${firm.convertedAt !== undefined ? ` · ยกระดับจากตลาดเมื่อวันที่ ${firm.convertedAt}` : ''} · พาณิชย์ระดับ ${building.level} · เจ้าของยืนร้านเอง 1 คน ไม่มีเงินเดือน จ้างลูกจ้างได้อีก ${Math.max(0, capacity - 1)} คน`
    : `ร้านค้าสำเร็จรูป · พาณิชย์ระดับ ${building.level} · ทุนจากนักลงทุนภายนอก ตำแหน่งงานทั้งหมดเป็นลูกจ้าง`));
  const meanings = facts(`firm:${firm.id}`, 'เงินสำรอง แรงงาน และกำไรรอบบัญชี',
    el('p', '', isMarket(firm) ? 'ตลาดนี้เป็นกิจการทำเองของครัวเรือน ใช้แรงงานเจ้าของ 1 คน ไม่จ้างลูกจ้างและไม่มีเงินเดือนเจ้าของ เงินกิจการและเงินครัวเรือนเป็นคนละบัญชี การเติมทุนและถอนกำไรไม่ใช่รายได้หรือค่าใช้จ่ายดำเนินงานรอบใหม่' : 'เงินในกระเป๋ารวมค่าจ้างที่ต้องสำรองไว้แล้ว ยอดใช้จ่ายได้จึงหักเงินสำรองออกก่อน จ้างเป็นจำนวนแรงงานที่มีความสามารถตรงกับงาน ไม่ได้รับครัวเรือนทั้งบ้าน ผู้พึ่งพิงไม่ถูกนับเป็นแรงงาน ค่าจ้างสะสมตามวัน-แรงงานจริงและจ่ายเข้าบัญชีร่วมของครัวเรือน'),
    el('p', '', hasClosedMonth ? `กำไรก่อนภาษีของรอบบัญชีวันที่ ${Math.max(1, lastSettlement - MONTH + 1)}–${lastSettlement} รวมเฉพาะวันที่บริษัทดำเนินงาน ไม่ใช่กำไรที่เพิ่งรับในเดือนนี้` : 'ยังไม่มีเดือนที่ปิดบัญชี จึงยังไม่มีกำไรของรอบบัญชีก่อนหน้า'),
    el('p', '', `บริษัท #${firm.id} · อาคาร #${building.id} · บัญชี ${firm.wallet}`));
  const workerMetric = capacityMetric('workers', 'แรงงานทำงาน / รับได้', workers, capacity, 'คน');
  const funding: HTMLElement[] = [];
  if (firm.zone === 'I' && firm.fundedBy) {
    const source = section('ทุนเปิดกิจการที่โอนมาจริง'); source.classList.add('cx-industry-funding');
    Object.assign(source.dataset, { industryFunding: 'true', sponsorId: String(firm.fundedBy.firmId), capital: String(firm.fundedBy.capital) });
    source.append(metrics([
      growthMetric('funding-sponsor', 'กิจการผู้ลงทุน', `#${firm.fundedBy.firmId}`, firm.fundedBy.firmId),
      growthMetric('funding-capital', 'ทุนเมื่อเปิดกิจการ', cash(firm.fundedBy.capital), firm.fundedBy.capital, true),
    ]), el('p', 'cx-detail-note', 'ทุนนี้โอนจากบัญชีกิจการผู้ลงทุน ไม่ใช่ยอดขาย เงินคลัง หรือเงินกู้ เงินปัจจุบันและค่าจ้างของโรงงานนี้ยังแยกบัญชีตามเดิม'));
    funding.push(source);
  }
  return [el('p', 'cx-context-meta', `บริษัท #${firm.id} · ${firm.wallet}`), status(city, building.cell), metrics([
    metric('cash', 'เงินกิจการ', cash(wallet), wallet, true), metric('reserved', 'สำรองค่าจ้าง', cash(reserved), reserved, true), metric('spendable', 'เงินพ้นสำรองค่าจ้าง', cash(spendable), spendable, true), metric('stock', 'สำเร็จรูปคงคลัง', `${count(firm.inventory)} หน่วย`, firm.inventory), workerMetric, metric('household-count', 'บัญชีครัวเรือนของผู้ทำงาน', count(labor.householdCount), labor.householdCount), metric('profit', 'กำไรรอบก่อนภาษี', cash(firm.lastMonthProfit, true), firm.lastMonthProfit, true)
  ]), ...renderAgriculture(city, building, firm, labor.workers), ...funding, employees, meanings, activity(city, 'money', firm.wallet, `บริษัท #${firm.id}`), ...(firm.zone === 'I' || isRetail(firm) ? [activity(city, 'goods', firm.wallet, `บริษัท #${firm.id}`)] : []), ...(!isRetail(firm) ? [cropActivity(city, firm.wallet, `${businessName(firm)} #${firm.id}`)] : [])];
}
function renderAgriculture(city: City, building: Building, firm: Firm, workers: number): HTMLElement[] {
  if (isRetail(firm)) return [];
  const body = section(firm.zone === 'F' ? 'พื้นที่และผลผลิตการเกษตร' : isMarket(firm) ? 'พืชผลซื้อขายจริง' : 'วัตถุดิบและการแปรรูป'), cap = CROP_STOCK_CAPS[isMarket(firm) ? 'T' : firm.zone === 'F' ? 'F' : 'I'];
  body.classList.add('cx-agriculture'); body.dataset.firmId = String(firm.id);
  const cards = [capacityMetric('crop-stock', 'พืชผลคงคลัง / เก็บได้', firm.cropInventory, cap, 'ล็อต'), metric('crop-cost', 'มูลค่าพืชผลตามบัญชี', cash(firm.cropCost), firm.cropCost, true), metric('production-tick', 'วันประมวลผลล่าสุด', String(firm.productionTick), firm.productionTick)];
  if (firm.zone === 'F') {
    const fertility = city.resources.fertility[building.cell], actualHarvest = city.cropLedger.filter(entry => entry.tick === city.tick && entry.kind === 'harvest' && entry.to === firm.wallet).reduce((sum, entry) => sum + entry.quantity, 0);
    cards.push(metric('fertility', 'ความอุดมสมบูรณ์', `${fertility}%`, fertility), metric('yield-per-worker', 'กำลังเก็บเกี่ยว / แรงงาน', `${harvestYield(Math.max(50, fertility), 1)} ล็อต/วัน`, harvestYield(Math.max(50, fertility), 1)), metric('harvest-today', 'เก็บเกี่ยวจริงวันนี้', `${actualHarvest} ล็อต`, actualHarvest));
  } else if (firm.zone === 'I') cards.push(metric('recipe-input', 'พืชผล / ชุด', `${CROP_RECIPE.crop} ล็อต`, CROP_RECIPE.crop), metric('recipe-output', 'สำเร็จรูป / ชุด', `${CROP_RECIPE.goods} หน่วย`, CROP_RECIPE.goods), metric('available-batches', 'ชุดที่แรงงานและสต็อกรองรับ', String(Math.min(workers, Math.floor(firm.cropInventory / CROP_RECIPE.crop))), Math.min(workers, Math.floor(firm.cropInventory / CROP_RECIPE.crop))));
  else cards.push(metric('crop-buy-price', 'ซื้อจากฟาร์ม / ล็อต', cash(CROP_PRICES.farmToTrader), CROP_PRICES.farmToTrader, true), metric('crop-factory-price', 'ขายให้โรงงาน / ล็อต', cash(CROP_PRICES.traderToFactory), CROP_PRICES.traderToFactory, true), metric('crop-household-price', 'ตะกร้าครัวเรือน / ล็อต', cash(CROP_PRICES.householdCrop), CROP_PRICES.householdCrop, true), metric('rent', 'ค่าเช่าตลาด / เดือน', cash(firmRent(firm)), firmRent(firm), true));
  body.append(metrics(cards), el('p', 'cx-detail-note', firm.zone === 'F' ? 'พืชผลเก็บเกี่ยวตั้งมูลค่าคงคลังเริ่มต้นเป็นศูนย์ ค่าจ้างและค่าเช่ายังเป็นค่าใช้จ่ายงวด ไม่ได้เป็นผลตอบแทนรับประกัน' : firm.zone === 'I' ? `แต่ละวันใช้ ${CROP_RECIPE.crop} ล็อตจริงต่อ ${CROP_RECIPE.goods} หน่วยสำเร็จรูป ขาดวัตถุดิบผลิตไม่ได้ และไม่ประมวลผลซ้ำวันเดิม` : 'ตลาดไม่ผลิตหรือแปรรูป ซื้อพืชผลเข้าสต็อกก่อน ขายล็อตที่มีตั้งแต่ต้นวันเท่านั้น สต็อกที่โรงงานและครัวเรือนซื้อเป็นกองเดียวกัน'));
  if (firm.zone === 'I' && firm.cropInventory < CROP_RECIPE.crop) body.append(chip('ขาดพืชผลสำหรับแปรรูป', false));
  if (firm.zone === 'I' && deadFirm(city, firm) && !factoryTakeoverRecipe(city, firm)) body.append(el('p', 'cx-detail-note', 'รอวัตถุดิบที่เข้าถึงได้ก่อนผู้ลงทุนรายใหม่รับช่วงโรงงาน ตรวจฟาร์ม แรงงาน น้ำไฟ และถนนที่เชื่อมต่อ'));
  const output = [body];
  if (isMarket(firm) || isRetail(firm) && firm.owner) output.push(renderOwnerFinance(city, firm)); return output;
}
function renderOwnerFinance(city: City, firm: Firm): HTMLElement {
  const body = section('เจ้าของที่ทำกิจการเอง'), data = ownerFinance(city, firm.id);
  body.classList.add('bc-owner-source');
  if (!data) { body.append(el('p', 'cx-detail-note', 'ไม่พบเจ้าของที่เชื่อมกับกิจการนี้')); return body; }
  body.dataset.ownerHouseholdId = String(data.ownerHouseholdId);
  body.append(metrics([
    metric('owner-household', 'ครัวเรือนเจ้าของ', `#${data.ownerHouseholdId}`, data.ownerHouseholdId), metric('realised-profit', 'กำไรดำเนินงานสะสม', cash(data.realizedProfit, true), data.realizedProfit, true),
    metric('owner-capital-contributed', 'ทุนที่เจ้าของเติมจริง', cash(data.capitalContributed), data.capitalContributed, true), metric('owner-capital-returned', 'ทุนที่คืนจริง', cash(data.capitalReturned), data.capitalReturned, true),
    metric('owner-withdrawn', 'ถอนกำไรไปแล้ว', cash(data.withdrawn), data.withdrawn, true), metric('owner-tax', 'ภาษีกำไรจ่ายแล้ว', cash(data.taxPaid), data.taxPaid, true), metric('owner-tax-reserve', 'สำรองภาษีกำไรงวดนี้', cash(data.taxReserve), data.taxReserve, true),
    metric('distributable', 'กำไรที่ยังแจกจ่ายได้', cash(data.distributable), data.distributable, true), metric('drawable', 'ถอนตามกำไรและเงินสดได้', cash(data.withdrawAvailable), data.withdrawAvailable, true),
  ]));
  const controls = el('div', 'cx-owner-controls');
  for (const action of ['contribute', 'withdraw'] as const) {
    const available = action === 'contribute' ? data.contributeAvailable : data.withdrawAvailable, amount = 10000;
    const label = action === 'contribute' ? 'เติมทุน 100 บาท' : 'ถอนกำไร 100 บาท', button = el('button', 'cx-button', label), note = el('p', 'cx-detail-note'); button.type = 'button';
    const reason = action === 'contribute' ? data.contributeReason : data.withdrawReason;
    const unavailable = !latestRequest?.onOwnerFinance ? 'หน้าข้อมูลนี้เปิดดูอย่างเดียว' : available < amount ? `${reason} · โอนได้ ${cash(available)} ต้องมีอย่างน้อย ${cash(amount)}` : '';
    Object.assign(button.dataset, { ownerAction: action, firmId: String(firm.id), amount: String(amount), available: String(available), contextFocus: `owner:${firm.id}:${action}` }); button.disabled = !!unavailable; button.title = unavailable || label;
    note.textContent = unavailable || (action === 'contribute' ? 'จากเงินร่วมครัวเรือน → บัญชีตลาด เป็นทุน ไม่ใช่ยอดขาย' : `จากกำไรที่มีจริง → เงินร่วมครัวเรือน คงเงินหมุนเวียนอย่างน้อย ${cash(data.workingCashFloor)}`);
    button.addEventListener('click', () => { ownerFeedback.delete(firm.id); latestRequest?.onOwnerFinance?.(action, firm.id); }); const item = el('div'); item.append(button, note); controls.append(item);
  }
  const feedback = el('p', 'cx-detail-note', ownerFeedback.get(firm.id) ?? ''); feedback.id = 'owner-finance-status'; feedback.dataset.firmId = String(firm.id); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
  body.append(controls, feedback, el('p', 'cx-detail-note', 'เงินกิจการและเงินครัวเรือนแยกบัญชี เจ้าของไม่มีเงินเดือน ยอดขายไม่ถูกกวาดเข้าบ้านอัตโนมัติ การซื้อสต็อกยังไม่ใช่ค่าใช้จ่ายทั้งหมดหรือกำไรรับแล้ว')); return body;
}
function employmentRow(city: City, allocation: ReturnType<typeof employmentForHousehold>[number]): HTMLElement {
  const row = el('div', 'cx-employment-row'); Object.assign(row.dataset, { householdId: String(allocation.householdId), firmId: String(allocation.firmId), workers: String(allocation.workers), occupation: allocation.occupation, rank: allocation.rank, skill: allocation.skill });
  const firm = city.firms.find(value => value.id === allocation.firmId), occupation = allocation.occupation === 'manufacturing' ? 'งานผลิต' : allocation.occupation === 'retail' ? 'งานค้าปลีก' : allocation.occupation;
  row.dataset.incomeRole = 'employee'; row.append(el('strong', '', `${allocation.workers} คน → ${firm ? businessName(firm) : 'กิจการ'} #${allocation.firmId}`), el('span', '', `ลูกจ้าง · ${occupation} · ทักษะ${WORKER_SKILL_LABELS[allocation.skill]} · ${allocation.rank === 'entry' ? 'ระดับเริ่มต้น' : allocation.rank}`)); return row;
}
function ownerLaborRow(allocation: City['ownerLabor'][number]): HTMLElement {
  const row = el('div', 'cx-owner-labor-row');
  Object.assign(row.dataset, { householdId: String(allocation.householdId), firmId: String(allocation.firmId), skill: allocation.skill, workers: String(allocation.workers), incomeRole: 'self-employed' });
  row.append(el('strong', '', `ทำกิจการเอง ${allocation.workers} คน → ตลาดพืชผล #${allocation.firmId}`), el('span', '', `ทักษะ${WORKER_SKILL_LABELS[allocation.skill]} · ไม่มีเงินเดือนเจ้าของ · เงินกิจการแยกบัญชี`)); return row;
}
function renderWorkerSkills(city: City, household: Household): HTMLElement {
  const data = householdLabor(city, household.id)!, body = section('กลุ่มความสามารถของแรงงาน', `${data.workforce} คน · ไม่รวมผู้พึ่งพิง`), list = el('div', 'cx-skill-list');
  body.classList.add('bc-skills-source');
  for (const skill of data.skills) {
    const row = el('div', 'cx-skill-row'); Object.assign(row.dataset, { skill: skill.skill, total: String(skill.total), employed: String(skill.employed), unemployed: String(skill.unemployed) });
    const heading = el('div', 'cx-skill-heading'); heading.append(el('strong', '', WORKER_SKILL_LABELS[skill.skill]), el('span', '', `${skill.total} คน`));
    row.append(heading, el('span', '', `ทำงาน ${skill.employed} · ว่าง ${skill.unemployed} · ${WORKER_SKILL_ROLES[skill.skill]}`)); list.append(row);
  }
  const note = el('p', data.skillSource === 'legacy-assumed' ? 'cx-legacy-assumption' : 'cx-detail-note', data.skillSource === 'legacy-assumed' ? 'เซฟเดิมไม่มีทักษะ จึงสมมติให้แรงงานเดิมเป็นกลุ่มทั่วไป ไม่ใช่ประวัติความสามารถที่เคยเก็บไว้' : 'กลุ่มความสามารถเป็นพารามิเตอร์รับผู้ย้ายเข้าในเกม ไม่ใช่ข้อมูลการศึกษาหรือรายชื่อบุคคล');
  note.dataset.skillSource = data.skillSource; body.append(list, el('p', 'cx-detail-note', `ลูกจ้าง ${data.employeeWorkers} คน · ทำกิจการเอง ${data.selfEmployedWorkers} คน · นับแต่ละแรงงานครั้งเดียว`), note); return body;
}
function renderHousehold(city: City, selected: Exclude<ContextSelection, { kind: 'place' } | null>): HTMLElement[] {
  const household = city.households.find(value => value.id === selected.id);
  if (!household) return [empty('ไม่พบครัวเรือนนี้', 'ครัวเรือนนี้ไม่อยู่ในข้อมูลเมืองปัจจุบัน ข้อมูลเดิมจึงไม่ถูกแสดงแทนข้อมูลปัจจุบัน')];
  const home = household.home === null ? null : city.buildings.find(value => value.id === household.home), wallet = city.accounts[household.wallet] ?? 0, labor = householdLabor(city, household.id)!, allocations = labor.allocations, employed = labor.employed, employers = labor.employers;
  const food = householdFoodToday(city, household);
  const origin = el('p', 'cx-backref', `เปิดจากอาคาร #${selected.sourceBuildingId} · บ้านพักปัจจุบัน ${household.home === null ? 'ยังไม่มีที่พัก' : home ? `#${home.id}` : `ไม่พบ #${household.home}`}`);
  Object.assign(origin.dataset, { sourceBuildingId: String(selected.sourceBuildingId), sourceCell: String(selected.sourceCell) });
  const output: HTMLElement[] = [el('p', 'cx-context-meta', `ครัวเรือน #${household.id} · ${household.wallet}`)];
  const assumed = legacyAssumption(household); if (assumed) output.push(assumed);
  output.push(metrics([
    metric('cash', 'เงินร่วมครัวเรือน', cash(wallet), wallet, true), metric('members', 'สมาชิกครัวเรือน', `${household.members} คน`, household.members),
    metric('workforce', 'แรงงานที่ทำงานได้', `${household.workforce} คน`, household.workforce), metric('dependents', 'ผู้พึ่งพิง', `${household.dependents} คน`, household.dependents),
    metric('employed', 'แรงงานที่ทำงาน', `${employed} คน`, employed), metric('unemployed', 'แรงงานว่าง', `${Math.max(0, household.workforce - employed)} คน`, Math.max(0, household.workforce - employed)),
    metric('employers', 'ที่ทำงาน / กิจการตนเอง', `${employers} แห่ง`, employers), metric('home', 'บ้านพักปัจจุบัน', household.home === null ? 'ยังไม่มีที่พัก' : home ? `อาคาร #${home.id}` : 'ไม่พบอาคาร', household.home === null ? 'null' : household.home),
    metric('food-today', 'อาหารที่ซื้อวันนี้', `${food.purchased} / ${food.required} หน่วย`, food.purchased), metric('food-missing', 'อาหารที่ยังขาดวันนี้', `${food.missing} หน่วย`, food.missing),
    metric('needs', 'วันต่อเนื่องที่อาหารไม่ครบ', `${household.needs} วัน`, household.needs), metric('last-purchase', 'ซื้อครั้งล่าสุด', purchaseText(city, household), household.lastPurchaseTick)
  ]));
  if (home) output.push(status(city, home.cell)); else { const row = el('div', 'cx-status'); row.append(chip('รอจัดหาที่พัก', false)); output.push(row); }
  const leaves = departureDay(city, household.id);
  if (leaves !== null) { const row = el('div', 'cx-status cx-departure-status'); row.dataset.departureDay = String(leaves); row.append(chip(`ไม่มีงาน · ย้ายออกในอีก ${leaves - city.tick} วัน`, false)); output.push(row); }
  const jobs = section('แรงงานที่แยกไปแต่ละกิจการ', `${employed} / ${household.workforce} คน · ${employers} กิจการ`), rows = el('div', 'cx-employment-list');
  jobs.classList.add('bc-employment-source');
  rows.append(...allocations.map(allocation => employmentRow(city, allocation)), ...labor.ownerAllocations.map(ownerLaborRow));
  if (!employed) rows.append(el('p', 'cx-detail-note', 'ยังไม่มีแรงงานได้งานที่ตรงความสามารถ เข้าถึงได้ และมีงบค่าจ้าง หรือทำตลาดของตนเอง'));
  if (leaves !== null) { const note = el('p', 'cx-detail-note cx-departure', `ถ้ายังไม่มีงานที่ได้ค่าจ้าง ครัวเรือนนี้จะย้ายออกพร้อมเงินออมตอนชำระสิ้นเดือนวันที่ ${leaves} (อีก ${leaves - city.tick} วัน)`); note.dataset.departureDay = String(leaves); rows.append(note); }
  jobs.append(rows); output.push(jobs, renderWorkerSkills(city, household));
  const consumed = householdConsumption(city, household.id), basket = el('p', 'cx-detail-note cx-last-commodity', consumed ? `บัญชีบริโภคล่าสุด: ${consumed.commodity === 'crops' ? 'พืชผล' : 'สินค้าสำเร็จรูป'} ${consumed.quantity} ${consumed.commodity === 'crops' ? 'ล็อต' : 'หน่วย'} · วัน ${consumed.tick}` : 'ยังไม่มีรายการบริโภคในบัญชีของครัวเรือนนี้');
  if (consumed) Object.assign(basket.dataset, { commodity: consumed.commodity, tick: String(consumed.tick), quantity: String(consumed.quantity) }); output.push(basket);
  output.push(facts(`household:${household.id}`, 'องค์ประกอบครัวเรือน บ้าน และการซื้อ', origin,
    el('p', '', `สมาชิก ${household.members} = กำลังแรงงาน ${household.workforce} + ผู้พึ่งพิง ${household.dependents} คน เป็นจำนวนรวมระดับครัวเรือน ไม่มีรายชื่อหรือตัวแทนรายบุคคล`),
    el('p', '', 'แต่ละกลุ่มความสามารถนับแรงงานคนละชุด ไม่ซ้ำกัน แรงงานรับจ้างกับแรงงานทำกิจการเองใช้เพดานคนชุดเดียวกัน ผู้พึ่งพิงไม่เข้าตลาดแรงงาน ค่าจ้างเข้าบัญชีร่วมของครัวเรือน ส่วนยอดขายของตลาดอยู่บัญชีกิจการจนถอนกำไรที่มีสิทธิ์ งานต้นแบบยังมีเพียงระดับเริ่มต้น ไม่มีการจำลองการศึกษา เลื่อนตำแหน่ง หรือการฝึกทักษะ'),
    el('p', '', household.home === null ? 'การรื้อบ้านทำให้รอที่พักใหม่ ครัวเรือนและเงินออมยังอยู่ ระบบจัดหาที่พักให้ผู้ถูกย้ายออกจากบ้านก่อนรับผู้ย้ายเข้าใหม่' : 'การย้ายที่พักคง ID กระเป๋าเงิน สมาชิก และค่าจ้างที่มีสิทธิ์รับเดิม ไม่ใช่การรับครัวเรือนใหม่'),
    el('p', '', 'สมาชิกแต่ละคนต้องการอาหารวันละ 1 หน่วย จากพืชผลในตลาดหรือสินค้าสำเร็จรูปในร้านค้า ครัวเรือนใช้เงินร่วมกันและซื้อได้เท่าที่มีเงินและสินค้า')),
    activity(city, 'money', household.wallet, `ครัวเรือน #${household.id}`), activity(city, 'goods', household.wallet, `ครัวเรือน #${household.id}`), cropActivity(city, household.wallet, `ครัวเรือน #${household.id}`)); return output;
}

type CardData = NonNullable<ReturnType<typeof buildingCardData> | ReturnType<typeof householdCardData>>;
type CardKind = CardData['kind'];
type CardParts = {
  values: Map<string, HTMLElement>; statuses: HTMLElement[]; assumptions: HTMLElement[];
  journals: HTMLElement[]; notes: HTMLElement[]; residents: HTMLElement | null;
  employment: HTMLElement | null; skills: HTMLElement | null; owner: HTMLElement | null; funding: HTMLElement | null;
};
function cardIcon(kind: CardKind): SVGElement {
  const paths: Record<CardKind, string> = {
    house: '<path d="m6 28 26-20 26 20M13 24v32h38V24M26 56V38h12v18M20 28h5m14 0h5"/>',
    household: '<circle cx="23" cy="22" r="8"/><circle cx="45" cy="26" r="6"/><path d="M8 54V43c0-15 30-15 30 0v11M41 39c10-4 17 0 17 9v6"/>',
    shop: '<path d="M9 27h46l-6-15H15zM12 27v29h40V27M23 56V39h18v17M9 27c0 9 12 9 12 0 0 9 11 9 11 0 0 9 11 9 11 0 0 9 12 9 12 0"/>',
    market: '<path d="m9 23 6-13h34l6 13M8 23h48M13 23v33m38-33v33M8 56h48M20 36h24l-3 15H23zM27 36v15m10-15v15M25 31h14"/>',
    factory: '<path d="M7 56V30l16-10v10l16-10v10h18v26H7M44 30V9h9v21M16 40h6m9 0h6m9 0h4M16 49h6m9 0h6m9 0h4"/>',
    farm: '<circle cx="48" cy="15" r="7"/><path d="M8 55h48M8 45h48M8 35h48M21 35V18M21 27C8 27 9 12 9 12c10 0 15 7 12 15M22 21C22 9 34 8 34 8c1 10-5 14-12 13"/>',
  };
  const host = el('div'); host.innerHTML = `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${paths[kind]}</svg>`; return host.firstElementChild as SVGElement;
}
function cardHero(data: CardData, city: City): HTMLElement {
  const labels: Record<CardKind, string> = { house: 'บ้านพัก · การอยู่อาศัย', household: 'ครัวเรือน · สมาชิกและเงินร่วม', shop: 'พาณิชย์ · ร้านค้าสำเร็จรูป', market: 'พาณิชย์ระดับ 1 · ตลาดพืชผล', factory: 'โรงงาน · การแปรรูป', farm: 'ฟาร์ม · พื้นที่และการเก็บเกี่ยว' };
  const hero = el('div', 'bc-hero'), icon = el('span', 'bc-type-icon'), copy = el('div', 'bc-hero-copy'); icon.append(cardIcon(data.kind));
  const identity = data.kind === 'household'
    ? `${data.identity.householdId === null ? 'ยังไม่พบรหัสครัวเรือน' : `ครัวเรือน #${data.identity.householdId}`} · ${data.identity.buildingId === null ? 'ยังไม่มีบ้านพัก' : `บ้านพัก: อาคาร #${data.identity.buildingId}`}`
    : `${data.identity.buildingId === null ? 'ยังไม่พบรหัสอาคาร' : `อาคาร #${data.identity.buildingId}`}${data.kind === 'house' ? '' : ` · ${data.identity.firmId === null ? 'ยังไม่พบรหัสกิจการ' : `กิจการ #${data.identity.firmId}`}`}`;
  const period = el('p', 'bc-period', data.kind === 'house' ? `วันที่ ${data.window.toTick}` : data.window.empty ? `เริ่มต้น · วันที่ ${data.window.toTick}` : `วันที่ ${data.window.fromTick}–${data.window.toTick}`);
  period.title = data.kind === 'house' ? 'สถานะที่พัก ณ วันนี้' : 'ยอดเงินสดในช่วงนี้ รวมวันต้นและปลาย'; period.prepend(iconElement('clock', 'ui-icon bc-period-icon'));
  Object.assign(period.dataset, { fromTick: String(data.window.fromTick), toTick: String(data.window.toTick), inclusive: String(data.window.inclusive), empty: String(data.window.empty) });
  const firm = data.kind === 'household' ? undefined : city.firms.find(f => f.id === data.identity.firmId);
  const goods = firm ? [el('div', 'bc-goods', `${firmGoodsName(city, firm)} · ${firmGoodsLine(city, firm)}`)] : [];
  copy.append(el('span', 'bc-type-label', labels[data.kind]), el('div', 'bc-identity', identity), ...goods, period); hero.append(icon, copy);
  const cell = data.kind === 'household' ? null : city.buildings.find(b => b.id === data.identity.buildingId)?.cell;
  if (cell != null) {
    const issue = buildingIssues(city).find(i => i.cell === cell), badge = el('span', `bc-status-badge ${issue ? 'bad' : 'good'}`, issue ? issue.text : 'ไม่พบปัญหา');
    badge.dataset.issue = issue?.kind ?? 'none'; copy.prepend(badge);
  }
  return hero;
}
/** Move existing metric nodes, retaining each raw key once and every live handler. */
function cardParts(nodes: HTMLElement[]): CardParts {
  const parts: CardParts = { values: new Map(), statuses: [], assumptions: [], journals: [], notes: [], residents: null, employment: null, skills: null, owner: null, funding: null };
  for (const node of nodes) {
    const cards = [...(node.matches('[data-context-metric]') ? [node] : []), ...node.querySelectorAll<HTMLElement>('[data-context-metric]')];
    for (const card of cards) { parts.values.set(card.dataset.contextMetric!, card); card.remove(); }
    for (const grid of node.querySelectorAll<HTMLElement>('.cx-metrics')) if (!grid.children.length) grid.remove();
    if (node.classList.contains('cx-metrics')) continue;
    if (node.classList.contains('cx-status')) parts.statuses.push(node);
    else if (node.classList.contains('cx-legacy-assumption')) parts.assumptions.push(node);
    else if (node.classList.contains('cx-activity')) parts.journals.push(node);
    else if (node.classList.contains('bc-residents-source')) parts.residents = node;
    else if (node.classList.contains('bc-employment-source')) parts.employment = node;
    else if (node.classList.contains('bc-skills-source')) parts.skills = node;
    else if (node.classList.contains('bc-owner-source')) parts.owner = node;
    else if (node.classList.contains('cx-industry-funding')) parts.funding = node;
    else parts.notes.push(node);
  }
  return parts;
}
function takeCards(parts: CardParts, keys: string[]): HTMLElement[] {
  return keys.flatMap(key => { const card = parts.values.get(key); if (!card) return []; parts.values.delete(key); return [card]; });
}
function cardKpis(cards: HTMLElement[]): HTMLElement { const grid = metrics(cards); grid.classList.add('bc-kpis'); return grid; }
function cardSection(node: HTMLElement, name: string, extra = ''): HTMLElement {
  node.classList.add('bc-section'); if (extra) node.classList.add(extra); node.dataset.cardSection = name; return node;
}
function cardGroup(title: string, name: string, cards: HTMLElement[], extra = ''): HTMLElement {
  const node = section(title); node.append(cardKpis(cards)); return cardSection(node, name, extra);
}
function cardStat(key: string, title: string, value: number | null, unit = '', money = false, signed = false): HTMLElement {
  const card = el('dl', `cx-metric bc-stat${money ? ' money' : ''}`); Object.assign(card.dataset, { cardMetric: key, value: value === null ? 'null' : String(value), available: String(value !== null) });
  card.append(el('dt', '', title), el('dd', '', value === null ? 'ยังไม่มีข้อมูล' : money ? cash(value, signed) : `${count(value)}${unit ? ` ${unit}` : ''}`)); return card;
}
function cardCash(data: CardData, parts: CardParts): HTMLElement {
  const node = cardGroup(data.kind === 'household' ? 'เงินร่วมและการโอนจริง' : 'เงินสดกิจการและการโอนจริง', 'finance', [
    ...takeCards(parts, ['cash']), cardStat('cash-inflow', 'เงินโอนเข้า', data.cash.inflow, '', true), cardStat('cash-outflow', 'เงินโอนออก', data.cash.outflow, '', true), cardStat('cash-net', 'โอนสุทธิ', data.cash.net, '', true, true),
  ]);
  Object.assign(node.dataset, { fromTick: String(data.window.fromTick), toTick: String(data.window.toTick), basis: data.cash.basis });
  node.append(el('p', 'cx-detail-note', `วันที่ ${data.window.fromTick}–${data.window.toTick} · เงินผ่านบัญชีจริง รวมทุนและการถอนที่เกิดขึ้น ไม่ใช่กำไรขาดทุน`)); return node;
}
function cardTrade(data: CardData): HTMLElement {
  const crops = data.kind === 'market', buy = crops ? data.prices.cropsBuy : data.prices.goodsBuy, sell = crops ? data.prices.cropsSell : data.prices.goodsSell, unit = crops ? 'ล็อตพืชผล' : 'หน่วยสำเร็จรูป';
  const outer = section(crops ? 'การซื้อและขายพืชผลจริง' : 'รับสินค้าและขายจริง', `วันที่ ${data.window.fromTick}–${data.window.toTick}`), flow = el('div', 'bc-retail-flow');
  Object.assign(outer.dataset, { fromTick: String(data.window.fromTick), toTick: String(data.window.toTick) });
  for (const [direction, values] of [['buy', buy], ['sell', sell]] as const) {
    const side = el('section', 'bc-trade-side'); side.dataset.direction = direction;
    const quantityKey = `${crops ? 'crops' : 'goods'}-${direction === 'buy' ? 'purchased' : 'sold'}`, price = cardStat(direction === 'buy' ? 'purchase-price' : 'sales-price', 'ราคาเฉลี่ยจากรายการจับคู่', values.unitSatang, '', true);
    price.dataset.status = values.status;
    if (values.unitSatang === null) {
      const unavailablePrice = { 'non-integer': 'ไม่ลงตัวเป็นสตางค์', ambiguous: 'จับคู่ไม่ชัดเจน', missing: 'ยังไม่มีรายการ', unsafe: 'แสดงค่าไม่ได้', observed: 'แสดงค่าไม่ได้' } as const;
      price.querySelector('dd')!.textContent = unavailablePrice[values.status];
    }
    side.append(el('h4', '', direction === 'buy' ? 'ซื้อเข้าสินค้าคงคลัง' : 'ขายออกจากสินค้าคงคลัง'), cardKpis([cardStat(quantityKey, direction === 'buy' ? 'ซื้อจริง' : 'ขายจริง', values.quantity, unit), cardStat(direction === 'buy' ? 'purchase-cash' : 'sales-cash', direction === 'buy' ? 'เงินซื้อจริง' : 'เงินขายจริง', values.cashSatang, '', true), price]));
    if (values.status !== 'observed') side.append(el('p', 'cx-detail-note', values.status === 'missing' ? 'ยังไม่มีรายการสินค้าและเงินที่จับคู่กันในช่วงนี้' : values.status === 'non-integer' ? 'ราคาเฉลี่ยมีเศษสตางค์ จึงแสดงยอดเงินจริงและปริมาณโดยไม่ปัดราคา' : 'ยังไม่แสดงราคา เพราะข้อมูลจับคู่ไม่ชัดเจนหรือเกินขอบเขตที่แสดงได้'));
    flow.append(side);
  }
  // The bars sum up the tiles above them; the tiles stay first so key numbers fit the first screen.
  outer.append(flow, tradeVisual(buy, sell, unit)); return cardSection(outer, 'trade');
}
/** Bought vs sold (quantity and cash) as paired bars on one scale, with the gross margin as a chip. */
function tradeVisual(buy: CardData['prices']['goodsBuy'], sell: CardData['prices']['goodsBuy'], unit: string): HTMLElement {
  const box = el('div', 'bc-trade-visual'); box.setAttribute('aria-hidden', 'true');
  const pairs = [['box', buy.quantity ?? 0, sell.quantity ?? 0, (n: number) => `${count(n)}`, unit], ['coin', buy.cashSatang ?? 0, sell.cashSatang ?? 0, (n: number) => `${Math.round(n / 100).toLocaleString('th-TH')} ฿`, '']] as const;
  for (const [icon, bought, sold, format] of pairs) {
    const max = Math.max(1, bought, sold), row = el('div', 'bc-trade-row');
    const left = el('span', 'bc-trade-bar buy'), right = el('span', 'bc-trade-bar sell');
    left.style.setProperty('--share', (bought / max).toFixed(3)); right.style.setProperty('--share', (sold / max).toFixed(3));
    row.append(el('b', 'bc-trade-num buy', format(bought)), left, iconElement(icon, 'ui-icon bc-trade-icon'), right, el('b', 'bc-trade-num sell', format(sold)));
    box.append(row);
  }
  const margin = (sell.cashSatang ?? 0) - (buy.cashSatang ?? 0), chip = el('span', `bc-trade-margin ${margin < 0 ? 'bad' : 'good'}`, `${margin >= 0 ? '+' : '−'}${Math.round(Math.abs(margin) / 100).toLocaleString('th-TH')} ฿ ส่วนต่างขาย−ซื้อ`);
  const legend = el('div', 'bc-trade-legend'); legend.append(el('span', 'buy', 'ซื้อเข้า'), chip, el('span', 'sell', 'ขายออก')); box.append(legend);
  return box;
}
function cardEmployment(parts: CardParts): HTMLElement | null {
  if (!parts.employment) return null;
  const cards = takeCards(parts, ['workers', 'household-count', 'employers']);
  if (cards.length) parts.employment.firstElementChild?.after(cardKpis(cards));
  return cardSection(parts.employment, 'employment');
}
function cardDetails(data: CardData, parts: CardParts): HTMLElement {
  const contents: HTMLElement[] = [], remaining = [...parts.values.values()]; parts.values.clear();
  if (remaining.length) contents.push(metrics(remaining)); contents.push(...parts.notes);
  const node = facts(`card:${data.kind}:${data.identity.householdId ?? data.identity.buildingId}`, 'ข้อมูลบัญชีและรายละเอียด', ...contents); node.classList.add('bc-secondary'); return cardSection(node, 'details');
}

function growthMetric(key: string, title: string, value: string, raw: number, money = false): HTMLElement {
  const item = metric(key, title, value, raw, money); delete item.dataset.contextMetric; item.dataset.growthMetric = key; return item;
}
const growthViews = new WeakMap<City, HTMLElement>();
/** Retain native disclosure identity while the city advances under an open panel. */
function renderIndustryGrowth(city: City): HTMLElement {
  const { status: growth, message } = growthStatusText(city);
  let panel = growthViews.get(city);
  if (!panel) {
    panel = section('งานใหม่และทุนขยายโรงงาน'); panel.classList.add('cx-periodflows'); panel.dataset.growthStatus = 'true';
    const state = el('p', 'cx-detail-note'); state.dataset.growthMessage = 'true';
    const capital = metrics([
      growthMetric('capital-available', 'ทุนที่ใช้ขยายได้', '', 0, true), growthMetric('capital-required', 'ทุนที่ต้องมี', '', 0, true),
    ]); capital.dataset.growthCapital = 'true';
    const detail = facts('city:industry-growth', 'เงินสำรองและเงื่อนไขจริง', metrics([
      growthMetric('sponsor-id', 'กิจการผู้ลงทุน', '', 0), growthMetric('cash', 'เงินผู้ลงทุน', '', 0, true),
      growthMetric('payroll-reserve', 'ค่าจ้างที่ค้างจ่าย', '', 0, true), growthMetric('tax-reserve', 'ภาษีที่กันไว้', '', 0, true),
      growthMetric('rent-reserve', 'กันค่าเช่า', '', 0, true), growthMetric('working-reserve', 'กันเงินหมุนเวียน', '', 0, true),
      growthMetric('crop-available', 'พืชผลที่เข้าถึงได้', '', 0), growthMetric('funded-vacancies', 'งานว่างที่จ่ายได้', '', 0),
    ])); detail.dataset.growthDetails = 'true';
    const progress = el('div', 'cx-growth-progress'); progress.dataset.growthProgress = 'true';
    progress.append(el('div', 'cx-growth-progress-bar'), el('span', 'cx-growth-progress-text'));
    const checklist = el('ol', 'cx-growth-checklist'); checklist.dataset.growthChecklist = 'true';
    const footnote = el('p', 'cx-detail-note'); footnote.dataset.growthFootnote = 'true';
    panel.append(state, progress, capital, checklist, detail, footnote); growthViews.set(city, panel);
  }
  Object.assign(panel.dataset, { growthReason: growth.code, ready: String(growth.ready), bootstrap: String(growth.bootstrap), sponsorId: growth.sponsorFirmId === null ? '' : String(growth.sponsorFirmId) });
  panel.querySelector<HTMLElement>('[data-growth-message]')!.textContent = message;
  panel.querySelector<HTMLElement>('[data-growth-capital]')!.hidden = growth.bootstrap || growth.sponsorFirmId === null;
  const progress = panel.querySelector<HTMLElement>('[data-growth-progress]')!, share = growth.requiredCapital > 0 ? Math.min(1, Math.max(0, growth.availableCapital / growth.requiredCapital)) : 0;
  progress.hidden = growth.bootstrap || growth.sponsorFirmId === null || growth.requiredCapital <= 0;
  progress.style.setProperty('--share', share.toFixed(3)); progress.dataset.value = share.toFixed(3);
  progress.querySelector('span')!.textContent = `ทุนพร้อม ${Math.round(share * 100)}%`;
  const checklist = panel.querySelector<HTMLElement>('[data-growth-checklist]')!;
  checklist.replaceChildren(...growthChecklist(growth.code).map(step => {
    const item = el('li', `cx-check ${step.state}`, step.label); item.dataset.state = step.state; return item;
  }));
  const values: [string, number, string][] = [
    ['capital-available', growth.availableCapital, cash(growth.availableCapital)], ['capital-required', growth.requiredCapital, cash(growth.requiredCapital)],
    ['sponsor-id', growth.sponsorFirmId ?? 0, growth.sponsorFirmId === null ? 'ยังไม่มีผู้ลงทุน' : `#${growth.sponsorFirmId}`], ['cash', growth.cash, growth.sponsorFirmId === null ? 'ยังไม่มีผู้ลงทุน' : cash(growth.cash)],
    ['payroll-reserve', growth.payrollReserve, cash(growth.payrollReserve)], ['tax-reserve', growth.taxReserve, cash(growth.taxReserve)],
    ['rent-reserve', growth.rentReserve, cash(growth.rentReserve)], ['working-reserve', growth.workingReserve, cash(growth.workingReserve)],
    ['crop-available', growth.cropAvailable, `${count(growth.cropAvailable)} ล็อต`], ['funded-vacancies', growth.fundedVacancies, `${count(growth.fundedVacancies)} ตำแหน่ง`],
  ];
  for (const [key, raw, text] of values) {
    const item = panel.querySelector<HTMLElement>(`[data-growth-metric="${key}"]`)!; item.dataset.value = String(raw); item.querySelector('dd')!.textContent = text;
  }
  panel.querySelector<HTMLElement>('[data-growth-footnote]')!.textContent = growth.bootstrap
    ? 'ทุนโรงงานแรกมีคู่บัญชีภายนอกตามกติกาเดิม การรับครัวเรือนยังต้องมีบ้านและผ่านเงื่อนไขจริง'
    : 'โรงงานเพิ่มใช้เงินกิจการผู้ลงทุนจริง หลังกันภาระทั้งหมด เงินนี้ไม่ใช่เงินคลังหรือยอดขายใหม่ งานเพิ่มก่อนรับครัวเรือนตามเงื่อนไขปกติ การเริ่มผลิตยังต้องซื้อพืชผลจริง และอาจต้องวางฟาร์มเพิ่ม';
  return panel;
}
function cardInterior(data: CardData, nodes: HTMLElement[], city: City): HTMLElement[] {
  const parts = cardParts(nodes), output = [cardHero(data, city), ...parts.statuses, ...parts.assumptions];
  if (data.kind === 'house') {
    output.push(cardGroup('พักอยู่จริง / ความจุ', 'occupancy', takeCards(parts, ['households', 'persons', 'vacant-households', 'vacant-persons']), 'bc-occupancy'));
    if (parts.residents) output.push(cardSection(parts.residents, 'residents'));
  } else if (data.kind === 'household') {
    output.push(cardGroup('สมาชิกและกำลังแรงงาน', 'members', takeCards(parts, ['members', 'workforce', 'dependents', 'employed', 'unemployed'])), cardCash(data, parts));
    const jobs = cardEmployment(parts); if (jobs) output.push(jobs); if (parts.skills) output.push(cardSection(parts.skills, 'skills'));
  } else if (data.kind === 'shop') {
    output.push(cardGroup('สินค้าสำเร็จรูปพร้อมขาย', 'stock', takeCards(parts, ['stock'])), cardTrade(data), cardCash(data, parts));
    const jobs = cardEmployment(parts); if (jobs) output.push(jobs);
  } else if (data.kind === 'market') {
    const marketKpis = takeCards(parts, ['crop-stock', 'crop-cost', 'realised-profit', 'workers', 'cash']);
    const ownerWork = marketKpis.find(card => card.dataset.contextMetric === 'workers'); if (ownerWork) ownerWork.querySelector('dt')!.textContent = 'เจ้าของทำงาน / รับได้';
    output.push(cardGroup('พืชผล เงินกิจการ และเจ้าของที่ทำงาน', 'stock', marketKpis, 'bc-market-stock'), cardTrade(data));
    if (parts.owner) { parts.owner.firstElementChild?.after(cardKpis(takeCards(parts, ['drawable', 'owner-household']))); output.push(cardSection(parts.owner, 'owner')); }
    output.push(cardCash(data, parts)); const jobs = cardEmployment(parts); if (jobs) output.push(jobs);
  } else if (data.kind === 'factory') {
    const production = section('วัตถุดิบ → สูตรแปรรูป → ผลผลิต'), chain = el('div', 'bc-chain');
    for (const [stage, title, keys] of [['input', 'วัตถุดิบพืชผล', ['crop-stock', 'crop-cost']], ['recipe', 'สูตรและกำลังแปรรูป', ['recipe-input', 'recipe-output', 'available-batches']], ['output', 'สินค้าสำเร็จรูป', ['stock']]] as const) {
      const step = el('div', 'bc-chain-step'); step.dataset.stage = stage;
      const cards = takeCards(parts, [...keys]); if (stage === 'output') cards.push(cardStat('goods-produced-today', 'ผลิตจริงวันนี้', data.today.goodsProduced, 'หน่วย'));
      step.append(el('span', 'bc-chain-label', title), cardKpis(cards)); chain.append(step);
    }
    production.append(chain); output.push(cardSection(production, 'production'));
    if (parts.funding) output.push(cardSection(parts.funding, 'funding'));
    const jobs = cardEmployment(parts); if (jobs) output.push(jobs); output.push(cardCash(data, parts));
  } else {
    const firm = city.firms.find(f => f.building === data.identity.buildingId && f.zone === 'F');
    if (firm) {
      const picker = section('พืชที่ผลิต'); picker.dataset.farmCropPicker = String(firm.id);
      const controls = el('div', 'farm-crop-choices');
      const auto = el('button', 'cx-button', 'อัตโนมัติ'); auto.type = 'button'; auto.dataset.crop = 'auto'; auto.setAttribute('aria-pressed', String(farmCropMode(firm) === 'auto')); auto.disabled = !latestRequest?.onFarmCrop; auto.addEventListener('click', () => latestRequest?.onFarmCrop?.(firm.id, 'auto')); controls.append(auto);
      for (const crop of CROPS) {
        const button = el('button', 'cx-button', CROP_LABELS[crop]); button.type = 'button';
        button.dataset.crop = crop; button.setAttribute('aria-pressed', String(farmCropMode(firm) === 'manual' && farmCrop(city, firm) === crop));
        button.disabled = !latestRequest?.onFarmCrop; button.addEventListener('click', () => latestRequest?.onFarmCrop?.(firm.id, crop)); controls.append(button);
      }
      picker.append(el('p', 'cx-detail-note', `กำลังปลูก${CROP_LABELS[farmCrop(city, firm)]} · ${farmCropMode(firm) === 'auto' ? 'เลือกอัตโนมัติเมื่อฟาร์มเริ่มหรือเมื่อกดอัตโนมัติ' : 'ผู้เล่นเลือกเอง'}`), controls, el('p', 'cx-detail-note', `คงคลัง: ${CROPS.map(crop => `${CROP_LABELS[crop]} ${firm.crops[crop]}`).join(' · ')} ล็อต · พืชเดิมยังอยู่เมื่อเปลี่ยน`));
      output.push(cardSection(picker, 'crop-choice'));
    }
    output.push(cardGroup('พื้นที่เพาะปลูก', 'plot', [cardStat('plot-cells', 'พื้นที่อาคารบนกริด', 1, 'ช่อง'), ...takeCards(parts, ['fertility'])], 'bc-plot'));
    output.push(cardGroup('การเก็บเกี่ยววันนี้', 'harvest', takeCards(parts, ['harvest-today', 'yield-per-worker', 'workers']), 'bc-yield'));
    output.push(cardGroup('พืชผลที่เก็บไว้', 'stock', takeCards(parts, ['crop-stock', 'crop-cost'])));
    const jobs = cardEmployment(parts); if (jobs) output.push(jobs); output.push(cardCash(data, parts));
  }
  output.push(cardDetails(data, parts));
  for (const journal of parts.journals) output.push(cardSection(journal, `journal-${journal.dataset.kind}`));
  return output;
}

/** Entity-only content. Parent owns modes, headings, parcel explanations and navigation. */
export function renderContext(city: City, selection: ContextSelection, onHousehold: HouseholdAction, onOwnerFinance?: OwnerFinanceAction, onFarmCrop?: FarmCropAction): void {
  const host = document.getElementById('entity-content'); if (!host) return; host.classList.add('cx-content');
  installInputGuard(host);
  const request: ContextRequest = { city, selection: selection ? { ...selection } : null, onHousehold, onOwnerFinance, onFarmCrop }; latestRequest = request;
  const scope = scopeOf(city, selection), revision = contextRevision(city);
  const changedScope = renderedCity !== city || renderedScope !== scope;
  if (changedScope) ownerFeedback.clear();
  if (changedScope || !heldTargetsExist(city)) clearHeldRender();
  // Do not replace a real pressed control on a tick. Its click remains native
  // and synchronous; only a same-context presentation refresh is queued.
  if (!changedScope && (heldPointers.size || heldKeys.size || releaseBarrier)) { queuedRequest = request; return; }
  if (!changedScope && renderedRevision === revision) return;
  queuedRequest = null; renderedCity = city; renderedScope = scope; renderedRevision = revision;
  if (latestCity && latestCity !== city) { activityLimits.clear(); expandedActivity.clear(); expandedFacts.clear(); } latestCity = city;
  const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement.dataset.contextFocus : undefined;
  delete host.dataset.wallet; delete host.dataset.buildingId; delete host.dataset.cell; delete host.dataset.entityId; delete host.dataset.cardKind; delete host.dataset.goodsIn; delete host.dataset.goodsOut;
  if (selection === null) { host.dataset.scope = 'none'; host.replaceChildren(); return; }
  host.dataset.scope = selection.kind;
  if (selection.kind === 'household') {
    host.dataset.entityId = String(selection.id); const household = city.households.find(value => value.id === selection.id); if (household) host.dataset.wallet = household.wallet;
    const data = householdCardData(city, selection.id), nodes = renderHousehold(city, selection); if (data) host.dataset.cardKind = data.kind; host.replaceChildren(...(data ? cardInterior(data, nodes, city) : nodes));
  } else {
    const place = resolvePlace(city, selection.cell); host.dataset.cell = String(selection.cell);
    if (!place.building) { host.replaceChildren(); return; }
    host.dataset.entityId = String(place.building.id); host.dataset.buildingId = String(place.building.id);
    if (place.building.zone === 'R') {
      const data = buildingCardData(city, place.building.id), nodes = renderHouse(city, place.building, place.households, navigateHousehold); if (data) host.dataset.cardKind = data.kind; host.replaceChildren(...(data ? cardInterior(data, nodes, city) : nodes));
    } else if (place.firm) {
      // The flow strip names this firm's own crop and product instead of generic "crops/goods".
      const recipe = place.firm.recipe ? RECIPE[place.firm.recipe] : null;
      if (recipe) Object.assign(host.dataset, { goodsIn: CROP_LABELS[recipe.crop], goodsOut: PRODUCT_LABELS[recipe.product] });
      else if (place.firm.zone === 'F') host.dataset.goodsIn = CROP_LABELS[farmCrop(city, place.firm)];
      host.dataset.wallet = place.firm.wallet; const data = buildingCardData(city, place.building.id), nodes = renderFirm(city, place.building, place.firm, navigateHousehold); if (data) host.dataset.cardKind = data.kind; host.replaceChildren(...(data ? cardInterior(data, nodes, city) : nodes));
    }
    else host.replaceChildren(empty('ไม่พบข้อมูลบริษัท', 'อาคารนี้ไม่มีบริษัทที่อ้างอิงอยู่ในข้อมูลเมืองปัจจุบัน'));
  }
  if (focused) [...host.querySelectorAll<HTMLElement>('[data-context-focus]')].find(node => node.dataset.contextFocus === focused)?.focus({ preventScroll: true });
}

/** Current stocks and actual inclusive last-30-day flows are kept visually separate. */
export function renderCityOverview(city: City): void {
  const host = document.getElementById('city-overview'); if (!host) return; host.classList.add('cx-content'); host.dataset.scope = 'city';
  const data = cityOverview(city); Object.assign(host.dataset, { fromTick: String(data.fromTick), toTick: String(data.toTick) });
  const stocks = section('ยอดและจำนวนปัจจุบัน', `ณ วันที่ ${data.toTick}`); stocks.classList.add('cx-stock-card');
  stocks.append(metrics([
    metric('population', 'ประชากร (สมาชิก)', `${count(data.population)} คน`, data.population), metric('households', 'ครัวเรือน', count(data.households), data.households),
    metric('workforce', 'กำลังแรงงาน', `${count(data.workforce)} คน`, data.workforce), metric('dependents', 'ผู้พึ่งพิง', `${count(data.dependents)} คน`, data.dependents),
    metric('employed', 'แรงงานที่ทำงาน', `${count(data.employed)} คน`, data.employed), metric('unemployed', 'แรงงานว่าง', `${count(data.unemployed)} คน`, data.unemployed),
    metric('homeless', 'ครัวเรือนรอที่พัก', count(data.homeless), data.homeless), metric('homeless-persons', 'สมาชิกที่รอที่พัก', `${count(data.homelessPersons)} คน`, data.homelessPersons),
    metric('jobs', 'ตำแหน่งงาน', count(data.jobs), data.jobs), metric('firms', 'สถานประกอบการ', count(data.firms), data.firms),
    metric('treasury', 'คลังเมืองตอนนี้', cash(data.treasury), data.treasury, true), metric('inventory', 'สำเร็จรูปคงคลังตอนนี้', `${count(data.inventory)} หน่วย`, data.inventory),
    metric('employee-workers', 'ทำงานเป็นลูกจ้าง', `${count(data.employeeWorkers)} คน`, data.employeeWorkers), metric('self-employed-workers', 'ทำกิจการเอง', `${count(data.selfEmployedWorkers)} คน`, data.selfEmployedWorkers)
  ]));
  if (data.legacyHouseholds) {
    const assumption = el('p', 'cx-legacy-assumption', `ในยอดรวมนี้มี ${data.legacyHouseholds} ครัวเรือนเดิม รวมสมาชิก ${data.legacyAssumedPersons} คนที่ตั้งต้นจากสมมติฐานขั้นต่ำของ v1 ไม่ใช่จำนวนบุคคลย้อนหลังที่บันทึกไว้`);
    Object.assign(assumption.dataset, { legacyHouseholds: String(data.legacyHouseholds), assumedPersons: String(data.legacyAssumedPersons) }); stocks.append(assumption);
  }
  const housing = section('ความจุที่พักทั้งเมือง'); housing.classList.add('cx-stock-card'); housing.dataset.housing = 'city';
  housing.append(metrics([
    metric('home-slots', 'รับได้ (ครัวเรือน)', count(data.homeSlots), data.homeSlots), metric('person-capacity', 'รับได้ (สมาชิก)', `${count(data.personCapacity)} คน`, data.personCapacity),
    metric('occupied-home-slots', 'พักอยู่ (ครัวเรือน)', count(data.occupiedHomeSlots), data.occupiedHomeSlots), metric('occupied-persons', 'พักอยู่ (สมาชิก)', `${count(data.occupiedPersons)} คน`, data.occupiedPersons),
    metric('housing-vacancy', 'ช่องครัวเรือนว่าง', count(data.housingVacancy), data.housingVacancy), metric('person-vacancy', 'ความจุสมาชิกว่าง', `${count(data.personVacancy)} คน`, data.personVacancy)
  ]), el('p', 'cx-detail-note', 'นี่คือความจุบ้านรวมทางกายภาพ การรับครัวเรือนยังต้องผ่านทั้งสองเพดานและเงื่อนไขของบ้านแต่ละหลัง'));
  const period = el('div', 'cx-period-banner'); period.append(el('h3', '', `รายการวันที่ ${data.fromTick}–${data.toTick}`), el('p', '', 'รวมวันต้นและวันปลาย · รายการจริง ไม่ใช่ยอดคงเหลือตอนนี้'));
  const flows = section('เงินเข้าออกคลังในช่วงนี้'); flows.classList.add('cx-periodflows'); flows.append(metrics([metric('income', 'เงินเข้าคลัง', cash(data.income), data.income, true), metric('expense', 'เงินออกคลัง', cash(data.expense), data.expense, true), metric('net', 'สุทธิของช่วงนี้', cash(data.net, true), data.net, true)]), el('p', 'cx-detail-note', 'นับเฉพาะรายการที่ต้นทางหรือปลายทางเป็นคลังเมือง หากเงินตั้งเมืองยังอยู่ในช่วงนี้ จะรวมเป็นเงินเข้าด้วย'));
  const goods = section('สินค้าสำเร็จรูปเคลื่อนย้ายในช่วงนี้'); goods.classList.add('cx-periodflows'); goods.append(metrics([metric('produced', 'ผลิต', `${count(data.produced)} หน่วย`, data.produced), metric('imported', 'นำเข้า', `${count(data.imported)} หน่วย`, data.imported), metric('consumed', 'บริโภคสำเร็จรูป', `${count(data.consumed)} หน่วย`, data.consumed), metric('exported', 'ส่งออกขาย', `${count(data.exported)} หน่วย`, data.exported)]), el('p', 'cx-detail-note', 'การส่งออกขายไม่รวมการตัดสต็อกทิ้งจากการรื้อถอน สินค้าคงคลังในกล่องด้านบนเป็นจำนวนที่เหลืออยู่ตอนนี้'));
  const crops = section('พืชผล: ยอดคงเหลือและรายการในช่วงนี้'); crops.classList.add('cx-periodflows'); crops.dataset.commodity = 'crops';
  crops.append(metrics([
    metric('crop-stock', 'คงเหลือตอนนี้', `${count(data.cropInventory)} ล็อต`, data.cropInventory), metric('crop-cost', 'มูลค่าคงเหลือตามบัญชี', cash(data.cropCost), data.cropCost, true),
    metric('crop-harvested', 'เก็บเกี่ยวในช่วงนี้', `${count(data.cropHarvested)} ล็อต`, data.cropHarvested), metric('crop-processed', 'ใช้แปรรูปในช่วงนี้', `${count(data.cropProcessed)} ล็อต`, data.cropProcessed),
    metric('crop-consumed', 'บริโภคในช่วงนี้', `${count(data.cropConsumed)} ล็อต`, data.cropConsumed), metric('crop-written-off', 'ตัดออกในช่วงนี้', `${count(data.cropWrittenOff)} ล็อต`, data.cropWrittenOff),
  ]), el('p', 'cx-detail-note', 'ล็อตพืชผลแยกหน่วยจากสินค้าสำเร็จรูป ยอดเก็บเกี่ยว ใช้แปรรูป บริโภค และตัดออกนับจากบัญชีพืชผลภายในวันต้น–วันปลายเดียวกัน'));
  const utilities = el('div', 'cx-status'); utilities.append(chip(`${data.power ? 'ไฟฟ้าพร้อม' : 'ไฟฟ้าไม่พอ'} ${data.utility.powerUsed}/${data.utility.powerCapacity}`, data.power), chip(`${data.water ? 'น้ำพร้อม' : 'น้ำไม่พอ'} ${data.utility.waterUsed}/${data.utility.waterCapacity}`, data.water), chip(`โรงผลิต ${data.utility.plants} แห่ง`, true));
  const warnings = section('สิ่งที่ควรตรวจสอบ'), list = el('ul', 'cx-warning-list');
  if (data.warnings.length) for (const warning of data.warnings) list.append(el('li', '', warning)); else list.append(el('li', '', 'ไม่พบคำเตือนจากการตรวจข้อมูลเมืองรอบนี้'));
  warnings.append(list); host.replaceChildren(stocks, housing, renderIndustryGrowth(city), period, flows, goods, crops, utilities, warnings);
}
