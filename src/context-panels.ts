import './context-panels.css';
import { MONTH, WAGES, access, householdWorkerCount, employmentForHousehold, housingCapacity, homeOccupancy, explainMigration, type City, type Household, type Firm, type Building } from './sim.ts';
import { resolvePlace, relatedFlows, cityOverview, householdLabor, firmLabor, contextRevision, WORKER_SKILL_LABELS, WORKER_SKILL_ROLES } from './context-data.ts';
import { formatMoney, type FlowKind, type FlowRow } from './inspector-data.ts';

export type ContextSelection = { kind: 'place'; cell: number } | { kind: 'household'; id: number; sourceBuildingId: number; sourceCell: number } | null;
type HouseholdAction = (id: number, sourceBuildingId: number, sourceCell: number) => void;
let latestCity: City | null = null;
const activityLimits = new Map<string, number>();
const expandedActivity = new Set<string>(), expandedFacts = new Set<string>();
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
function flushAfterActivation(waitForClick = false) {
  // A touch compatibility click may follow pointerup in a later task. Retain
  // its node until the trusted click, then flush after native activation.
  releaseBarrier = true;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null; releaseBarrier = false;
    if (heldPointers.size || heldKeys.size) return;
    const request = queuedRequest; queuedRequest = null;
    if (request && request === latestRequest) renderContext(request.city, request.selection, request.onHousehold);
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
function householdButton(city: City, household: Household, source: Building, onHousehold: HouseholdAction, assignedWorkers?: number, assignments: ReturnType<typeof employmentForHousehold> = []): HTMLButtonElement {
  const button = el('button', 'cx-household-link'); button.type = 'button'; Object.assign(button.dataset, { householdId: String(household.id), sourceBuildingId: String(source.id), sourceCell: String(source.cell), contextFocus: `household:${household.id}` });
  Object.assign(button.dataset, { members: String(household.members), workforce: String(household.workforce), dependents: String(household.dependents), employedWorkers: String(householdWorkerCount(city, household.id)) });
  if (assignedWorkers !== undefined) button.dataset.assignedWorkers = String(assignedWorkers);
  const labor = assignedWorkers === undefined ? `ทำงาน ${householdWorkerCount(city, household.id)}/${household.workforce} คน` : `จากแรงงานในบ้าน ${household.workforce} คน`;
  const art = el('span', 'cx-person-symbol'), copy = el('span', 'cx-link-copy'); art.append(symbol('household'));
  copy.append(el('strong', '', assignedWorkers === undefined ? `ครัวเรือน #${household.id} · ${household.members} คน` : `รับแรงงาน ${assignedWorkers} คน · ครัวเรือน #${household.id}`), el('span', '', `${labor} · เงินร่วม ${cash(city.accounts[household.wallet] ?? 0)}`));
  for (const allocation of assignments) {
    const role = el('span', 'cx-assigned-role', `${allocation.occupation === 'manufacturing' ? 'งานผลิต' : 'งานค้าปลีก'} · ${WORKER_SKILL_LABELS[allocation.skill]} ${allocation.workers} คน`);
    Object.assign(role.dataset, { skill: allocation.skill, occupation: allocation.occupation, workers: String(allocation.workers) }); copy.append(role);
  }
  if (household.origin === 'legacy-v1') copy.append(el('small', 'cx-legacy-tag', 'สมาชิกจาก v1: สมมติขั้นต่ำ'));
  button.append(art, copy, el('span', 'cx-link-arrow', '→')); button.setAttribute('aria-label', `ดูข้อมูลครัวเรือน #${household.id}`); button.addEventListener('click', () => onHousehold(household.id, source.id, source.cell)); return button;
}
function flowCard(row: FlowRow, wallet: string): HTMLElement {
  const key = JSON.stringify([wallet, row.kind, row.index, row.tick, row.from, row.to, row.value, row.reason]);
  const card = el('details', 'cx-flow-card'); Object.assign(card.dataset, { kind: row.kind, index: String(row.index), tick: String(row.tick), from: row.from, to: row.to, value: String(row.value), reason: row.reason });
  const summary = el('summary', 'cx-flow-summary'), top = el('div', 'cx-flow-top'), route = el('div', 'cx-flow-route'), detail = el('div', 'cx-flow-details');
  summary.dataset.contextFocus = `flow:${key}`;
  top.append(el('h4', '', row.label), el('strong', 'cx-amount cx-flow-value', row.kind === 'money' ? cash(row.value) : `${count(row.value)} หน่วย`));
  summary.append(top, el('span', 'cx-flow-inline', `วัน ${row.tick} · ${row.fromLabel} → ${row.toLabel}`));
  route.append(el('span', '', row.fromLabel), el('span', 'cx-route-arrow', '→'), el('span', '', row.toLabel));
  detail.append(el('p', 'cx-flow-meta', `วัน ${row.tick} · รายการ #${row.index + 1}`), route, el('p', 'cx-flow-raw', `${row.from} → ${row.to} · ${row.reason}`));
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
  const card = metric(key, title, `${count(occupied)} / ${count(capacity)} ${unit}`, occupied); card.dataset.capacity = String(capacity); return card;
}
function legacyAssumption(household: Household): HTMLElement | null {
  if (household.origin !== 'legacy-v1') return null;
  const note = el('p', 'cx-legacy-assumption', 'ข้อมูล v1 ไม่มีจำนวนสมาชิก จึงตั้งต้นแบบสมมติขั้นต่ำ 1 คน / 1 แรงงาน / 0 ผู้พึ่งพิง ไม่ใช่ข้อมูลบุคคลย้อนหลังที่วัดไว้');
  Object.assign(note.dataset, { origin: household.origin, profile: household.profile, members: String(household.members), workforce: String(household.workforce), dependents: String(household.dependents) }); return note;
}
function renderHouse(city: City, building: Building, households: Household[], onHousehold: HouseholdAction): HTMLElement[] {
  const occupied = homeOccupancy(city, building.id), capacity = housingCapacity(building);
  const residents = section('ครัวเรือนที่พักอาศัย', `${households.length} ครัวเรือน · ${occupied.persons} คน`), list = el('div', 'cx-household-list');
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
  ]), residents, facts(`house:${building.id}`, 'เงื่อนไขรับครัวเรือนและความจุ', ...conditions, el('p', '', `ความจุบ้านเป็นพารามิเตอร์เกมรุ่น ${city.rulesVersion} ต้องเหลือทั้งช่องครัวเรือนและจำนวนคน การอัปเกรดเพิ่มความจุ ไม่ได้เพิ่มสมาชิกให้บ้านเอง`))];
}
function renderFirm(city: City, building: Building, firm: Firm, onHousehold: HouseholdAction): HTMLElement[] {
  const wallet = city.accounts[firm.wallet] ?? 0, reserved = Object.values(firm.workDays).reduce((sum, days) => sum + days * WAGES[firm.zone] / MONTH, 0), spendable = Math.max(0, wallet - reserved), capacity = firm.zone === 'I' ? building.level + 3 : building.level;
  const labor = firmLabor(city, firm.id)!, workers = labor.workers;
  const lastSettlement = city.tick - city.tick % MONTH, hasClosedMonth = lastSettlement > 0 && city.tick - building.age < lastSettlement;
  const employees = section('แรงงานที่รับจากแต่ละครัวเรือน', `${workers} คน · ${labor.householdCount} บัญชีครัวเรือน`), list = el('div', 'cx-household-list');
  for (const group of labor.households) {
    const household = city.households.find(value => value.id === group.householdId);
    if (household) list.append(householdButton(city, household, building, onHousehold, group.workers, group.allocations));
    else list.append(el('p', 'cx-detail-note', `ไม่พบครัวเรือน #${group.householdId} ในการจัดสรรแรงงาน`));
  }
  if (!labor.householdCount) list.append(el('p', 'cx-detail-note', 'ยังไม่มีแรงงานที่มีความสามารถตรงกับงานและสำรองค่าจ้างได้'));
  employees.append(list);
  const meanings = facts(`firm:${firm.id}`, 'เงินสำรอง แรงงาน และกำไรรอบบัญชี',
    el('p', '', 'เงินในกระเป๋ารวมค่าจ้างที่ต้องสำรองไว้แล้ว ยอดใช้จ่ายได้จึงหักเงินสำรองออกก่อน จ้างเป็นจำนวนแรงงานที่มีความสามารถตรงกับงาน ไม่ได้รับครัวเรือนทั้งบ้าน ผู้พึ่งพิงไม่ถูกนับเป็นแรงงาน ค่าจ้างสะสมตามวัน-แรงงานจริงและจ่ายเข้าบัญชีร่วมของครัวเรือน'),
    el('p', '', hasClosedMonth ? `กำไรก่อนภาษีของรอบบัญชีวันที่ ${Math.max(1, lastSettlement - MONTH + 1)}–${lastSettlement} รวมเฉพาะวันที่บริษัทดำเนินงาน ไม่ใช่กำไรที่เพิ่งรับในเดือนนี้` : 'ยังไม่มีเดือนที่ปิดบัญชี จึงยังไม่มีกำไรของรอบบัญชีก่อนหน้า'),
    el('p', '', `บริษัท #${firm.id} · อาคาร #${building.id} · บัญชี ${firm.wallet}`));
  const workerMetric = capacityMetric('workers', 'แรงงานทำงาน / รับได้', workers, capacity, 'คน');
  return [el('p', 'cx-context-meta', `บริษัท #${firm.id} · ${firm.wallet}`), status(city, building.cell), metrics([
    metric('cash', 'เงินในกระเป๋า', cash(wallet), wallet, true), metric('reserved', 'สำรองค่าจ้าง', cash(reserved), reserved, true), metric('spendable', 'ใช้จ่ายได้', cash(spendable), spendable, true), metric('stock', 'สินค้าคงคลัง', `${count(firm.inventory)} หน่วย`, firm.inventory), workerMetric, metric('household-count', 'บัญชีครัวเรือนของแรงงาน', count(labor.householdCount), labor.householdCount), metric('profit', 'กำไรรอบก่อนภาษี', cash(firm.lastMonthProfit, true), firm.lastMonthProfit, true)
  ]), employees, meanings, activity(city, 'money', firm.wallet, `บริษัท #${firm.id}`), activity(city, 'goods', firm.wallet, `บริษัท #${firm.id}`)];
}
function employmentRow(city: City, allocation: ReturnType<typeof employmentForHousehold>[number]): HTMLElement {
  const row = el('div', 'cx-employment-row'); Object.assign(row.dataset, { householdId: String(allocation.householdId), firmId: String(allocation.firmId), workers: String(allocation.workers), occupation: allocation.occupation, rank: allocation.rank, skill: allocation.skill });
  const firm = city.firms.find(value => value.id === allocation.firmId), occupation = allocation.occupation === 'manufacturing' ? 'งานผลิต' : allocation.occupation === 'retail' ? 'งานค้าปลีก' : allocation.occupation;
  row.append(el('strong', '', `${allocation.workers} คน → ${firm?.zone === 'I' ? 'โรงงาน' : firm?.zone === 'C' ? 'ร้านค้า' : 'กิจการ'} #${allocation.firmId}`), el('span', '', `${occupation} · ทักษะ${WORKER_SKILL_LABELS[allocation.skill]} · ${allocation.rank === 'entry' ? 'ระดับเริ่มต้น' : allocation.rank}`)); return row;
}
function renderWorkerSkills(city: City, household: Household): HTMLElement {
  const data = householdLabor(city, household.id)!, body = section('กลุ่มความสามารถของแรงงาน', `${data.workforce} คน · ไม่รวมผู้พึ่งพิง`), list = el('div', 'cx-skill-list');
  for (const skill of data.skills) {
    const row = el('div', 'cx-skill-row'); Object.assign(row.dataset, { skill: skill.skill, total: String(skill.total), employed: String(skill.employed), unemployed: String(skill.unemployed) });
    const heading = el('div', 'cx-skill-heading'); heading.append(el('strong', '', WORKER_SKILL_LABELS[skill.skill]), el('span', '', `${skill.total} คน`));
    row.append(heading, el('span', '', `ทำงาน ${skill.employed} · ว่าง ${skill.unemployed} · ${WORKER_SKILL_ROLES[skill.skill]}`)); list.append(row);
  }
  const note = el('p', data.skillSource === 'legacy-assumed' ? 'cx-legacy-assumption' : 'cx-detail-note', data.skillSource === 'legacy-assumed' ? 'เซฟเดิมไม่มีทักษะ จึงสมมติให้แรงงานเดิมเป็นกลุ่มทั่วไป ไม่ใช่ประวัติความสามารถที่เคยเก็บไว้' : 'กลุ่มความสามารถเป็นพารามิเตอร์รับผู้ย้ายเข้าในเกม ไม่ใช่ข้อมูลการศึกษาหรือรายชื่อบุคคล');
  note.dataset.skillSource = data.skillSource; body.append(list, note); return body;
}
function renderHousehold(city: City, selected: Exclude<ContextSelection, { kind: 'place' } | null>): HTMLElement[] {
  const household = city.households.find(value => value.id === selected.id);
  if (!household) return [empty('ไม่พบครัวเรือนนี้', 'ครัวเรือนนี้ไม่อยู่ในข้อมูลเมืองปัจจุบัน ข้อมูลเดิมจึงไม่ถูกแสดงแทนข้อมูลปัจจุบัน')];
  const home = household.home === null ? null : city.buildings.find(value => value.id === household.home), wallet = city.accounts[household.wallet] ?? 0, allocations = employmentForHousehold(city, household.id), employed = householdWorkerCount(city, household.id), employers = new Set(allocations.map(allocation => allocation.firmId)).size;
  const origin = el('p', 'cx-backref', `เปิดจากอาคาร #${selected.sourceBuildingId} · บ้านพักปัจจุบัน ${household.home === null ? 'ยังไม่มีที่พัก' : home ? `#${home.id}` : `ไม่พบ #${household.home}`}`);
  Object.assign(origin.dataset, { sourceBuildingId: String(selected.sourceBuildingId), sourceCell: String(selected.sourceCell) });
  const output: HTMLElement[] = [el('p', 'cx-context-meta', `ครัวเรือน #${household.id} · ${household.wallet}`)];
  const assumed = legacyAssumption(household); if (assumed) output.push(assumed);
  output.push(metrics([
    metric('cash', 'เงินร่วมครัวเรือน', cash(wallet), wallet, true), metric('members', 'สมาชิกครัวเรือน', `${household.members} คน`, household.members),
    metric('workforce', 'แรงงานที่ทำงานได้', `${household.workforce} คน`, household.workforce), metric('dependents', 'ผู้พึ่งพิง', `${household.dependents} คน`, household.dependents),
    metric('employed', 'แรงงานที่ทำงาน', `${employed} คน`, employed), metric('unemployed', 'แรงงานว่าง', `${Math.max(0, household.workforce - employed)} คน`, Math.max(0, household.workforce - employed)),
    metric('employers', 'สถานประกอบการ', `${employers} แห่ง`, employers), metric('home', 'บ้านพักปัจจุบัน', household.home === null ? 'ยังไม่มีที่พัก' : home ? `อาคาร #${home.id}` : 'ไม่พบอาคาร', household.home === null ? 'null' : household.home),
    metric('needs', 'ยังไม่ได้ซื้อสินค้า', `${household.needs} วัน`, household.needs), metric('last-purchase', 'ซื้อครั้งล่าสุด', purchaseText(city, household), household.lastPurchaseTick)
  ]));
  if (home) output.push(status(city, home.cell)); else { const row = el('div', 'cx-status'); row.append(chip('รอจัดหาที่พัก', false)); output.push(row); }
  const jobs = section('แรงงานที่แยกไปแต่ละกิจการ', `${employed} / ${household.workforce} คน · ${employers} กิจการ`), rows = el('div', 'cx-employment-list');
  rows.append(...(allocations.length ? allocations.map(allocation => employmentRow(city, allocation)) : [el('p', 'cx-detail-note', 'ยังไม่มีแรงงานได้งานที่ตรงความสามารถ เข้าถึงได้ และมีงบค่าจ้าง')])); jobs.append(rows); output.push(jobs, renderWorkerSkills(city, household));
  output.push(facts(`household:${household.id}`, 'องค์ประกอบครัวเรือน บ้าน และการซื้อ', origin,
    el('p', '', `สมาชิก ${household.members} = กำลังแรงงาน ${household.workforce} + ผู้พึ่งพิง ${household.dependents} คน เป็นจำนวนรวมระดับครัวเรือน ไม่มีรายชื่อหรือตัวแทนรายบุคคล`),
    el('p', '', 'แต่ละกลุ่มความสามารถนับแรงงานคนละชุด ไม่ซ้ำกัน สมาชิกที่ทำงานได้อาจแยกกันไปหลายกิจการ ผู้พึ่งพิงไม่เข้าตลาดแรงงาน และรายได้จากทุกกิจการเข้าบัญชีร่วมของครัวเรือน งานต้นแบบยังมีเพียงระดับเริ่มต้น ไม่มีการจำลองการศึกษา เลื่อนตำแหน่ง หรือการฝึกทักษะ'),
    el('p', '', household.home === null ? 'การรื้อบ้านทำให้รอที่พักใหม่ ครัวเรือนและเงินออมยังอยู่ ระบบจัดหาที่พักให้ผู้ถูกย้ายออกจากบ้านก่อนรับผู้ย้ายเข้าใหม่' : 'การย้ายที่พักคง ID กระเป๋าเงิน สมาชิก และค่าจ้างที่มีสิทธิ์รับเดิม ไม่ใช่การรับครัวเรือนใหม่'),
    el('p', '', household.lastPurchaseTick === city.tick ? 'วันนี้ครัวเรือนนี้ซื้อสินค้า 1 หน่วยแล้ว ตะกร้าสินค้าต้นแบบยังเป็น 1 หน่วยต่อครัวเรือนต่อวัน ไม่ได้คูณตามจำนวนสมาชิก' : 'ตะกร้าสินค้าต้นแบบยังเป็น 1 หน่วยต่อครัวเรือนต่อวัน ต้องมีเงินและเข้าถึงร้านค้าที่มีแรงงานกับสินค้า จำนวนสมาชิกไม่ได้เพิ่มยอดซื้อย้อนหลัง')),
    activity(city, 'money', household.wallet, `ครัวเรือน #${household.id}`), activity(city, 'goods', household.wallet, `ครัวเรือน #${household.id}`)); return output;
}

/** Entity-only content. Parent owns modes, headings, parcel explanations and navigation. */
export function renderContext(city: City, selection: ContextSelection, onHousehold: HouseholdAction): void {
  const host = document.getElementById('entity-content'); if (!host) return; host.classList.add('cx-content');
  installInputGuard(host);
  const request: ContextRequest = { city, selection: selection ? { ...selection } : null, onHousehold }; latestRequest = request;
  const scope = scopeOf(city, selection), revision = contextRevision(city);
  const changedScope = renderedCity !== city || renderedScope !== scope;
  if (changedScope || !heldTargetsExist(city)) clearHeldRender();
  // Do not replace a real pressed control on a tick. Its click remains native
  // and synchronous; only a same-context presentation refresh is queued.
  if (!changedScope && (heldPointers.size || heldKeys.size || releaseBarrier)) { queuedRequest = request; return; }
  if (!changedScope && renderedRevision === revision) return;
  queuedRequest = null; renderedCity = city; renderedScope = scope; renderedRevision = revision;
  if (latestCity && latestCity !== city) { activityLimits.clear(); expandedActivity.clear(); expandedFacts.clear(); } latestCity = city;
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
  stocks.append(metrics([
    metric('population', 'ประชากร (สมาชิก)', `${count(data.population)} คน`, data.population), metric('households', 'ครัวเรือน', count(data.households), data.households),
    metric('workforce', 'กำลังแรงงาน', `${count(data.workforce)} คน`, data.workforce), metric('dependents', 'ผู้พึ่งพิง', `${count(data.dependents)} คน`, data.dependents),
    metric('employed', 'แรงงานที่ทำงาน', `${count(data.employed)} คน`, data.employed), metric('unemployed', 'แรงงานว่าง', `${count(data.unemployed)} คน`, data.unemployed),
    metric('homeless', 'ครัวเรือนรอที่พัก', count(data.homeless), data.homeless), metric('homeless-persons', 'สมาชิกที่รอที่พัก', `${count(data.homelessPersons)} คน`, data.homelessPersons),
    metric('jobs', 'ตำแหน่งงาน', count(data.jobs), data.jobs), metric('firms', 'สถานประกอบการ', count(data.firms), data.firms),
    metric('treasury', 'คลังเมืองตอนนี้', cash(data.treasury), data.treasury, true), metric('inventory', 'สินค้าคงคลังตอนนี้', `${count(data.inventory)} หน่วย`, data.inventory)
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
  const goods = section('สินค้าเคลื่อนย้ายในช่วงนี้'); goods.classList.add('cx-periodflows'); goods.append(metrics([metric('produced', 'ผลิต', `${count(data.produced)} หน่วย`, data.produced), metric('imported', 'นำเข้า', `${count(data.imported)} หน่วย`, data.imported), metric('consumed', 'บริโภค', `${count(data.consumed)} หน่วย`, data.consumed), metric('exported', 'ส่งออกขาย', `${count(data.exported)} หน่วย`, data.exported)]), el('p', 'cx-detail-note', 'การส่งออกขายไม่รวมการตัดสต็อกทิ้งจากการรื้อถอน สินค้าคงคลังในกล่องด้านบนเป็นจำนวนที่เหลืออยู่ตอนนี้'));
  const utilities = el('div', 'cx-status'); utilities.append(chip(data.power ? 'ไฟฟ้าภายนอกพร้อม' : 'ไฟฟ้าภายนอกไม่พร้อม', data.power), chip(data.water ? 'น้ำภายนอกพร้อม' : 'น้ำภายนอกไม่พร้อม', data.water));
  const warnings = section('สิ่งที่ควรตรวจสอบ'), list = el('ul', 'cx-warning-list');
  if (data.warnings.length) for (const warning of data.warnings) list.append(el('li', '', warning)); else list.append(el('li', '', 'ไม่พบคำเตือนจากการตรวจข้อมูลเมืองรอบนี้'));
  warnings.append(list); host.replaceChildren(stocks, housing, period, flows, goods, utilities, warnings);
}
