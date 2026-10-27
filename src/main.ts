import '@fontsource/ibm-plex-sans-thai/thai-400.css';
import '@fontsource/ibm-plex-sans-thai/thai-600.css';
import '@fontsource/ibm-plex-sans-thai/thai-700.css';
import '@fontsource/ibm-plex-sans-thai/latin-400.css';
import '@fontsource/ibm-plex-sans-thai/latin-600.css';
import '@fontsource/ibm-plex-sans-thai/latin-700.css';
import './style.css';
import './tokens.css';
import { setupSubmenus, renderSubmenus } from './submenus.ts';
import { setupSubmenuNavigation, closeSubmenus, hasOpenSubmenu } from './submenu-navigation.ts';
import './submenu-layout.css';
import './context-layout.css';
import { renderContext, renderCityOverview, showOwnerFinanceResult } from './context-panels.ts';
import { CityView } from './renderer.ts';
import { GATEWAY, SIZE, access, utilityAt, utilities, utilityStatus, plantAt, buildPlant, createCity, buildRoad, zoneCell, bulldoze, summary, serialize, deserialize, roadPath, contributeOwnerCapital, withdrawOwnerProfit, isMarket, type City, type Zone } from './sim.ts';
import './compact-layout.css';
import './agriculture-tools.css';
import { readStoredCity, saveStoredCity, type SaveSource } from './save-storage.ts';
import { growthStatusText } from './context-data.ts';
import { createSignalPanel } from './signal-panel.ts';
import { createEntityExplanationPanel } from './entity-explanation-panel.ts';
import type { EntitySelection } from './entity-explanation-data.ts';
import { AtmosphereController } from './atmosphere-controls.ts';
import './atmosphere.css';
import { previewPlacement, type Preview } from './placement-preview.ts';
import { mapOverlay, buildingIssues, TOOL_OVERLAY } from './map-overlay.ts';
import { MapMarkers } from './map-markers.ts';
import { CityHud } from './city-hud.ts';
import { thaiMessage } from './event-text.ts';
import { PLANTS, PLANT_LABELS } from './utilities.ts';
import { parcelChecklist, roadFacts, type ParcelChecklist } from './place-checklist.ts';
import { OverviewDashboard } from './overview-panels.ts';
import { CityStatsPanel } from './city-stats-panel.ts';
import { decoratePanels, watchPanels } from './panel-decor.ts';
import { installHudIcons } from './hud-icons.ts';
import { recordDemand, demandSparkline } from './demand-history.ts';
import { Guide } from './guide.ts';
import { firmGoodsName } from './goods-view.ts';
import { CROP_LABELS, cropForFertility } from './goods.ts';
import { Minimap } from './minimap.ts';
import { iconElement } from './ui-icons.ts';
import { installKeycaps } from './keycaps.ts';
import { CityNetworkView } from './city-network-view.ts';
import { installSheetHandle } from './sheet-handle.ts';
import './panels.css';
import './hud.css';
import './panel-theme.css';
import { GoalPill, WinWatch, cityGoals } from './goals-panel.ts';
import { advancedEnabled, storeAdvanced } from './advanced.ts';
import { AudioEngine, type EffectName } from './audio-engine.ts';
import { installAudioPanel } from './audio-panel.ts';
import { CueLimiter, cityCues, cueSnapshot } from './audio-cues.ts';
import { createOwnerDecisionSession } from './owner-decision-session.ts';
import { createOwnerDecisionPanel } from './owner-decision-panel.ts';
import { installMarketPanel } from './market-panel.ts';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const money = (n: number) => '฿' + (n / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const BASE = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
const SIGNAL_ENV = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
let advancedOn = advancedEnabled();
// Signals are an experimental page: the build flag can still hold them back, `?signals=1` overrides it.
const signalsEnabled = () => advancedOn && (SIGNAL_ENV.VITE_CITY_SIGNALS !== 'false' || new URLSearchParams(location.search).get('signals') === '1');
let signalPanel: ReturnType<typeof createSignalPanel> | undefined;
let entityExplanationPanel: ReturnType<typeof createEntityExplanationPanel> | undefined;
// A first game starts on an empty map with the guide; `?starter=1` opens the sample city instead.
const STARTER = new URLSearchParams(location.search).get('starter') === '1';
let city: City = createCity(61025, { starter: STARTER });
const ownerDecisionSession = createOwnerDecisionSession(city);
let ownerDecisionPanel: ReturnType<typeof createOwnerDecisionPanel> | undefined;
let atmosphere: AtmosphereController | undefined, mapMarkers: MapMarkers | undefined, cityHud: CityHud | undefined, dashboard: OverviewDashboard | undefined, cityStatsPanel: CityStatsPanel | undefined, guide: Guide | undefined, minimap: Minimap | undefined, cityNetwork: CityNetworkView | undefined;
let goalPill: GoalPill | undefined, winWatch: WinWatch | undefined, audioPanel: { sync(): void } | undefined;
let marketPanel: ReturnType<typeof installMarketPanel> | undefined;
const audio = new AudioEngine(BASE + 'assets/audio/'), cueLimiter = new CueLimiter();
const sound = (name: EffectName) => audio.play(name);
/** A map command's result gets its own sound: the action on success, a soft refusal otherwise. */
const resultSound = <T extends { ok: boolean }>(result: T, success: EffectName): T => { sound(result.ok ? success : 'ui-error'); return result; };
const mapInfo = { overlayKey: '', overlayTick: -1, overlayAt: 0, issueLayout: '', issueTick: -1, issueAt: 0 };
let view: CityView;
let tool = 'select', selected: number | null = null, roadStart: number | null = null, hover: number | null = null;
let paused = false, speed = 1, accumulator = 0;
let pausedByTyphoonAuto = false;
let importedLegacyRaw: string | null = null;
type Route = { page: 'city' | 'help' | 'game' | 'signals' } | { page: 'place'; cell: number; buildingId: number | null } | { page: 'household'; id: number; sourceBuildingId: number; sourceCell: number };
let route: Route | null = null;
const toolNames: Record<string, string> = { select: 'เลือกสถานที่', road: 'ถนน', R: 'โซนบ้าน', C: 'โซนพาณิชย์', I: 'โซนโรงงาน', F: 'โซนฟาร์ม', power: 'โรงไฟฟ้า', water: 'โรงสูบน้ำ', bulldoze: 'รื้อถอน', pan: 'เลื่อนแผนที่' };
const help: Record<string, string> = {
  select: 'แตะสถานที่เพื่อดูข้อมูลและเหตุผลการเติบโต',
  road: 'ถนน ฿50/ช่อง · ลากเส้น หรือแตะจุดเริ่มและจุดจบ · กลับเพื่อยกเลิก',
  R: 'โซนบ้านสร้างที่ว่างก่อน · ครัวเรือนย้ายเข้าเมื่อผ่านความจุ ถนน บริการ และงาน',
  C: 'วางโซนพาณิชย์ · เริ่มเป็นตลาดระดับ 1 · ครัวเรือนลงเงินและแรงงานเอง ซื้อขายพืชผลจริง',
  I: 'วางโรงงานข้างถนนเชื่อมเมือง · โรงงานเพิ่มต้องมีทุนกิจการจริงและพืชผล · ดูเงื่อนไขในภาพรวมเมือง',
  F: 'วางฟาร์มข้างถนน · ความอุดมสมบูรณ์อย่างน้อย 50% · ต้องมีแรงงานและผู้ซื้อพืชผล',
  power: 'โรงไฟฟ้า ฿5,000 · +40 หน่วย · บำรุง ฿120/เดือน · วางแปลงว่างริมถนน ไฟวิ่งตามถนน อาคารใกล้ได้ก่อน',
  water: 'โรงสูบน้ำ ฿3,000 · +40 หน่วย · บำรุง ฿60/เดือน · วางแปลงว่างริมถนน น้ำวิ่งตามถนน อาคารใกล้ได้ก่อน',
  bulldoze: 'แตะถนน อาคาร หรือโรงน้ำไฟเพื่อรื้อ ฿20 · ประตูเชื่อมภายนอกรื้อไม่ได้',
  pan: 'ลากเพื่อเลื่อน · สองนิ้วเลื่อน/ซูม · ลากปุ่มขวาเพื่อหมุน'
};
const WARN_TEXT = /ไม่พอ|ไม่ได้|ต้อง|ขวาง|ไม่ถูกต้อง|นอกแผนที่|ยังไม่เชื่อม|ไม่มีอยู่แล้ว|ไม่พบ/;
function status(message: string) {
  const text = thaiMessage(message), chip = $('#status'), changed = chip.textContent !== text;
  chip.textContent = text; $('#inspector-status').textContent = text;
  // Tone and a short pop make each result read as a toast; the words stay the same.
  chip.dataset.tone = WARN_TEXT.test(text) ? 'warn' : /แล้ว|เรียบร้อย|Saved/.test(text) ? 'good' : 'info';
  if (changed && !matchMedia('(prefers-reduced-motion: reduce)').matches) chip.animate?.([{ opacity: .55 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
}
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
  if ($('#inspector').dataset.open !== String(open)) sound(open ? 'ui-open' : 'ui-close');
  $('#inspector').dataset.open = String(open);
  $('#toggle-inspector').setAttribute('aria-expanded', String(open && route?.page === 'city'));
  $('#toggle-help').setAttribute('aria-expanded', String(open && route?.page === 'help'));
  $('#toggle-game-menu').setAttribute('aria-expanded', String(open && route?.page === 'game'));
  if (view) { view.abortGesture(); view.cameraBlocked = open; }
  document.querySelectorAll<HTMLButtonElement>('[data-camera], #toggle-camera, #toggle-camera-pan').forEach(b => b.disabled = open);
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
  if (cityNetwork?.open) { cityNetwork.toggle(false); return; }
  if (cityStatsPanel?.open) { cityStatsPanel.toggle(false); return; }
  if (dashboard?.modalOpen) { dashboard.closeModal(); return; }
  if (minimap?.mapOpen) { minimap.toggleMap(false); return; }
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
    else { const result = resultSound(buildRoad(city, roadStart, index), 'ui-road'); roadStart = null; status(result.message); }
  } else if (['R', 'C', 'I', 'F'].includes(tool)) status(resultSound(zoneCell(city, index, tool as Zone), 'ui-place').message);
  else if (tool === 'power' || tool === 'water') status(resultSound(buildPlant(city, index, tool), 'ui-place').message);
  else if (tool === 'bulldoze') status(resultSound(bulldoze(city, index), 'ui-bulldoze').message);
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
  const marketShape = '<path d="M15 33h66v46H15z" fill="#3f5075"/><path d="M10 29h76v17H10z" fill="currentColor"/><path d="M20 18h56l10 11H10z" fill="#d7e9d4"/><path d="M20 46v33m56-33v33M15 64h66" stroke="currentColor" stroke-width="5"/><path d="M27 56h17v8H27zM52 56h15v8H52z" fill="#badb78"/>';
  const shape = zone === 'F' && !road ? farmShape : market && !road ? marketShape : road ? '<path d="M35 7h26v82H35z" fill="#7886a2"/><path d="M48 12v15m0 10v15m0 10v15" stroke="#f3c46b" stroke-width="3"/>' : zone === 'R' ? '<path d="M17 44 48 18l31 26v37H17z" fill="currentColor"/><path d="M12 44 48 13l36 31" fill="none" stroke="#d7e9d4" stroke-width="5"/><path d="M41 55h16v26H41zM25 49h10v13H25zM64 49h10v13H64z" fill="#314063"/>' : zone === 'C' ? '<path d="M15 36h66v45H15z" fill="currentColor"/><path d="m12 24 72 0v20H12z" fill="#d7e9d4"/><path d="M25 24v20m22-20v20m23-20v20" stroke="currentColor" stroke-width="12"/><path d="M25 54h23v18H25zM59 54h14v27H59z" fill="#314063"/>' : zone === 'I' ? '<path d="M14 45 35 33v12l22-12v12h25v36H14zM66 14h12v31H66z" fill="currentColor"/><path d="M24 57h11v11H24zM44 57h11v11H44zM64 57h10v11H64z" fill="#314063"/>' : '<path d="M14 44h19v37H14zM39 21h21v60H39zM66 36h16v45H66z" fill="currentColor"/><path d="M45 30h9m-9 12h9m-9 12h9" stroke="#314063" stroke-width="4"/>';
  $('#place-art').innerHTML = `<svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:${color}"><ellipse cx="48" cy="83" rx="38" ry="6" fill="#192746"/>${shape}</svg>`;
}
function parcelChecklistView(parcel: ParcelChecklist): HTMLElement {
  const box = node('div', 'parcel-checklist'); box.dataset.parcelChecklist = parcel.eligible ? 'eligible' : 'blocked';
  const failed = parcel.checks.filter(c => c.state === 'fail').length;
  const head = node('p', `parcel-verdict ${parcel.eligible ? 'good' : 'bad'}`, parcel.eligible
    ? `พร้อมพัฒนา · ทบทวนแปลงอีก ${parcel.nextReview} วัน แล้วสุ่มเลือกจากแปลงที่ผ่านเงื่อนไข`
    : `ยังไม่โต · ติด ${failed} เงื่อนไข`);
  const list = node('ol', 'parcel-checks');
  for (const check of parcel.checks) {
    const item = node('li', `cx-check ${check.state}`); item.dataset.check = check.key; item.dataset.state = check.state;
    item.append(node('span', 'parcel-check-label', check.label)); if (check.detail) item.append(node('small', 'parcel-check-detail', check.detail));
    list.append(item);
  }
  box.append(head, list, node('p', 'parcel-note', parcel.note)); return box;
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
  let checklist: HTMLElement | null = null;
  const cellIndex = route?.page === 'place' ? route.cell : null;
  const cell = cellIndex === null ? null : city.cells[cellIndex];
  const building = cell?.building == null ? null : city.buildings.find(b => b.id === cell.building);
  const householdId = route?.page === 'household' ? route.id : null;
  const household = city.households.find(h => h.id === householdId);
  const page = route?.page === 'city' || route?.page === 'help' || route?.page === 'game' || route?.page === 'signals' ? route.page : route ? 'entity' : 'none';
  $('#inspector').dataset.page = page; $('#inspector').dataset.back = String(route !== null);
  // Header tint follows what is selected (visual only).
  const firmHere = building && city.firms.find(f => f.building === building.id);
  $('#inspector').dataset.kind = route?.page === 'household' ? 'household' : page !== 'entity' ? page : !cell ? 'none' : cell.road ? 'road' : !cell.zone ? 'land' : cell.zone === 'C' && firmHere && isMarket(firmHere) ? 'market' : cell.zone;
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
    const plant = plantAt(city, cellIndex);
    const name = plant ? PLANT_LABELS[plant.kind] : cell.road ? 'ถนน' : cell.zone === 'R' ? 'บ้านพัก' : cell.zone === 'C' ? firm && isMarket(firm) ? 'พาณิชย์ระดับ 1 · ตลาด' : building ? 'พาณิชย์ · ร้านค้าสำเร็จรูป' : 'โซนพาณิชย์ · เริ่มที่ตลาดระดับ 1' : firm && (cell.zone === 'I' || cell.zone === 'F') ? firmGoodsName(city, firm) : cell.zone === 'I' ? 'โรงงาน' : cell.zone === 'F' ? 'ฟาร์มพืชผล' : 'ที่ดินว่าง';
    $('#selection-title').textContent = name + (building ? ' #' + building.id : '') + ' · ' + (cellIndex % SIZE + 1) + ',' + (Math.floor(cellIndex / SIZE) + 1);
    $('#place-subtitle').textContent = building ? 'เฉพาะสถานที่นี้ · ระดับ ' + building.level + ' · อายุ ' + building.age + ' วัน' : 'ข้อมูลเฉพาะแปลงนี้'; symbol(cell.zone, cell.road, !!firm && isMarket(firm));
    const connected = access(city, cellIndex); tags.push(tag(connected ? 'ถนนเชื่อมถึงเมือง' : 'ขาดการเชื่อมต่อ', connected ? 'good' : 'bad'));
    if (firm && (firm.zone === 'F' || firm.zone === 'I')) tags.push(tag(firmGoodsName(city, firm), 'good'));
    if (cell.zone === 'F' && !building) { const crop = cropForFertility(city.resources.fertility[cellIndex]); if (crop) tags.push(tag(`ปลูก${CROP_LABELS[crop]}ได้`, 'good')); }
    if (cell.zone === 'F') {
      const fertility = city.resources.fertility[cellIndex];
      if (!building) metrics.push(metric('ความอุดมสมบูรณ์', `${fertility}%`, false, 'พืชผลหมุนเวียน ไม่ใช่แหล่งที่หมดลง', fertility));
      tags.push(tag(fertility >= 50 ? 'เหมาะสำหรับปลูกพืช' : 'ความอุดมสมบูรณ์ไม่ถึง 50%', fertility >= 50 ? 'good' : 'bad'));
    }
    const parcel = parcelChecklist(city, cellIndex);
    if (parcel) checklist = parcelChecklistView(parcel);
    if (!connected && !parcel) reasons.push('ต้องเชื่อมถนนข้างแปลงกับประตูภายนอกฝั่งตะวันตก');
    if (!utilityAt(city, cellIndex) && !parcel) reasons.push('น้ำหรือไฟในเครือข่ายไม่พอ การผลิตและเติบโตหยุดชั่วคราว สร้างโรงไฟฟ้าหรือโรงสูบน้ำริมถนน');
    if (cell.road) {
      const road = roadFacts(city, cellIndex)!;
      metrics.push(metric('สร้างต่อช่อง', money(5000), true), metric('บำรุงรักษาต่อวัน', money(10), true),
        metric('ระยะถึงประตูเมือง', road.gateway ? 'ประตูเมือง' : road.stepsToGateway === null ? 'ไม่ถึง' : `${road.stepsToGateway} ช่อง`, false, 'นับตามถนนที่ต่อกัน', road.stepsToGateway ?? -1),
        metric('แปลงติดถนนนี้', `${road.frontage} แปลง`, false, `มีอาคาร ${road.buildings} หลัง`, road.frontage),
        metric('ถนนทั้งเมือง', `${road.network} ช่อง`, false, `เชื่อมประตูเมือง ${road.connectedNetwork} ช่อง`, road.network),
        metric('บำรุงทั้งเมือง/วัน', money(road.network * 10), true, 'หักจากเงินคลังทุกวัน', road.network * 10));
      reasons.push(road.gateway ? 'ประตูเมืองฝั่งตะวันตก จุดเชื่อมตลาดและบริการน้ำไฟภายนอก รื้อไม่ได้' : connected ? 'ถนนนี้เชื่อมกับตลาดภายนอก แปลงที่ติดถนนนี้เติบโตได้เมื่อผ่านเงื่อนไขอื่น' : 'ถนนนี้ยังแยกจากตลาดภายนอก ต่อถนนให้ถึงประตูเมืองฝั่งตะวันตกก่อน');
    }
    else if (plant) {
      const u = utilityStatus(city), spec = PLANTS[plant.kind], on = utilities(city).online.has(plant.id), unit = plant.kind === 'power' ? 'ไฟ' : 'น้ำ';
      metrics.push(metric('กำลังผลิต', `${spec.capacity} หน่วย`, false, on ? 'จ่ายเข้าเครือข่ายอยู่' : 'ยังไม่จ่าย'), metric('ค่าบำรุงรายเดือน', money(spec.upkeep), true),
        metric(`ทั้งเมืองใช้${unit}`, `${u.used[plant.kind]}/${u.capacity[plant.kind]} หน่วย`, false, `สร้างวันที่ ${plant.tick}`));
      reasons.push(on ? `จ่าย${unit}ไปตามถนนที่ต่อกัน ถ้าทั้งเมืองไม่พอ อาคารที่ไกลจากประตูเมืองและโรงผลิตที่สุดจะขาดก่อน` : 'ไม่ติดถนนที่เชื่อมประตูเมือง จึงยังไม่จ่าย ต่อถนนข้างแปลงนี้');
    }
    else if (!building && cell.zone) {
      if (cell.zone === 'I' && connected && utilityAt(city, cellIndex)) {
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
  $('#explanation').replaceChildren(...(checklist ? [checklist] : []), ...reasons.map(r=>node('p','reason',r))); $('.explain-section').hidden = !reasons.length && !checklist;
  const selection = route?.page === 'household' ? {kind:'household' as const,id:route.id,sourceBuildingId:route.sourceBuildingId,sourceCell:route.sourceCell} : cellIndex !== null ? {kind:'place' as const,cell:cellIndex} : null;
  renderContext(city, selection, (id, sourceBuildingId, sourceCell) => openRoute({page:'household',id,sourceBuildingId,sourceCell}), ownerFinanceAction);
  if (page === 'city') { renderCityOverview(city); dashboard?.update(city); }
  decoratePanels($('#inspector'));
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
  // Before the pause button is drawn: reaching stage 5 while running pauses for the win screen.
  const goals = cityGoals(city); goalPill?.update(goals); winWatch?.check(city, goals, !paused);
  $('#day').textContent = `วันที่ ${city.tick} · เดือน ${Math.floor(city.tick / 30) + 1}`;
  $('#pause').textContent = paused ? '▶' : 'Ⅱ'; $('#pause').setAttribute('aria-label', paused ? 'เล่นต่อ' : 'หยุดเวลา'); $('#pause').title = paused ? 'เล่นต่อ (Space)' : 'หยุดเวลา (Space)'; $('#pause').setAttribute('aria-pressed', String(paused));
  ($('#pause') as HTMLButtonElement).disabled = ownerDecisionPanel?.isAutoPending() ?? false;
  document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => { b.classList.toggle('active', Number(b.dataset.speed) === speed); b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed)); });
  const demand = node('div', 'demand-grid');
  const history = recordDemand(city, s.demand);
  for (const [zone, label] of [['R', 'บ้าน'], ['C', 'พาณิชย์'], ['I', 'โรงงาน'], ['F', 'ฟาร์ม']] as const) {
    const item = node('div', `demand-item ${zone.toLowerCase()}`); item.append(node('span', '', label), node('b', '', String(s.demand[zone])));
    const spark = demandSparkline(history, zone); if (spark) item.insertAdjacentHTML('beforeend', spark);
    demand.append(item);
  }
  $('#growth-summary').replaceChildren(demand); cityStatsPanel?.update(city); cityNetwork?.update(city); guide?.update(city); minimap?.update(city, selected); renderPlace(); entityExplanationPanel?.sync(); ownerDecisionPanel?.sync();
  if (route?.page === 'city' || route?.page === 'help') renderSubmenus(city, null);
  const start = view.dragStart ?? roadStart; const preview = start === null ? (hover === null ? [] : [hover]) : hover === null ? [start] : roadPath(start, hover);
  const placement = route ? null : previewPlacement(city, tool, start, hover);
  view.render(city, selected, preview, new Set(placement?.cells.filter(cell => !cell.ok).map(cell => cell.cell)));
  updateMapInfo(placement);
  cityHud?.update(city, paused);
}

/** Tool-matched map layer, issue badges and the placement tip; recomputed at most twice a second while time runs. */
function updateMapInfo(placement: Preview | null) {
  if (!mapMarkers) return;
  const enabled = atmosphere?.settings.mapInfo !== false;
  mapMarkers.setVisible(enabled);
  if (!enabled) { view.setOverlay(null); mapMarkers.setLegend(null); mapMarkers.setPreview(null, null); return; }
  mapMarkers.setPreview(placement, hover);
  const mode = route ? undefined : TOOL_OVERLAY[tool], now = performance.now();
  const layout = city.cells.map(cell => (cell.road ? 'r' : cell.zone ?? '.') + (cell.building === null ? '' : 'b')).join('');
  const overlayKey = `${mode}:${layout}`;
  if (overlayKey !== mapInfo.overlayKey || mode && city.tick !== mapInfo.overlayTick && now - mapInfo.overlayAt > 500) {
    const overlay = mode ? mapOverlay(city, mode) : null;
    view.setOverlay(overlay); mapMarkers.setLegend(overlay);
    Object.assign(mapInfo, { overlayKey, overlayTick: city.tick, overlayAt: now });
  }
  if (layout !== mapInfo.issueLayout || city.tick !== mapInfo.issueTick && now - mapInfo.issueAt > 500) {
    mapMarkers.setIssues(buildingIssues(city)); Object.assign(mapInfo, { issueLayout: layout, issueTick: city.tick, issueAt: now });
  }
}

async function boot() {
  setupSubmenus(); setupSubmenuNavigation(cancel);
  $('#signal-entry').hidden = !signalsEnabled();
  signalPanel = createSignalPanel($('#signal-content'), { getCity: () => city, connection: {
    enabled: SIGNAL_ENV.VITE_CITY_ADVISOR_ONLINE !== 'false', endpoint: SIGNAL_ENV.VITE_CITY_ADVISOR_ENDPOINT || 'https://157.85.96.139:5444/api/city-advisor/report'
  } });
  const entityExplanationHost = document.createElement('section');
  entityExplanationHost.id = 'entity-explanation-host';
  $('#entity-content').insertAdjacentElement('afterend', entityExplanationHost);
  const ownerDecisionHost = document.createElement('details');
  $('#city-content').insertBefore(ownerDecisionHost, $('#city-content .ledger-details'));
  // Experimental panels are built the first time the switch is on, and only hidden when it goes off.
  const startAdvanced = () => {
    entityExplanationHost.hidden = ownerDecisionHost.hidden = !advancedOn; $('#signal-entry').hidden = !signalsEnabled();
    if (!advancedOn || entityExplanationPanel) return;
  entityExplanationPanel = createEntityExplanationPanel(entityExplanationHost, {
    getCity: () => city, getSelection: selectedEntity, connection: {
      enabled: SIGNAL_ENV.VITE_CITY_ENTITY_ADVISOR_ONLINE === 'true',
      endpoint: SIGNAL_ENV.VITE_CITY_ADVISOR_ENDPOINT || 'https://157.85.96.139:5444/api/city-advisor/report'
    }
  });
  ownerDecisionPanel = createOwnerDecisionPanel(ownerDecisionHost, {
    getCity: () => city, getSession: () => ownerDecisionSession, onChange: render,
    onTyphoonAutoPending: active => {
      if (active) { pausedByTyphoonAuto = !paused; if (!paused) { paused = true; accumulator = 0; } }
      else if (pausedByTyphoonAuto) { pausedByTyphoonAuto = false; paused = false; accumulator = 0; }
      render();
    },
    connection: {
      enabled: SIGNAL_ENV.VITE_CITY_OWNER_ADVISOR_ONLINE === 'true',
      endpoint: SIGNAL_ENV.VITE_CITY_ADVISOR_ENDPOINT || 'https://157.85.96.139:5444/api/city-advisor/report'
    }
  });
  };
  startAdvanced();
  const advancedButton = $<HTMLButtonElement>('#toggle-advanced');
  const showAdvanced = () => { advancedButton.textContent = advancedOn ? 'ปิดฟีเจอร์ทดลอง' : 'เปิดฟีเจอร์ทดลอง'; advancedButton.setAttribute('aria-pressed', String(advancedOn)); };
  showAdvanced();
  advancedButton.addEventListener('click', () => {
    advancedOn = !advancedOn; storeAdvanced(advancedOn);
    // Switching off never leaves Typhoon driving the city: the owner session drops back to proposals.
    if (!advancedOn) { ownerDecisionSession.reset(city); ownerDecisionPanel?.reset(); if (route?.page === 'signals') inspector(false); }
    startAdvanced(); showAdvanced(); render();
    status(advancedOn ? 'เปิดฟีเจอร์ทดลองแล้ว · สัญญาณเมืองและ Typhoon อยู่ในภาพรวมเมือง คำอธิบาย AI อยู่ในหน้าสถานที่' : 'ปิดฟีเจอร์ทดลองแล้ว');
  });
  $('#open-signals').addEventListener('click', () => { if (signalsEnabled()) openRoute({ page: 'signals' }); });
  view = await CityView.create($('#city-canvas'), activate, index => { if (hover !== index) { hover = index; if (tool === 'F' && !route) { const hint = farmHint(index); $('#tool-help').textContent = hint; status(hint); } render(); } }, (a, b) => {
    ownerDecisionSession.beforeExternal(city);
    selected = b; roadStart = null; status(resultSound(buildRoad(city, a, b), 'ui-road').message);
    ownerDecisionSession.syncExternal(city, 'player-drag-road'); render();
  });
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.addEventListener('click', () => { sound('ui-select'); setTool(b.dataset.tool!); }));
  document.querySelectorAll<HTMLElement>('[data-camera]').forEach(b => b.addEventListener('click', () => view.control(b.dataset.camera!)));
  document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => b.addEventListener('click', () => { sound('ui-click'); speed = Number(b.dataset.speed); accumulator = 0; render(); }));
  $('#pause').addEventListener('click', () => { if (ownerDecisionPanel?.isAutoPending()) return; sound('ui-click'); paused = !paused; accumulator = 0; render(); });
  $('#cancel-tool').addEventListener('click', cancel);
  $('#toggle-camera-pan').addEventListener('click', () => {
    const open = $('.camera-hud').dataset.pan !== 'true';
    $('.camera-hud').dataset.pan = String(open); $('#toggle-camera-pan').setAttribute('aria-expanded', String(open));
  });
  $('#toggle-camera').addEventListener('click', () => {
    const open = $('.camera-hud').dataset.open !== 'true';
    $('.camera-hud').dataset.open = String(open); $('#toggle-camera').setAttribute('aria-expanded', String(open));
  });
  cityStatsPanel = new CityStatsPanel(open => { $('#toggle-stats').setAttribute('aria-expanded', String(open)); if (open) render(); });
  $('#toggle-stats').addEventListener('click', () => cityStatsPanel!.toggle());
  cityNetwork = new CityNetworkView(() => paused, open => { $('#toggle-network').setAttribute('aria-expanded', String(open)); if (open) render(); });
  $('#toggle-network').addEventListener('click', () => cityNetwork!.toggle());
  const networkEntry = document.createElement('button'); networkEntry.type = 'button'; networkEntry.className = 'st-network'; networkEntry.setAttribute('aria-label', 'เครือข่ายเมือง'); networkEntry.append(iconElement('network'), document.createTextNode('เครือข่ายเมือง'));
  networkEntry.addEventListener('click', () => { cityStatsPanel!.toggle(false); cityNetwork!.toggle(true); });
  document.querySelector('#city-stats .st-titlebar .st-close')?.before(networkEntry);
  const mapEntry = document.createElement('button'); mapEntry.type = 'button'; mapEntry.className = 'st-network st-map'; mapEntry.setAttribute('aria-label', 'แผนที่เมือง'); mapEntry.append(iconElement('map'), document.createTextNode('แผนที่'));
  mapEntry.addEventListener('click', () => { cityStatsPanel!.toggle(false); minimap?.toggleMap(true); });
  document.querySelector('#city-stats .st-titlebar .st-close')?.before(mapEntry);
  installHudIcons(); installKeycaps(); installSheetHandle($('#inspector')); guide = new Guide(next => { sound('ui-select'); setTool(next); }, () => { if (paused) $('#pause').click(); });
  if (!STARTER) { guide.offer(); view.focus(GATEWAY + 5); }
  goalPill = new GoalPill(() => { if (route?.page !== 'city') openRoute({page:'city'}); document.getElementById('dash-goals')?.scrollIntoView({ block: 'start' }); });
  winWatch = new WinWatch(() => $('#new-city').click(), () => { paused = true; accumulator = 0; });
  minimap = new Minimap(view, cell => { view.focus(cell); render(); }, cell => { view.focus(cell); openRoute({ page: 'place', cell, buildingId: city.cells[cell].building }); });
  watchPanels(document.querySelector<HTMLElement>('#inspector'), document.querySelector<HTMLElement>('#city-stats'));
  $('#toggle-inspector').addEventListener('click', () => { if (route?.page === 'city') { inspector(false); render(); } else openRoute({page:'city'}); });
  $('#toggle-help').addEventListener('click', () => { if (route?.page === 'help') { inspector(false); render(); } else openRoute({page:'help'}); });
  $('#toggle-game-menu').addEventListener('click', () => { if (route?.page === 'game') { inspector(false); render(); } else openRoute({page:'game'}); });
  $('#close-inspector').addEventListener('click', () => { inspector(false); render(); });
  marketPanel = installMarketPanel(() => city, () => render());
  $('#save').addEventListener('click', () => {
    try { saveStoredCity(localStorage, serialize(city), importedLegacyRaw); sound('ui-save'); status(`บันทึกรุ่น 7 ในเบราว์เซอร์แล้ว · Saved day ${city.tick}`); } catch { sound('ui-error'); status('บันทึกไม่ได้: พื้นที่หรือสำเนากู้คืนไม่พร้อม เซฟเดิมยังอยู่'); }
  });
  const loadStored = (source: SaveSource) => {
    try {
      const saved = readStoredCity(localStorage, source); if (!saved) { status(source === 'backup' ? 'ยังไม่มีสำเนากู้คืนเซฟเดิม' : 'ยังไม่มีเมืองที่บันทึกในช่องนี้'); return; }
      const loaded = deserialize(saved.raw), oldVersion = JSON.parse(saved.raw).version, legacy = oldVersion >= 1 && oldVersion <= 6;
      city = loaded; importedLegacyRaw = legacy ? saved.raw : null;
      ownerDecisionSession.reset(city); ownerDecisionPanel?.reset();
      selected = roadStart = null; if (route?.page === 'place' || route?.page === 'household') inspector(false); paused = true; accumulator = 0; render();
      status(legacy ? `นำเข้า v${oldVersion} วันที่ ${city.tick} แล้ว · ${oldVersion >= 3 ? 'คงทักษะเดิม' : 'ทักษะเดิมสมมติเป็นแรงงานทั่วไป'}${oldVersion === 1 ? ' และสมาชิกเป็นสมมติฐานขั้นต่ำ' : ''} · ${oldVersion >= 4 ? 'คงเงิน สต็อก เจ้าของ และแรงงาน · ไม่แจกทุนขยายกิจการ' : 'เริ่มพืชผลที่ศูนย์ · วางฟาร์มและพาณิชย์ระดับ 1'} · ยังไม่เขียนทับเซฟใด` : `โหลดวันที่ ${city.tick} แล้ว${oldVersion === 7 ? ' · เซฟรุ่น 1.x แปลงเป็นสินค้า 3 สายแล้ว (เก็บสำเนาเดิมไว้ตอนบันทึก)' : ''} · หยุดเวลาให้ตรวจข้อมูล`);
    } catch (error) { status(`โหลดไม่สำเร็จ เมืองปัจจุบันยังอยู่ · ${error instanceof Error ? error.message : 'ข้อมูลบันทึกไม่ถูกต้อง'}`); }
  };
  $('#load').addEventListener('click', () => loadStored('current'));
  $('#load-legacy').addEventListener('click', () => loadStored('legacy'));
  $('#load-v2').addEventListener('click', () => loadStored('household'));
  $('#load-v3').addEventListener('click', () => loadStored('worker'));
  $('#load-v4').addEventListener('click', () => loadStored('agriculture'));
  $('#load-v5').addEventListener('click', () => loadStored('commercial'));
  $('#load-v6').addEventListener('click', () => loadStored('growth'));
  $('#load-backup').addEventListener('click', () => loadStored('backup'));
  $('#new-city').addEventListener('click', () => {
    const dialog = document.createElement('dialog');
    const title = document.createElement('h2'); title.textContent = 'เริ่มเมืองใหม่?';
    const text = document.createElement('p'); text.textContent = 'เมืองที่ยังไม่บันทึกจะถูกแทนที่ เมืองที่เคยบันทึกยังเรียกคืนได้ด้วยปุ่มโหลด';
    const back = document.createElement('button'); back.textContent = 'กลับสู่เมือง'; back.autofocus = true;
    const empty = document.createElement('button'); empty.textContent = 'เริ่มจากที่ว่าง (มีผู้ช่วยสอน)';
    const sample = document.createElement('button'); sample.textContent = 'เมืองตัวอย่าง (มีถนนและโซนให้แล้ว)';
    const restart = (starter: boolean) => {
      city = createCity(61025, { starter }); ownerDecisionSession.reset(city); ownerDecisionPanel?.reset(); importedLegacyRaw = null; selected = roadStart = null; inspector(false); accumulator = 0; paused = true; setTool('select');
      if (starter) guide?.hold(); else { guide?.start(); view.focus(GATEWAY + 5); }
      render(); status(starter ? 'เมืองตัวอย่างพร้อมแล้ว · กดเล่นต่อเพื่อเริ่มเวลา' : 'แผนที่ว่างพร้อมแล้ว · ทำตามผู้ช่วยสอนด้านล่าง'); dialog.close();
    };
    back.onclick = () => dialog.close(); empty.onclick = () => restart(false); sample.onclick = () => restart(true);
    dialog.append(title, text, back, empty, sample); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
  });
  document.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    if (e.key.toLowerCase() === 'u' && !(e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]'))) { audio.change({ muted: !audio.settings.muted }); audioPanel?.sync(); status(audio.settings.muted ? 'ปิดเสียงแล้ว (U)' : 'เปิดเสียงแล้ว (U)'); return; }
    if (route) return;
    if (e.key === ' ' && !(e.target instanceof Element && e.target.closest('button, summary, a, select, input, textarea, [contenteditable]'))) { e.preventDefault(); paused = !paused; accumulator = 0; render(); }
    const shortcuts: Record<string, string> = { v: 'select', r: 'road', '1': 'R', '2': 'C', '3': 'I', '4': 'F', '5': 'power', '6': 'water', b: 'bulldoze', p: 'pan' };
    if (shortcuts[e.key.toLowerCase()]) { sound('ui-select'); setTool(shortcuts[e.key.toLowerCase()]); }
    if (e.key.toLowerCase() === 't') cityStatsPanel?.toggle();
    if (e.key.toLowerCase() === 'm') minimap?.toggleMap();
    if (e.key.toLowerCase() === 'n') cityNetwork?.toggle();
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); view.control(e.key.slice(5).toLowerCase()); }
    if (e.key === 'q') view.control('rotate-left'); if (e.key === 'e') view.control('rotate-right');
  });
  document.addEventListener('visibilitychange', () => { accumulator = 0; });
  inspector(false);
  setTool('select'); status('รับทุนตั้งเมืองแล้ว · ต่อถนนจากประตูสีเหลืองเพื่อขยายเมือง');
  mapMarkers = new MapMarkers(view);
  dashboard = new OverviewDashboard($('#city-dashboard'));
  cityHud = new CityHud((cell, buildingId) => { view.focus(cell); openRoute({ page: 'place', cell, buildingId }); }, () => {
    openRoute({ page: 'city' });
    const issues = document.querySelector<HTMLDetailsElement>('#issue-section'); if (issues) { issues.open = true; issues.scrollIntoView({ block: 'start' }); }
  });
  atmosphere = new AtmosphereController({ view, getCity: () => city, isPaused: () => paused, getSpeed: () => speed, tickFraction: () => accumulator, onChange: () => { mapInfo.overlayKey = mapInfo.issueLayout = ''; render(); } });
  const visual = atmosphere;
  audioPanel = installAudioPanel(audio, $('#atmosphere-menu'));
  // Ambience follows what the screen shows; the city-wide levels only change once a day.
  let soundTick = -1, traffic = 0, factories = 0;
  view.app.on('update', (dt: number) => {
    visual.update(dt);
    minimap?.redraw();
    view.traffic.update(dt, !paused && !document.hidden);
    if (city.tick !== soundTick) {
      soundTick = city.tick;
      traffic = Math.min(1, summary(city).population / 40);
      factories = Math.min(1, new Set(city.cropLedger.filter(e => e.kind === 'process' && e.tick === city.tick).map(e => e.from)).size / 3);
    }
    audio.updateAmbience({ ...visual.soundscape, traffic, factories, closeness: Math.min(1, Math.max(0, (130 - view.radius) / 100)) });
    if (paused || document.hidden) return;
    accumulator += Math.min(dt, 0.25) * speed;
    let changed = false;
    const before = accumulator >= 1 ? cueSnapshot(city) : null;
    while (accumulator >= 1 && !paused) { const outcomes = ownerDecisionSession.advance(city); ownerDecisionPanel?.noteOutcomes(outcomes); accumulator -= 1; changed = true; }
    if (changed && before) for (const cue of cueLimiter.admit(cityCues(before, city), performance.now())) sound(cue);
    if (changed) render();
  });
  // Read-only diagnostics for reproducible QA; no renderer-owned simulation state.
  Object.defineProperty(window, 'cityManager', { value: { snapshot: () => serialize(city), audio: () => audio.diagnostics(), cellScreen: (i: number) => view.project(i), engine: 'PlayCanvas 2.23.3', visuals: () => view.assets?.status ?? { ready: false, loaded: [], failed: [] }, ground: () => view.ground.diagnostics, agriculture: () => view.agricultureDiagnostics(), atmosphere: () => visual.diagnostics } });
  $('#city-canvas').addEventListener('webglcontextlost', () => { paused = true; status('Graphics context lost. Save your city, then reload.'); render(); });
}
boot().catch(error => { console.error(error); status('Could not start WebGL2. Enable hardware graphics and reload in a supported browser.'); });
