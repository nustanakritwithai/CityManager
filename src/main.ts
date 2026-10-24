import './style.css';
import { setupSubmenus, renderSubmenus } from './submenus.ts';
import { setupSubmenuNavigation, closeSubmenus, hasOpenSubmenu } from './submenu-navigation.ts';
import './submenu-layout.css';
import './context-layout.css';
import { renderContext, renderCityOverview, showOwnerFinanceResult } from './context-panels.ts';
import { CityView } from './renderer.ts';
import { SIZE, access, createCity, buildRoad, zoneCell, bulldoze, explainCell, summary, serialize, deserialize, roadPath, contributeOwnerCapital, withdrawOwnerProfit, isMarket, type City, type Zone } from './sim.ts';
import './compact-layout.css';
import './agriculture-tools.css';
import { readStoredCity, saveStoredCity, type SaveSource } from './save-storage.ts';
import { growthStatusText } from './context-data.ts';
import { createSignalPanel } from './signal-panel.ts';
import { createEntityExplanationPanel } from './entity-explanation-panel.ts';
import type { EntitySelection } from './entity-explanation-data.ts';
import { AtmosphereController } from './atmosphere-controls.ts';
import './atmosphere.css';
import { createOwnerDecisionSession } from './owner-decision-session.ts';
import { createOwnerDecisionPanel } from './owner-decision-panel.ts';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const money = (n: number) => '฿' + (n / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const BASE = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
const SIGNAL_ENV = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
const SIGNALS_ENABLED = SIGNAL_ENV.VITE_CITY_SIGNALS !== 'false' || new URLSearchParams(location.search).get('signals') === '1';
let signalPanel: ReturnType<typeof createSignalPanel> | undefined;
let entityExplanationPanel: ReturnType<typeof createEntityExplanationPanel> | undefined;
let city: City = createCity(61025);
const ownerDecisionSession = createOwnerDecisionSession(city);
let ownerDecisionPanel: ReturnType<typeof createOwnerDecisionPanel> | undefined;
let view: CityView;
let tool = 'select', selected: number | null = null, roadStart: number | null = null, hover: number | null = null;
let paused = false, speed = 1, accumulator = 0;
let importedLegacyRaw: string | null = null;
type Route = { page: 'city' | 'help' | 'game' | 'signals' } | { page: 'place'; cell: number; buildingId: number | null } | { page: 'household'; id: number; sourceBuildingId: number; sourceCell: number };
let route: Route | null = null;
const toolNames: Record<string, string> = { select: 'เลือกสถานที่', road: 'ถนน', R: 'โซนบ้าน', C: 'โซนพาณิชย์', I: 'โซนโรงงาน', F: 'โซนฟาร์ม', bulldoze: 'รื้อถอน', pan: 'เลื่อนแผนที่' };
const help: Record<string, string> = {
  select: 'แตะสถานที่เพื่อดูข้อมูลและเหตุผลการเติบโต',
  road: 'ถนน ฿50/ช่อง · ลากเส้น หรือแตะจุดเริ่มและจุดจบ · กลับเพื่อยกเลิก',
  R: 'โซนบ้านสร้างที่ว่างก่อน · ครัวเรือนย้ายเข้าเมื่อผ่านความจุ ถนน บริการ และงาน',
  C: 'วางโซนพาณิชย์ · เริ่มเป็นตลาดระดับ 1 · ครัวเรือนลงเงินและแรงงานเอง ซื้อขายพืชผลจริง',
  I: 'วางโรงงานข้างถนนเชื่อมเมือง · โรงงานเพิ่มต้องมีทุนกิจการจริงและพืชผล · ดูเงื่อนไขในภาพรวมเมือง',
  F: 'วางฟาร์มข้างถนน · ความอุดมสมบูรณ์อย่างน้อย 50% · ต้องมีแรงงานและผู้ซื้อพืชผล',
  bulldoze: 'แตะถนนหรืออาคารเพื่อรื้อ ฿20 · ประตูเชื่อมภายนอกรื้อไม่ได้',
  pan: 'ลากเพื่อเลื่อน · สองนิ้วเลื่อน/ซูม · ลากปุ่มขวาเพื่อหมุน'
};
function status(message: string) { $('#status').textContent = message; $('#inspector-status').textContent = message; }
function farmHint(index: number | null): string {
  if (index === null) return help.F;
  const fertility = city.resources.fertility[index];
  return `ฟาร์ม · ความอุดมสมบูรณ์ ${fertility}% · ${fertility < 50 ? 'ต้องอย่างน้อย 50%' : access(city, index) ? 'ถนนเชื่อมเมือง' : 'ต้องต่อถนนข้างแปลง'} · ต้องมีแรงงานและผู้ซื้อจริง`;
}
function setTool(next: string) {
  tool = next; roadStart = null; hover = null;
  if (next !== 'select') inspector(false);
  if (view) { view.abortGesture(); view.mode = next; view.dragStart = null; }
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(button => {
    const active = button.dataset.tool === next; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('#tool-help').textContent = help[next]; status(`${toolNames[next]}พร้อมใช้งาน`); render();
}
function inspector(open: boolean) {
  if (!open) signalPanel?.close();
  if (!open) entityExplanationPanel?.close();
  if (!open) { closeSubmenus(); route = null; }
  $('#inspector').dataset.open = String(open);
  $('#toggle-inspector').setAttribute('aria-expanded', String(open && route?.page === 'city'));
  $('#toggle-help').setAttribute('aria-expanded', String(open && route?.page === 'help'));
  $('#toggle-game-menu').setAttribute('aria-expanded', String(open && route?.page === 'game'));
  if (view) { view.abortGesture(); view.cameraBlocked = open; }
  document.querySelectorAll<HTMLButtonElement>('[data-camera], #toggle-camera').forEach(b => b.disabled = open);
  if (!open) { $('#inspector').dataset.page = 'none'; for (const e of document.querySelectorAll<HTMLElement>('[data-page-content]')) e.hidden = true; }
}
function selectedEntity(): EntitySelection | null {
  if ($('#inspector').dataset.open !== 'true') return null;
  const current = route;
  if (current?.page === 'place' && current.buildingId !== null && city.cells[current.cell]?.building === current.buildingId) {
    return { kind: 'building', buildingId: current.buildingId };
  }
  if (current?.page === 'household' && city.households.some(h => h.id === current.id) && city.cells[current.sourceCell]?.building === current.sourceBuildingId) {
    return { kind: 'household', householdId: current.id, sourceBuildingId: current.sourceBuildingId, sourceCell: current.sourceCell };
  }
  return null;
}
function openRoute(next: Route) {
  if (route?.page === 'signals' && next.page !== 'signals') signalPanel?.close();
  route = next; closeSubmenus(); $('#inspector-body').scrollTop = 0;
  if (next.page === 'place') selected = next.cell;
  inspector(true); setTool('select');
  if (next.page === 'signals') signalPanel?.refresh();
}
function cancel() {
  view?.abortGesture();
  if (hasOpenSubmenu()) { closeSubmenus(); return; }
  const current = route;
  if (current?.page === 'signals') { openRoute({ page: 'city' }); return; }
  if (current?.page === 'household') {
    const source = city.buildings.find(b => b.id === current.sourceBuildingId && b.cell === current.sourceCell);
    if (source) { openRoute({page:'place',cell:source.cell,buildingId:source.id}); return; }
  }
  if (route) { inspector(false); render(); status('กลับสู่แผนที่เมือง'); return; }
  if (roadStart !== null) { roadStart = null; status('ยกเลิกจุดเริ่มแล้ว · Road start cancelled'); render(); return; }
  if (tool !== 'select') { setTool('select'); return; }
  inspector(false); status('กลับสู่แผนที่เมือง');
}
function activate(index: number) {
  if (tool !== 'select' && tool !== 'pan') ownerDecisionSession.beforeExternal(city);
  selected = index;
  if (tool === 'road') {
    if (roadStart === null) { roadStart = index; status('เลือกจุดเริ่มแล้ว · แตะจุดจบ หรือกดกลับ'); }
    else { const result = buildRoad(city, roadStart, index); roadStart = null; status(result.message); }
  } else if (['R', 'C', 'I', 'F'].includes(tool)) status(zoneCell(city, index, tool as Zone).message);
  else if (tool === 'bulldoze') status(bulldoze(city, index).message);
  else if (tool === 'select') openRoute({page:'place',cell:index,buildingId:city.cells[index].building});
  if (tool !== 'select' && tool !== 'pan') ownerDecisionSession.syncExternal(city, 'player-map-command');
  render();
}
function node(tag: string, className = '', content?: string): HTMLElement {
  const element = document.createElement(tag); if (className) element.className = className; if (content !== undefined) element.textContent = content; return element;
}
function icon(name: string): HTMLImageElement { const img = document.createElement('img'); img.src = `${BASE}assets/kenney-ui/${name}.png`; img.alt = ''; return img; }
function tag(label: string, state: 'good' | 'warn' | 'bad' | '' = '') {
  const badge = node('span', `place-tag ${state}`); if (state === 'good' || state === 'bad') badge.append(icon(state === 'good' ? 'status-ok' : 'status-alert')); badge.append(document.createTextNode(label)); return badge;
}
function metric(label: string, value: string, isMoney = false, note?: string, rawValue?: number) {
  const keys: Record<string, string> = { 'เงินออม': 'cash', 'เงินสด': 'cash', 'คนงาน / ที่รับได้': 'workers', 'สินค้าคงคลัง': 'stock', 'สำรองค่าจ้าง': 'reserved', 'กำไรรอบก่อนภาษี': 'profit', 'ใช้จ่ายได้': 'spendable' };
  const card = node('dl', `metric${isMoney ? ' money' : ''}`); card.dataset.metric = keys[label] ?? label;
  if (label === 'ความอุดมสมบูรณ์') card.dataset.metric = 'fertility';
  if (rawValue !== undefined) card.dataset.value = String(rawValue);
  card.append(node('dt', '', label), node('dd', '', value)); if (note) card.append(node('small', '', note)); return card;
}
function symbol(zone: Zone, road: boolean, market = false) {
  const color = zone === 'R' ? '#87c99b' : zone === 'C' ? '#80b9db' : zone === 'I' ? '#e3a572' : zone === 'F' ? '#badb78' : '#f3c46b';
  const farmShape = '<path d="M10 58h76v22H10z" fill="#755b40"/><path d="M18 62v13m12-13v13m12-13v13m12-13v13m12-13v13m12-13v13" stroke="currentColor" stroke-width="6"/><path d="M18 29h33v28H18z" fill="#d6dfc3"/><path d="m13 29 21-17 22 17" fill="currentColor"/><path d="M62 47V20m0 16c-12 0-14-11-14-11 14-2 14 11 14 11m0-6c12 0 14-11 14-11-14-2-14 11-14 11" stroke="currentColor" stroke-width="4"/>';
  const marketShape = '<path d="M15 33h66v46H15z" fill="#36575b"/><path d="M10 29h76v17H10z" fill="currentColor"/><path d="M20 18h56l10 11H10z" fill="#d7e9d4"/><path d="M20 46v33m56-33v33M15 64h66" stroke="currentColor" stroke-width="5"/><path d="M27 56h17v8H27zM52 56h15v8H52z" fill="#badb78"/>';
  const shape = zone === 'F' && !road ? farmShape : market && !road ? marketShape : road ? '<path d="M35 7h26v82H35z" fill="#748b88"/><path d="M48 12v15m0 10v15m0 10v15" stroke="#f3c46b" stroke-width="3"/>' : zone === 'R' ? '<path d="M17 44 48 18l31 26v37H17z" fill="currentColor"/><path d="M12 44 48 13l36 31" fill="none" stroke="#d7e9d4" stroke-width="5"/><path d="M41 55h16v26H41zM25 49h10v13H25zM64 49h10v13H64z" fill="#28474a"/>' : zone === 'C' ? '<path d="M15 36h66v45H15z" fill="currentColor"/><path d="m12 24 72 0v20H12z" fill="#d7e9d4"/><path d="M25 24v20m22-20v20m23-20v20" stroke="currentColor" stroke-width="12"/><path d="M25 54h23v18H25zM59 54h14v27H59z" fill="#28474a"/>' : zone === 'I' ? '<path d="M14 45 35 33v12l22-12v12h25v36H14zM66 14h12v31H66z" fill="currentColor"/><path d="M24 57h11v11H24zM44 57h11v11H44zM64 57h10v11H64z" fill="#28474a"/>' : '<path d="M14 44h19v37H14zM39 21h21v60H39zM66 36h16v45H66z" fill="currentColor"/><path d="M45 30h9m-9 12h9m-9 12h9" stroke="#28474a" stroke-width="4"/>';
  $('#place-art').innerHTML = `<svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:${color}"><ellipse cx="48" cy="83" rx="38" ry="6" fill="#102d32"/>${shape}</svg>`;
}
function shortReason(reason: string): string | null {
  if (reason.startsWith('No connected road frontage')) return 'ยังไม่มีถนนข้างแปลงที่เชื่อมถึงประตูภายนอก';
  if (reason.startsWith('No power')) return 'ไฟฟ้าภายนอกไม่พร้อมใช้งาน';
  if (reason.startsWith('No water')) return 'น้ำภายนอกไม่พร้อมใช้งาน';
  if (reason.startsWith('No housing demand')) return 'ความจุบ้านว่างที่ใช้ได้ยังรองรับผู้ย้ายเข้าและครัวเรือนไร้บ้านตามเงื่อนไขปัจจุบัน';
  if (reason.startsWith('No industry demand')) return null;
  if (reason.startsWith('No retail demand')) return 'ร้านค้าที่มีอยู่รองรับความต้องการปัจจุบันแล้ว';
  if (reason.startsWith('Viability:')) { const n = reason.match(/need (\d+).*have (\d+)/); return n ? `ร้านค้าต้องมีครัวเรือนที่มีเงินและเชื่อมถนน ${n[1]} ครัวเรือน (ขณะนี้ ${n[2]})` : 'ลูกค้ายังไม่พอให้รายได้คุ้มค่าจ้างและค่าเช่า'; }
  if (reason.includes('limit (')) return 'ถึงจำนวนสูงสุดที่ต้นแบบรองรับแล้ว';
  if (reason.startsWith('Expected income')) return 'รายได้คาดหมายยังไม่พอซื้อสินค้าและจ่ายค่าเช่า';
  if (reason.startsWith('Eligible;')) return `พร้อมพัฒนา ทบทวนแปลงอีก ${3 - city.tick % 3} วัน แล้วสุ่มเลือกจากแปลงที่ผ่านเงื่อนไข`;
  return null;
}
function ownerFinanceAction(action: 'contribute' | 'withdraw', firmId: number) {
  const firm = city.firms.find(value => value.id === firmId);
  if (!firm || route?.page !== 'place' || city.cells[route.cell]?.building !== firm.building) {
    status('สถานที่เปลี่ยนแล้ว กรุณาเปิดกิจการที่ต้องการอีกครั้ง'); return;
  }
  ownerDecisionSession.beforeExternal(city);
  const result = action === 'contribute' ? contributeOwnerCapital(city, firmId, 10_000) : withdrawOwnerProfit(city, firmId, 10_000);
  if (result.ok) ownerDecisionSession.syncExternal(city, 'manual-owner-finance');
  status(result.message); render();
  showOwnerFinanceResult(firmId, result.message);
}
function renderPlace() {
  const metrics: HTMLElement[] = [], tags: HTMLElement[] = [], reasons: string[] = [];
  const cellIndex = route?.page === 'place' ? route.cell : null;
  const cell = cellIndex === null ? null : city.cells[cellIndex];
  const building = cell?.building == null ? null : city.buildings.find(b => b.id === cell.building);
  const householdId = route?.page === 'household' ? route.id : null;
  const household = city.households.find(h => h.id === householdId);
  const page = route?.page === 'city' || route?.page === 'help' || route?.page === 'game' || route?.page === 'signals' ? route.page : route ? 'entity' : 'none';
  $('#inspector').dataset.page = page; $('#inspector').dataset.back = String(route !== null);
  $('#inspector').dataset.household = String(route?.page === 'household');
  $('#submenu-back').setAttribute('aria-label', route?.page === 'household' ? 'กลับอาคารต้นทาง' : 'ย้อนกลับ');
  for (const e of document.querySelectorAll<HTMLElement>('[data-page-content]')) e.hidden = e.dataset.pageContent !== page;
  if (route?.page === 'city') {
    $('#selection-title').textContent = 'ภาพรวมเมือง'; $('#place-subtitle').textContent = 'ข้อมูลทั้งเมือง · เศรษฐกิจพื้นฐาน'; symbol(null, false);
  } else if (route?.page === 'signals') {
    $('#selection-title').textContent = 'สัญญาณเมือง'; $('#place-subtitle').textContent = 'ข้อมูลจากเกม · อ่านอย่างเดียว'; symbol(null, false);
  } else if (route?.page === 'help') {
    $('#selection-title').textContent = 'คู่มือและสมมติฐาน'; $('#place-subtitle').textContent = 'วิธีเล่น · ขอบเขตต้นแบบ'; symbol(null, false);
  } else if (route?.page === 'game') {
    $('#selection-title').textContent = 'เมนูเกม'; $('#place-subtitle').textContent = 'บันทึกในเบราว์เซอร์นี้'; symbol(null, false);
  } else if (household) {
    $('#selection-title').textContent = 'ครัวเรือน #' + household.id;
    $('#place-subtitle').textContent = 'ข้อมูลเฉพาะครัวเรือน · ไม่ใช่บุคคลรายคน'; symbol('R', false);
  } else if (cell && cellIndex !== null) {
    const firm = building && city.firms.find(f => f.building === building.id);
    const name = cell.road ? 'ถนน' : cell.zone === 'R' ? 'บ้านพัก' : cell.zone === 'C' ? firm && isMarket(firm) ? 'พาณิชย์ระดับ 1 · ตลาด' : building ? 'พาณิชย์ · ร้านค้าสำเร็จรูป' : 'โซนพาณิชย์ · เริ่มที่ตลาดระดับ 1' : cell.zone === 'I' ? 'โรงงาน' : cell.zone === 'F' ? 'ฟาร์มพืชผล' : 'ที่ดินว่าง';
    $('#selection-title').textContent = name + (building ? ' #' + building.id : '') + ' · ' + (cellIndex % SIZE + 1) + ',' + (Math.floor(cellIndex / SIZE) + 1);
    $('#place-subtitle').textContent = building ? 'เฉพาะสถานที่นี้ · ระดับ ' + building.level + ' · อายุ ' + building.age + ' วัน' : 'ข้อมูลเฉพาะแปลงนี้'; symbol(cell.zone, cell.road, !!firm && isMarket(firm));
    const connected = access(city, cellIndex); tags.push(tag(connected ? 'ถนนเชื่อมถึงเมือง' : 'ขาดการเชื่อมต่อ', connected ? 'good' : 'bad'));
    if (cell.zone === 'F') {
      const fertility = city.resources.fertility[cellIndex];
      if (!building) metrics.push(metric('ความอุดมสมบูรณ์', `${fertility}%`, false, 'พืชผลหมุนเวียน ไม่ใช่แหล่งที่หมดลง', fertility));
      tags.push(tag(fertility >= 50 ? 'เหมาะสำหรับปลูกพืช' : 'ความอุดมสมบูรณ์ไม่ถึง 50%', fertility >= 50 ? 'good' : 'bad'));
    }
    if (!connected) reasons.push('ต้องเชื่อมถนนข้างแปลงกับประตูภายนอกฝั่งตะวันตก');
    if (!city.utilities.power || !city.utilities.water) reasons.push('บริการน้ำหรือไฟภายนอกไม่พร้อม การผลิตและเติบโตหยุดชั่วคราว');
    if (cell.road) { metrics.push(metric('สร้างต่อช่อง', money(5000), true), metric('บำรุงรักษาต่อวัน', money(10), true)); reasons.push(connected ? 'ถนนนี้เชื่อมกับตลาดภายนอก' : 'ถนนนี้ยังแยกจากตลาดภายนอก'); }
    else if (!building && cell.zone) {
      reasons.push(...explainCell(city, cellIndex).map(reason => shortReason(reason) ?? (cell.zone === 'F' || cell.zone === 'C' ? reason : null)).filter((s):s is string => s !== null));
      if (cell.zone === 'I' && connected && city.utilities.power && city.utilities.water) {
        const growth = growthStatusText(city); reasons.push(`โอกาสลงทุนเมือง: ${growth.message}`);
        if (!growth.status.bootstrap && growth.status.sponsorFirmId !== null) {
          const available = metric('ทุนที่ใช้ขยายได้', money(growth.status.availableCapital), true, 'โอกาสลงทุนเมือง · หลังกันเงินเดือน ภาษี ค่าเช่า และเงินหมุนเวียน', growth.status.availableCapital);
          available.dataset.growthMetric = 'capital-available';
          const required = metric('ทุนเปิดโรงงานเพิ่ม', money(growth.status.requiredCapital), true, 'โอกาสลงทุนเมือง · โอนจากกิจการผู้ลงทุนจริง', growth.status.requiredCapital);
          required.dataset.growthMetric = 'capital-required'; metrics.push(available, required);
        }
      }
    }
    else if (!cell.zone) reasons.push('แปลงนี้ยังไม่มีโซน');
  } else { $('#selection-title').textContent = 'เลือกสถานที่บนแผนที่'; $('#place-subtitle').textContent = 'บ้าน · บริษัท · ครัวเรือน'; symbol(null, false); }
  $('#place-tags').replaceChildren(...tags); $('#place-metrics').replaceChildren(...metrics); $('#place-metrics').hidden = !metrics.length;
  $('#explanation').replaceChildren(...reasons.map(r=>node('p','reason',r))); $('.explain-section').hidden = !reasons.length;
  const selection = route?.page === 'household' ? {kind:'household' as const,id:route.id,sourceBuildingId:route.sourceBuildingId,sourceCell:route.sourceCell} : cellIndex !== null ? {kind:'place' as const,cell:cellIndex} : null;
  renderContext(city, selection, (id, sourceBuildingId, sourceCell) => openRoute({page:'household',id,sourceBuildingId,sourceCell}), ownerFinanceAction);
  if (page === 'city') renderCityOverview(city);
}
function validateRoute() {
  const current = route;
  if (current?.page === 'place' && current.buildingId !== null && city.cells[current.cell]?.building !== current.buildingId || current?.page === 'household' && (!city.households.some(h=>h.id===current.id) || city.cells[current.sourceCell]?.building !== current.sourceBuildingId)) {
    inspector(false); status('สถานที่หรือครัวเรือนนี้ไม่มีอยู่แล้ว เลือกใหม่บนแผนที่');
  }
}

function render() {
  if (!view) return;
  signalPanel?.sync();
  validateRoute(); const s = summary(city);
  $('#day').textContent = `วันที่ ${city.tick} · เดือน ${Math.floor(city.tick / 30) + 1}`;
  $('#pause').textContent = paused ? '▶' : 'Ⅱ'; $('#pause').setAttribute('aria-label', paused ? 'เล่นต่อ' : 'หยุดเวลา'); $('#pause').title = paused ? 'เล่นต่อ (Space)' : 'หยุดเวลา (Space)'; $('#pause').setAttribute('aria-pressed', String(paused));
  document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => { b.classList.toggle('active', Number(b.dataset.speed) === speed); b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed)); });
  const demand = node('div', 'demand-grid');
  for (const [zone, label] of [['R', 'บ้าน'], ['C', 'พาณิชย์'], ['I', 'โรงงาน'], ['F', 'ฟาร์ม']] as const) { const item = node('div', `demand-item ${zone.toLowerCase()}`); item.append(node('span', '', label), node('b', '', String(s.demand[zone]))); demand.append(item); }
  $('#growth-summary').replaceChildren(demand); renderPlace(); entityExplanationPanel?.sync(); ownerDecisionPanel?.sync();
  if (route?.page === 'city' || route?.page === 'help') renderSubmenus(city, null);
  const start = view.dragStart ?? roadStart; const preview = start === null ? (hover === null ? [] : [hover]) : hover === null ? [start] : roadPath(start, hover);
  view.render(city, selected, preview);
}

async function boot() {
  setupSubmenus(); setupSubmenuNavigation(cancel);
  $('#signal-entry').hidden = !SIGNALS_ENABLED;
  signalPanel = createSignalPanel($('#signal-content'), { getCity: () => city, connection: {
    enabled: SIGNAL_ENV.VITE_CITY_ADVISOR_ONLINE !== 'false', endpoint: SIGNAL_ENV.VITE_CITY_ADVISOR_ENDPOINT || 'https://157.85.96.139:5444/api/city-advisor/report'
  } });
  const entityExplanationHost = document.createElement('section');
  entityExplanationHost.id = 'entity-explanation-host';
  $('#entity-content').insertAdjacentElement('afterend', entityExplanationHost);
  entityExplanationPanel = createEntityExplanationPanel(entityExplanationHost, {
    getCity: () => city, getSelection: selectedEntity, connection: {
      enabled: SIGNAL_ENV.VITE_CITY_ENTITY_ADVISOR_ONLINE === 'true',
      endpoint: SIGNAL_ENV.VITE_CITY_ADVISOR_ENDPOINT || 'https://157.85.96.139:5444/api/city-advisor/report'
    }
  });
  const ownerDecisionHost = document.createElement('details');
  $('#city-content').insertBefore(ownerDecisionHost, $('#city-content .ledger-details'));
  ownerDecisionPanel = createOwnerDecisionPanel(ownerDecisionHost, {
    getCity: () => city, getSession: () => ownerDecisionSession, onChange: render,
  });
  $('#open-signals').addEventListener('click', () => { if (SIGNALS_ENABLED) openRoute({ page: 'signals' }); });
  view = await CityView.create($('#city-canvas'), activate, index => { if (hover !== index) { hover = index; if (tool === 'F' && !route) { const hint = farmHint(index); $('#tool-help').textContent = hint; status(hint); } render(); } }, (a, b) => {
    ownerDecisionSession.beforeExternal(city);
    selected = b; roadStart = null; status(buildRoad(city, a, b).message);
    ownerDecisionSession.syncExternal(city, 'player-drag-road'); render();
  });
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool!)));
  document.querySelectorAll<HTMLElement>('[data-camera]').forEach(b => b.addEventListener('click', () => view.control(b.dataset.camera!)));
  document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => b.addEventListener('click', () => { speed = Number(b.dataset.speed); accumulator = 0; render(); }));
  $('#pause').addEventListener('click', () => { paused = !paused; accumulator = 0; render(); });
  $('#cancel-tool').addEventListener('click', cancel);
  $('#toggle-camera').addEventListener('click', () => {
    const open = $('.camera-hud').dataset.open !== 'true';
    $('.camera-hud').dataset.open = String(open); $('#toggle-camera').setAttribute('aria-expanded', String(open));
  });
  $('#toggle-inspector').addEventListener('click', () => { if (route?.page === 'city') { inspector(false); render(); } else openRoute({page:'city'}); });
  $('#toggle-help').addEventListener('click', () => { if (route?.page === 'help') { inspector(false); render(); } else openRoute({page:'help'}); });
  $('#toggle-game-menu').addEventListener('click', () => { if (route?.page === 'game') { inspector(false); render(); } else openRoute({page:'game'}); });
  $('#close-inspector').addEventListener('click', () => { inspector(false); render(); });
  $('#save').addEventListener('click', () => {
    try { saveStoredCity(localStorage, serialize(city), importedLegacyRaw); status(`บันทึกรุ่น 6 ในเบราว์เซอร์แล้ว · Saved day ${city.tick}`); } catch { status('บันทึกไม่ได้: พื้นที่หรือสำเนากู้คืนไม่พร้อม เซฟเดิมยังอยู่'); }
  });
  const loadStored = (source: SaveSource) => {
    try {
      const saved = readStoredCity(localStorage, source); if (!saved) { status(source === 'backup' ? 'ยังไม่มีสำเนากู้คืนเซฟเดิม' : 'ยังไม่มีเมืองที่บันทึกในช่องนี้'); return; }
      const loaded = deserialize(saved.raw), oldVersion = JSON.parse(saved.raw).version, legacy = oldVersion >= 1 && oldVersion <= 5;
      city = loaded; importedLegacyRaw = legacy ? saved.raw : null;
      ownerDecisionSession.reset(city); ownerDecisionPanel?.reset();
      selected = roadStart = null; if (route?.page === 'place' || route?.page === 'household') inspector(false); paused = true; accumulator = 0; render();
      status(legacy ? `นำเข้า v${oldVersion} วันที่ ${city.tick} แล้ว · ${oldVersion >= 3 ? 'คงทักษะเดิม' : 'ทักษะเดิมสมมติเป็นแรงงานทั่วไป'}${oldVersion === 1 ? ' และสมาชิกเป็นสมมติฐานขั้นต่ำ' : ''} · ${oldVersion >= 4 ? 'คงเงิน สต็อก เจ้าของ และแรงงาน · ไม่แจกทุนขยายกิจการ' : 'เริ่มพืชผลที่ศูนย์ · วางฟาร์มและพาณิชย์ระดับ 1'} · ยังไม่เขียนทับเซฟใด` : `โหลดวันที่ ${city.tick} แล้ว · หยุดเวลาให้ตรวจข้อมูล`);
    } catch (error) { status(`โหลดไม่สำเร็จ เมืองปัจจุบันยังอยู่ · ${error instanceof Error ? error.message : 'ข้อมูลบันทึกไม่ถูกต้อง'}`); }
  };
  $('#load').addEventListener('click', () => loadStored('current'));
  $('#load-legacy').addEventListener('click', () => loadStored('legacy'));
  $('#load-v2').addEventListener('click', () => loadStored('household'));
  $('#load-v3').addEventListener('click', () => loadStored('worker'));
  $('#load-v4').addEventListener('click', () => loadStored('agriculture'));
  $('#load-v5').addEventListener('click', () => loadStored('commercial'));
  $('#load-backup').addEventListener('click', () => loadStored('backup'));
  $('#new-city').addEventListener('click', () => {
    const dialog = document.createElement('dialog');
    const title = document.createElement('h2'); title.textContent = 'เริ่มเมืองเดิมอีกครั้ง?';
    const text = document.createElement('p'); text.textContent = 'เมืองที่ยังไม่บันทึกจะถูกแทนที่ เมืองที่เคยบันทึกยังเรียกคืนได้ด้วยปุ่มโหลด';
    const back = document.createElement('button'); back.textContent = 'กลับสู่เมือง'; back.autofocus = true;
    const reset = document.createElement('button'); reset.textContent = 'เริ่มเมืองใหม่';
    back.onclick = () => dialog.close(); reset.onclick = () => { city = createCity(61025); ownerDecisionSession.reset(city); ownerDecisionPanel?.reset(); importedLegacyRaw = null; selected = roadStart = null; inspector(false); accumulator = 0; paused = true; setTool('select'); render(); status('เมืองพร้อมแล้ว · กดเล่นต่อเพื่อเริ่มเวลา'); dialog.close(); };
    dialog.append(title, text, back, reset); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
  });
  document.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    if (route) return;
    if (e.key === ' ' && !(e.target instanceof Element && e.target.closest('button, summary, a, select, input, textarea, [contenteditable]'))) { e.preventDefault(); paused = !paused; accumulator = 0; render(); }
    const shortcuts: Record<string, string> = { v: 'select', r: 'road', '1': 'R', '2': 'C', '3': 'I', '4': 'F', b: 'bulldoze', p: 'pan' };
    if (shortcuts[e.key.toLowerCase()]) setTool(shortcuts[e.key.toLowerCase()]);
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); view.control(e.key.slice(5).toLowerCase()); }
    if (e.key === 'q') view.control('rotate-left'); if (e.key === 'e') view.control('rotate-right');
  });
  document.addEventListener('visibilitychange', () => { accumulator = 0; });
  inspector(false);
  setTool('select'); status('รับทุนตั้งเมืองแล้ว · ต่อถนนจากประตูสีเหลืองเพื่อขยายเมือง');
  const atmosphere = new AtmosphereController({ view, getCity: () => city, isPaused: () => paused, getSpeed: () => speed, tickFraction: () => accumulator });
  view.app.on('update', (dt: number) => {
    atmosphere.update(dt);
    view.traffic.update(dt, !paused && !document.hidden);
    if (paused || document.hidden) return;
    accumulator += Math.min(dt, 0.25) * speed;
    let changed = false;
    while (accumulator >= 1) { const outcomes = ownerDecisionSession.advance(city); ownerDecisionPanel?.noteOutcomes(outcomes); accumulator -= 1; changed = true; }
    if (changed) render();
  });
  // Read-only diagnostics for reproducible QA; no renderer-owned simulation state.
  Object.defineProperty(window, 'cityManager', { value: { snapshot: () => serialize(city), cellScreen: (i: number) => view.project(i), engine: 'PlayCanvas 2.23.3', visuals: () => view.assets?.status ?? { ready: false, loaded: [], failed: [] }, ground: () => view.ground.diagnostics, agriculture: () => view.agricultureDiagnostics(), atmosphere: () => atmosphere.diagnostics } });
  $('#city-canvas').addEventListener('webglcontextlost', () => { paused = true; status('Graphics context lost. Save your city, then reload.'); render(); });
}
boot().catch(error => { console.error(error); status('Could not start WebGL2. Enable hardware graphics and reload in a supported browser.'); });
