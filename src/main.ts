import { installBuildToolbar, BUILD_SHORTCUTS, blocksGameShortcuts } from './build-toolbar.ts';
import { requireServerCityEntry, citySaveMetadata } from './server-city-entry.ts';
import { buildingIssueRevision, issuePlaceRoute } from './building-issues.ts';
import { renderBuildingIssues } from './building-issue-panel.ts';
import './building-issues.css';
import { TrafficLayer, trafficModelEnabled } from './traffic/layer.ts';
import { bindTaxiSessionDepots } from './traffic/game.ts';
import { taxiEnabled } from './taxi/buildings.ts';
import { setTaxiPlayTraffic, sharedTaxiSession } from './taxi/session.ts';
import { SceneTaxiVehicles } from './taxi/scene-vehicles.ts';
import { trafficTaxiPoses } from './taxi/game-visual.ts';
import { trafficGameStatus } from './traffic/game-status.ts';
import { screenCull, storeTrafficModel } from './traffic/flag.ts';
import { busEnabled } from './bus/types.ts';
import { BusPresentation } from './bus/presentation.ts';
import { createAutosave, installAutosave, describeAutosave } from './autosave.ts';
import { roadTopologyKey } from './road-topology.ts';
import { installRoadMenu, type RoadMode } from './road-menu.ts';
import { installSelectMenu } from './select-menu.ts';
import { installServicesMenu, installConstructionMenu } from './grouped-tool-menu.ts';
import './grouped-tool-menu.css';
import './tool-menu.css';
import '@fontsource/ibm-plex-sans-thai/thai-400.css';
import '@fontsource/ibm-plex-sans-thai/thai-600.css';
import '@fontsource/ibm-plex-sans-thai/thai-700.css';
import '@fontsource/ibm-plex-sans-thai/latin-400.css';
import '@fontsource/ibm-plex-sans-thai/latin-600.css';
import '@fontsource/ibm-plex-sans-thai/latin-700.css';
import './style.css';
// Static: a lazy import('./market-panel.css') made Vite emit a CSS preload that failed on Pages.
import './market-panel.css';
import './tokens.css';
import { setupSubmenus, renderSubmenus } from './submenus.ts';
import { setupSubmenuNavigation, closeSubmenus, hasOpenSubmenu } from './submenu-navigation.ts';
import './submenu-layout.css';
import './context-layout.css';
import { renderContext, renderCityOverview, showOwnerFinanceResult } from './context-panels.ts';
import { CityView } from './renderer.ts';
import { createTaxiFareAccumulator } from './taxi/fares.ts';
import { GATEWAY, SIZE, access, utilityAt, utilities, utilityStatus, treasurySpendable, parkStaffingStatus, parkAt, campusAt, buildCampus, buildPark, toggleCampus, upgradeCampus, adoptSavedEducation, plantAt, buildPlant, createCity, buildRoad, zoneCell, bulldoze, summary, serialize, roadPath, buildParallelRoad, editRoadJunction, contributeOwnerCapital, withdrawOwnerProfit, selectFarmCrop, selectFactoryRecipe, isMarket, type City, type Zone } from './sim.ts';
import './compact-layout.css';
import './agriculture-tools.css';
import { PARK, PARK_STAFF } from './parks.ts';
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
import { gatewayRoadDistance } from './road-network.ts';
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
import { CueLimiter, cityCues, cueSnapshot, dayBoundaryReached, monthEnded } from './audio-cues.ts';
import { createOwnerDecisionSession } from './owner-decision-session.ts';
import { createOwnerDecisionPanel } from './owner-decision-panel.ts';
import { installMarketPanel } from './market-panel.ts';
import { installHudRow } from './hud-row.ts';
import { createParkRuntime, advanceParkRuntime, reconcileParkRuntime, serializeParkSession, deserializeParkSession, type ParkRuntime } from './park-runtime.ts';
import { housingLevel } from './housing.ts';
import { parkActivityDiagnostics } from './park-activity.ts';
import { parkRecreationResidentIds } from './park-recreation-activity.ts';
import { renderParkRecreationPanel } from './park-recreation-panel.ts';
import { SceneParkActivity } from './scene-park-activity.ts';
import './park-runtime.css';
import { installEducationPanel } from './education-panel.ts';
import { bulldozeGuarded, type BusRemovalImpact } from './bus/player.ts';
import { confirmBusRemoval } from './bus/panel.ts';
import { createBusController } from './bus/mount.ts';
import { connectPresentedBusEvents, setBusLiveReader } from './bus/live.ts';
import './bus/player.css';
import { installPanelTimeControls } from './panel-time-controls.ts';
import { installSaveFeedback } from './save-feedback-panel.ts';
import { createSaveAttemptQueue } from './save-feedback.ts';
import './player-feedback.css';
import './build-toolbar.css';

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
let city: City;
let parkRuntime: ParkRuntime;
/** Independent, ephemeral traffic-allocation game; never changes economic state or saves. */
let trafficLayer: TrafficLayer | null = null;
/** Bus drawings (`?bus=1`). Still draws nothing until `trafficLayer.bus` exists (traffic on too). */
let busView: BusPresentation | null = null;
let parkScene: SceneParkActivity | undefined;
let parkPanel: HTMLElement;
let ownerDecisionSession: ReturnType<typeof createOwnerDecisionSession>;
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
let roadMode: RoadMode = 'normal', roadMenu: ReturnType<typeof installRoadMenu> | undefined;
let selectMenu: ReturnType<typeof installSelectMenu> | undefined;
let servicesMenu: ReturnType<typeof installServicesMenu> | undefined, constructionMenu: ReturnType<typeof installConstructionMenu> | undefined;
let tool = 'select', selected: number | null = null, roadStart: number | null = null, hover: number | null = null;
let paused = false, speed = 1;
let educationPanel: ReturnType<typeof installEducationPanel> | undefined;
let busController: ReturnType<typeof createBusController> | undefined;
let busLock = false;
let panelTime: ReturnType<typeof installPanelTimeControls> | undefined;
let parkFrameMs = 0, parkFramePeakMs = 0;
let pausedByTyphoonAuto = false;
let trafficOn = false;
let taxiFeature = false;
const taxiSession = sharedTaxiSession();
const taxiFares = createTaxiFareAccumulator();
let taxiView: SceneTaxiVehicles | undefined;
let taxiButton: HTMLButtonElement | undefined;
type Route = { page: 'city' | 'help' | 'game' | 'signals' } | { page: 'place'; cell: number; buildingId: number | null } | { page: 'household'; id: number; sourceBuildingId: number; sourceCell: number };
let route: Route | null = null;
function syncEducationTools() {
  const on = !!city?.education;
  for (const tool of ['school', 'university']) {
    const button = document.querySelector<HTMLElement>(`[data-tool="${tool}"]`);
    if (button) button.hidden = !on;
  }
}
const toolNames: Record<string, string> = { select: 'เลือกสถานที่', road: 'ถนน', R: 'โซนบ้าน', C: 'โซนพาณิชย์', I: 'โซนโรงงาน', F: 'โซนฟาร์ม', power: 'โรงไฟฟ้า', water: 'โรงสูบน้ำ', park: 'สวนสาธารณะ', school: 'โรงเรียน', university: 'มหาวิทยาลัย', bulldoze: 'รื้อถอน', 'bus-depot': 'อู่รถเมล์', 'bus-stop': 'ป้ายรถเมล์', 'bus-line': 'สายรถเมล์' };
const help: Record<string, string> = {
  select: 'ลากเพื่อเลื่อนแผนที่ · แตะสถานที่เพื่อดูข้อมูลและเหตุผลการเติบโต',
  road: 'ถนน ฿50/ช่อง · ลากเส้น หรือแตะจุดเริ่มและจุดจบ · กลับเพื่อยกเลิก',
  R: 'โซนบ้านสร้างที่ว่างก่อน · ครัวเรือนย้ายเข้าเมื่อผ่านความจุ ถนน บริการ และงาน',
  C: 'วางโซนพาณิชย์ · เริ่มเป็นตลาดระดับ 1 · ครัวเรือนลงเงินและแรงงานเอง ซื้อขายพืชผลจริง',
  I: 'วางโรงงานข้างถนนเชื่อมเมือง · โรงงานเพิ่มต้องมีทุนกิจการจริงและพืชผล · ดูเงื่อนไขในภาพรวมเมือง',
  F: 'วางฟาร์มข้างถนน · ปลูกได้ทุกแปลง ดินต่ำให้ผลผลิตเท่าดิน 50% · เลือกพืชหลังสร้าง · ต้องมีแรงงานและผู้ซื้อ',
  power: 'โรงไฟฟ้า ฿5,000 · +40 หน่วย · บำรุง ฿120/เดือน · วางแปลงว่างริมถนน ไฟวิ่งตามถนน อาคารใกล้ได้ก่อน',
  water: 'โรงสูบน้ำ ฿3,000 · +40 หน่วย · บำรุง ฿60/เดือน · วางแปลงว่างริมถนน น้ำวิ่งตามถนน อาคารใกล้ได้ก่อน',
  park: `สวนสาธารณะ ฿${PARK.cost / 100} · เลเวล 1 · 1 ช่อง · ไม่ต้องติดถนน · บำรุง ฿${PARK.upkeep / 100}/เดือน`,
  school: 'โรงเรียน ฿2,000 · 1 ช่องติดถนน · ครูสัญญาภายนอกได้ไม่เกิน 2 คน · ที่เรียนลดเมื่อขาดครู น้ำ ไฟ ถนน หรืองบ',
  university: 'มหาวิทยาลัย ฿4,000 · รับผู้มีวุฒิพื้นฐาน · อาจารย์สัญญาภายนอกได้ 1 คน · ไม่แปลงทักษะอาชีพเป็นวุฒิ',
  bulldoze: 'โหมดรื้อถอน · แตะสวน สถานศึกษา ถนน อาคาร หรือโรงน้ำไฟเพื่อรื้อ ฿20 · ป้ายและอู่รถเมล์จะถามก่อนลบ · ประตูเชื่อมภายนอกรื้อไม่ได้ · ลูกศร/V/Esc เพื่อออก',
  'bus-depot': 'อู่รถเมล์ · แตะแปลงว่างที่ติดถนนเชื่อมประตูเมือง · รอบแรกไม่มีค่าใช้จ่าย',
  'bus-stop': 'ป้ายรถเมล์ · แตะถนนตรงที่ไม่ใช่ทางแยกหรือหัวมุม · ห่างป้ายอื่นอย่างน้อย 2 ช่อง · เลือกฝั่งให้ตรงทิศรถ',
  'bus-line': 'สายรถเมล์ · แตะป้ายตามลำดับ · ป้ายแรกซ้ำเป็นป้ายสุดท้ายคือสายวงกลม · กดสร้างสาย',
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
  return `ฟาร์ม · ความอุดมสมบูรณ์ ${fertility}% · ${access(city, index) ? 'ถนนเชื่อมเมือง' : 'ต้องต่อถนนข้างแปลง'} · ต้องมีแรงงานและผู้ซื้อจริง`;
}
function setTool(next: string) {
  roadMenu?.close();
  selectMenu?.close(); selectMenu?.sync(next);
  servicesMenu?.close(); servicesMenu?.sync(next);
  constructionMenu?.close(); constructionMenu?.sync(next);
  tool = next; roadStart = null; hover = null;
  if (next !== 'select') inspector(false);
  if (view) { view.abortGesture(); view.mode = next === 'road' && (roadMode === 'split') ? 'select' : next; view.dragStart = null; }
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(button => {
    const active = button.dataset.tool === next; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('#tool-help').textContent = next === 'road' ? roadHelp() : help[next] ?? '';
  busController?.sync(next); status(`${toolNames[next] ?? next}พร้อมใช้งาน`); render();
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
  if (selectMenu?.isOpen()) { selectMenu.close(true); return; }
  if (servicesMenu?.isOpen()) { servicesMenu.close(true); return; }
  if (constructionMenu?.isOpen()) { constructionMenu.close(true); return; }
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
  if (busController?.consumeCancel()) { render(); return; }
  if (roadStart !== null) { roadStart = null; status('ยกเลิกจุดเริ่มแล้ว · Road start cancelled'); render(); return; }
  if (tool !== 'select') { setTool('select'); return; }
  inspector(false); status('กลับสู่แผนที่เมือง');
}
function roadHelp() {
  return roadMode === 'split' ? 'ตัดทางเชื่อม · แตะถนน 2 ช่องติดกัน · อาจทำให้ถนนหรือน้ำไฟขาด' : roadMode === 'oneway' ? '2 เลนวันเวย์ ฿50/ช่องใหม่ · ลากตรงตามทิศรถ · ใช้ถนนปกติลากเชื่อมทางแยก' : 'ถนนปกติ ฿50/ช่องใหม่ · ด้านข้างแยกเป็นคู่ขนาน · ลากจากถนนเส้นหนึ่งถึงอีกเส้นเพื่อเชื่อมแยก';
}
function roadCommand(a: number, b: number) {
  if (roadMode === 'split') return editRoadJunction(city, a, b, false);
  return buildParallelRoad(city, a, b, roadMode === 'oneway');
}
async function activate(index: number) {
  if (busLock) return;
  if (tool !== 'select') ownerDecisionSession.beforeExternal(city);
  if (busController?.handles(tool)) { busController.tap(tool as 'bus-depot' | 'bus-stop' | 'bus-line', index); return; }
  selected = index;
  if (tool === 'road') {
    roadMenu?.close();
    if (roadStart === null) { roadStart = index; status(roadMode === 'split' ? 'เลือกถนนแล้ว · แตะถนนช่องที่ติดกันเพื่อแก้ทางเชื่อม' : 'เลือกจุดเริ่มแล้ว · แตะจุดจบ หรือกดกลับ'); }
    else { const result = resultSound(roadCommand(roadStart, index), 'ui-road'); roadStart = null; status(result.message); }
  } else if (['R', 'C', 'I', 'F'].includes(tool)) status(resultSound(zoneCell(city, index, tool as Zone), 'ui-place').message);
  else if (tool === 'power' || tool === 'water') status(resultSound(buildPlant(city, index, tool), 'ui-place').message);
  else if (tool === 'park') status(resultSound(buildPark(city, index), 'ui-place').message);
  else if (tool === 'school' || tool === 'university') status(resultSound(buildCampus(city, index, tool), 'ui-place').message);
  else if (tool === 'bulldoze') {
    busLock = true;
    try {
      const result = await bulldozeGuarded(city, index, busEnabled(), impact => busController?.confirm(impact) ?? Promise.resolve(true), cell => resultSound(bulldoze(city, cell), 'ui-bulldoze'));
      if (!result) { status('ยังไม่รื้อป้ายหรืออู่'); render(); return; }
      status(result.message);
    } finally { busLock = false; }
  }
  else if (tool === 'select') openRoute({page:'place',cell:index,buildingId:city.cells[index].building});
  if (tool !== 'select') ownerDecisionSession.syncExternal(city, 'player-map-command');
  trafficLayer?.afterMapEdit(city, paused || document.hidden);
  render();
}
function publishTaxi(resync = false) {
  if (city) taxiSession.bind(city);
  setTaxiPlayTraffic(trafficOn);
  if (!taxiFeature) { bindTaxiSessionDepots(null); return; }
  bindTaxiSessionDepots(taxiSession.trafficSites(true, trafficOn));
  if (view) view.setTaxiDepots(taxiSession.depots());
  if (resync) trafficLayer?.afterMapEdit(city, paused || document.hidden);
}
function taxiOccupies(cells: readonly number[]) {
  return taxiFeature && cells.some(cell => taxiSession.at(cell));
}
/** Runs before activate so bus can keep the activate lines. Taxi is a no-op while traffic is off. */
function taxiActivate(index: number) {
  if (taxiFeature && tool === 'taxi') {
    status(resultSound(taxiSession.place(city, index, true, trafficOn), 'ui-place').message);
    publishTaxi(true); render(); return;
  }
  if (taxiFeature && tool === 'bulldoze' && taxiSession.at(index)) {
    status(resultSound(taxiSession.removeAt(index), 'ui-bulldoze').message);
    publishTaxi(true); render(); return;
  }
  if (taxiFeature && tool === 'road' && roadStart !== null && taxiOccupies(roadPath(roadStart, index))) {
    roadStart = null; status('มีอู่แท็กซี่ขวางทาง ต้องรื้อก่อนสร้างถนน'); render(); return;
  }
  if (taxiOccupies([index]) && tool !== 'select' && tool !== 'road') { status('มีอู่แท็กซี่อยู่ ต้องรื้อก่อน'); render(); return; }
  activate(index);
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
function symbol(zone: Zone, road: boolean, market = false, park = false) {
  const color = zone === 'R' ? '#87c99b' : zone === 'C' ? '#80b9db' : zone === 'I' ? '#e3a572' : zone === 'F' ? '#badb78' : '#f3c46b';
  const farmShape = '<path d="M10 58h76v22H10z" fill="#755b40"/><path d="M18 62v13m12-13v13m12-13v13m12-13v13m12-13v13m12-13v13" stroke="currentColor" stroke-width="6"/><path d="M18 29h33v28H18z" fill="#d6dfc3"/><path d="m13 29 21-17 22 17" fill="currentColor"/><path d="M62 47V20m0 16c-12 0-14-11-14-11 14-2 14 11 14 11m0-6c12 0 14-11 14-11-14-2-14 11-14 11" stroke="currentColor" stroke-width="4"/>';
  const marketShape = '<path d="M15 33h66v46H15z" fill="#3f5075"/><path d="M10 29h76v17H10z" fill="currentColor"/><path d="M20 18h56l10 11H10z" fill="#d7e9d4"/><path d="M20 46v33m56-33v33M15 64h66" stroke="currentColor" stroke-width="5"/><path d="M27 56h17v8H27zM52 56h15v8H52z" fill="#badb78"/>';
  const shape = park ? '<path d="M12 78h72" stroke="#a5ca85" stroke-width="6"/><path d="M30 65V32" stroke="#79593d" stroke-width="6"/><circle cx="30" cy="31" r="17" fill="#74aa58"/><path d="M55 59h24v9H55zM58 68v10m18-10v10" stroke="#b88757" stroke-width="5"/>' : zone === 'F' && !road ? farmShape : market && !road ? marketShape : road ? '<path d="M35 7h26v82H35z" fill="#7886a2"/><path d="M48 12v15m0 10v15m0 10v15" stroke="#f3c46b" stroke-width="3"/>' : zone === 'R' ? '<path d="M17 44 48 18l31 26v37H17z" fill="currentColor"/><path d="M12 44 48 13l36 31" fill="none" stroke="#d7e9d4" stroke-width="5"/><path d="M41 55h16v26H41zM25 49h10v13H25zM64 49h10v13H64z" fill="#314063"/>' : zone === 'C' ? '<path d="M15 36h66v45H15z" fill="currentColor"/><path d="m12 24 72 0v20H12z" fill="#d7e9d4"/><path d="M25 24v20m22-20v20m23-20v20" stroke="currentColor" stroke-width="12"/><path d="M25 54h23v18H25zM59 54h14v27H59z" fill="#314063"/>' : zone === 'I' ? '<path d="M14 45 35 33v12l22-12v12h25v36H14zM66 14h12v31H66z" fill="currentColor"/><path d="M24 57h11v11H24zM44 57h11v11H44zM64 57h10v11H64z" fill="#314063"/>' : '<path d="M14 44h19v37H14zM39 21h21v60H39zM66 36h16v45H66z" fill="currentColor"/><path d="M45 30h9m-9 12h9m-9 12h9" stroke="#314063" stroke-width="4"/>';
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
function farmCropAction(firmId: number, crop: 'rice' | 'vegetables' | 'sugarcane' | 'auto') {
  const firm = city.firms.find(f => f.id === firmId && f.zone === 'F');
  if (!firm || route?.page !== 'place' || city.cells[route.cell]?.building !== firm.building) return;
  ownerDecisionSession.beforeExternal(city);
  const result = selectFarmCrop(city, firmId, crop);
  if (result.ok) ownerDecisionSession.syncExternal(city, 'manual-farm-crop');
  status(result.message); render();
}
function factoryRecipeAction(firmId: number, recipe: 'rice-mill' | 'cannery' | 'sugar-mill' | 'auto') {
  const firm = city.firms.find(f => f.id === firmId && f.zone === 'I');
  if (!firm || route?.page !== 'place' || city.cells[route.cell]?.building !== firm.building) return;
  ownerDecisionSession.beforeExternal(city);
  const result = selectFactoryRecipe(city, firmId, recipe);
  if (result.ok) ownerDecisionSession.syncExternal(city, 'manual-factory-recipe');
  status(result.message); render();
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
    const plant = plantAt(city, cellIndex), park = parkAt(city, cellIndex), campus = campusAt(city, cellIndex);
    const name = campus ? (campus.kind === 'school' ? 'โรงเรียน' : 'มหาวิทยาลัย') : park ? 'สวนสาธารณะ' : plant ? PLANT_LABELS[plant.kind] : cell.road ? 'ถนน' : cell.zone === 'R' ? 'บ้านพัก' : cell.zone === 'C' ? firm && isMarket(firm) ? 'พาณิชย์ระดับ 1 · ตลาด' : building ? 'พาณิชย์ · ร้านค้าสำเร็จรูป' : 'โซนพาณิชย์ · เริ่มที่ตลาดระดับ 1' : firm && (cell.zone === 'I' || cell.zone === 'F') ? firmGoodsName(city, firm) : cell.zone === 'I' ? 'โรงงาน' : cell.zone === 'F' ? 'ฟาร์มพืชผล' : 'ที่ดินว่าง';
    $('#selection-title').textContent = name + (building ? ' #' + building.id : '') + ' · ' + (cellIndex % SIZE + 1) + ',' + (Math.floor(cellIndex / SIZE) + 1);
    $('#place-subtitle').textContent = building ? 'เฉพาะสถานที่นี้ · ระดับ ' + building.level + ' · อายุ ' + building.age + ' วัน' : 'ข้อมูลเฉพาะแปลงนี้'; symbol(cell.zone, cell.road, !!firm && isMarket(firm), !!park);
    if (building?.zone === 'R') { const tier = housingLevel(building.housingType!, building.level); const label = { cottage: 'บ้าน', apartment: 'อพาร์ตเมนต์', condo: 'คอนโดมิเนียม' }[tier.type]; $('#selection-title').textContent = `${label} #${building.id} · ${cellIndex % SIZE + 1},${Math.floor(cellIndex / SIZE) + 1}`; $('#place-subtitle').textContent = `${label} ระดับ ${tier.tierLevel} · อายุ ${building.age} วัน · พื้นที่ 1 ช่อง`; }
    if (park) $('#place-subtitle').textContent = `สวนเทศบาล #${park.id} · เลเวล ${park.level} · 1 ช่อง`;
    if (campus) $('#place-subtitle').textContent = `${campus.kind === 'school' ? 'โรงเรียน' : 'มหาวิทยาลัย'} #${campus.id} · ระดับ ${campus.level} · ${campus.open ? 'เปิดบริการ' : 'พักบริการ'}`;
    const busCaption = busController?.caption(cellIndex); if (busCaption) $('#place-subtitle').textContent = busCaption;
    const connected = access(city, cellIndex); if (park) tags.push(tag('ไม่ต้องติดถนน', 'good')); else tags.push(tag(connected ? 'ถนนเชื่อมถึงเมือง' : 'ขาดการเชื่อมต่อ', connected ? 'good' : 'bad'));
    if (firm && (firm.zone === 'F' || firm.zone === 'I')) tags.push(tag(firmGoodsName(city, firm), 'good'));
    if (cell.zone === 'F' && !building) tags.push(tag('เลือกพืชได้หลังสร้างฟาร์ม', 'good'));
    if (cell.zone === 'F') {
      const fertility = city.resources.fertility[cellIndex];
      if (!building) metrics.push(metric('ความอุดมสมบูรณ์', `${fertility}%`, false, 'พืชผลหมุนเวียน ไม่ใช่แหล่งที่หมดลง', fertility));
      tags.push(tag('เลือกชนิดพืชได้เอง', 'good'));
    }
    if (!cell.road && !park) {
      const distance = gatewayRoadDistance(city, cellIndex);
      if (distance !== null) reasons.push(`ระยะจากประตูเมืองผ่านถนน ${distance} ช่อง รวมทางเข้าแปลง (ไม่ใช่เวลาเดินทาง)`);
    }
    const parcel = parcelChecklist(city, cellIndex);
    if (parcel) checklist = parcelChecklistView(parcel);
    if (!park && !connected && !parcel) reasons.push('ต้องเชื่อมถนนข้างแปลงกับประตูภายนอกฝั่งตะวันตก');
    if (!park && !utilityAt(city, cellIndex) && !parcel) reasons.push('น้ำหรือไฟในเครือข่ายไม่พอ การผลิตและเติบโตหยุดชั่วคราว สร้างโรงไฟฟ้าหรือโรงสูบน้ำริมถนน');
    if (cell.road) {
      const road = roadFacts(city, cellIndex)!;
      metrics.push(metric('สร้างต่อช่อง', money(5000), true), metric('บำรุงรักษาต่อวัน', money(10), true),
        metric('ระยะถึงประตูเมือง', road.gateway ? 'ประตูเมือง' : road.stepsToGateway === null ? 'ไม่ถึง' : `${road.stepsToGateway} ช่อง`, false, 'นับตามถนนที่ต่อกัน', road.stepsToGateway ?? -1),
        metric('แปลงติดถนนนี้', `${road.frontage} แปลง`, false, `มีอาคาร ${road.buildings} หลัง`, road.frontage),
        metric('ถนนทั้งเมือง', `${road.network} ช่อง`, false, `เชื่อมประตูเมือง ${road.connectedNetwork} ช่อง`, road.network),
        metric('บำรุงทั้งเมือง/วัน', money(road.network * 10), true, 'หักจากเงินคลังทุกวัน', road.network * 10));
      reasons.push(road.gateway ? 'ประตูเมืองฝั่งตะวันตก จุดเชื่อมตลาดและบริการน้ำไฟภายนอก รื้อไม่ได้' : connected ? 'ถนนนี้เชื่อมกับตลาดภายนอก แปลงที่ติดถนนนี้เติบโตได้เมื่อผ่านเงื่อนไขอื่น' : 'ถนนนี้ยังแยกจากตลาดภายนอก ต่อถนนให้ถึงประตูเมืองฝั่งตะวันตกก่อน');
    }
    else if (campus) {
      const report = campus.report;
      metrics.push(
        metric('ระดับ', String(campus.level), false, 'ขยายได้ถึงระดับ 2 บนแปลงเดิม'),
        metric('ที่เรียน', `${report.operatingSeats} / ${report.nominalSeats}`, false, 'จำนวนที่ใช้ได้หลังหักครู น้ำ ไฟ ถนน และงบ'),
        metric('ผู้เรียน', `${report.enrolled} คน`, false, `ความก้าวหน้าวันนี้ ${report.progressing} คน`),
        metric('บุคลากรในเมือง', `${report.localStaff} / ${report.requiredStaff}`, false, report.contract ? 'มีบุคลากรสัญญาจากภายนอก' : 'ไม่มีสัญญาภายนอก'),
        metric('เหตุผลที่ยังไม่เต็ม', report.reasons.join(' · ') || 'ให้บริการตามกำลัง', false));
      reasons.push('ผู้เรียนเป็นจำนวนคนในครัวเรือน ไม่ใช่รายชื่อรายบุคคล', 'ปิดบริการหรือขาดน้ำไฟหยุดความก้าวหน้า แต่ไม่ลบวุฒิที่ได้แล้ว');
    }
    else if (park) {
      const staff = parkStaffingStatus(city, park);
      metrics.push(metric('เจ้าหน้าที่สวน', `${staff.employed} / ${staff.slots} คน`, false, `ว่าง ${staff.vacancies} · ${staff.status === 'staffed' ? 'มีเจ้าหน้าที่' : staff.status === 'recruiting' ? 'รอจัดสรรวันถัดไป' : staff.status === 'no-applicants' ? 'ไม่มีผู้สมัครว่าง' : 'งบค่าจ้างไม่พอ'}`),
        metric('กำลังดูแลตามเจ้าหน้าที่', `${staff.staffedCapacity * 100}%`, false, 'ไม่ต้องมีถนน · ยังไม่มีรัศมีบริการ'),
        metric('ค่าจ้างเมื่อครบอัตรา/เดือน', money(PARK_STAFF.slots * PARK_STAFF.monthlyWage), true, 'แยกจากค่าบำรุง · จ่ายเข้าครัวเรือนตามวันทำงาน'),
        metric('ค่าจ้างสะสมที่กันไว้', money(staff.earnedWages), true, `คลังใช้จ่ายได้ ${money(treasurySpendable(city))}`));
      const lastDue = Math.floor(city.tick / 30) * 30, billed = city.ledger.find(e => e.reason === `Monthly park upkeep #${park.id}` && e.tick === lastDue);
      metrics.push(metric('ค่าก่อสร้าง', money(PARK.cost), true), metric('ค่าบำรุงรายเดือน', money(PARK.upkeep), true),
        metric('พื้นที่', '1 ช่อง', false, `สร้างวันที่ ${park.tick} · เลเวล ${park.level}`));
      if (lastDue > park.tick) metrics.push(metric('จ่ายบำรุงเดือนล่าสุด', money(billed?.amount ?? 0), true, billed?.amount === PARK.upkeep ? 'จ่ายครบจากคลังเมือง' : 'เงินคลังไม่พอจ่ายครบ ไม่มีการกู้หรือหักซ้ำ'));
      reasons.push('สร้างและดูแลได้โดยไม่ต้องติดถนนหรือต่อเครือข่ายน้ำไฟ', 'ประชาชนเดินมาพักผ่อนจริง · สวนที่มีเจ้าหน้าที่ให้ความพึงพอใจตามเวลาพักผ่อนและความแออัด · ดูคะแนนในภาพรวมเมือง', 'ไม่มีโบนัสภาษี ผลผลิต มูลค่าที่ดิน หรือการย้ายเข้า');
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
  const selectedCampus = cellIndex === null ? undefined : campusAt(city, cellIndex);
  $('#campus-actions').hidden = !selectedCampus;
  educationPanel?.update(city, selectedCampus);
  $('#explanation').replaceChildren(...(checklist ? [checklist] : []), ...reasons.map(r=>node('p','reason',r))); $('.explain-section').hidden = !reasons.length && !checklist;
  const selection = route?.page === 'household' ? {kind:'household' as const,id:route.id,sourceBuildingId:route.sourceBuildingId,sourceCell:route.sourceCell} : cellIndex !== null ? {kind:'place' as const,cell:cellIndex} : null;
  renderContext(city, selection, (id, sourceBuildingId, sourceCell) => openRoute({page:'household',id,sourceBuildingId,sourceCell}), ownerFinanceAction, farmCropAction, factoryRecipeAction);
  let issueHost = document.getElementById('building-issue-details');
  if (!issueHost) { issueHost = document.createElement('section'); issueHost.id = 'building-issue-details'; $('#entity-content').after(issueHost); }
  renderBuildingIssues(city, route?.page === 'place' ? cellIndex : null, issueHost);
  if (page === 'city') { renderCityOverview(city); renderEducationOverview(); dashboard?.update(city); renderParkPanel(); }
  decoratePanels($('#inspector'));
}
function validateRoute() {
  const current = route;
  if (current?.page === 'place' && current.buildingId !== null && city.cells[current.cell]?.building !== current.buildingId || current?.page === 'household' && (!city.households.some(h=>h.id===current.id) || city.cells[current.sourceCell]?.building !== current.sourceBuildingId)) {
    inspector(false); status('สถานที่หรือครัวเรือนนี้ไม่มีอยู่แล้ว เลือกใหม่บนแผนที่');
  }
}

let parkPanelState: ParkRuntime['recreation'] | undefined, parkPanelRoster = '', parkPanelAt = 0;
function renderParkPanel(force = false) {
  if (!parkPanel) return;
  if (!force && !paused && performance.now() - parkPanelAt < 250) return;
  const ids = parkRecreationResidentIds(city), roster = ids.join(',');
  if (parkPanelState === parkRuntime.recreation && parkPanelRoster === roster) return;
  parkPanelState = parkRuntime.recreation; parkPanelRoster = roster; parkPanelAt = performance.now();
  renderParkRecreationPanel(parkPanel, parkRuntime.recreation, ids);
}
function renderEducationOverview() {
  const host = document.getElementById('education-overview'); if (!host) return;
  const education = city.education;
  host.hidden = !education;
  if (!education) return;
  const seats = education.campuses.reduce((sum, campus) => sum + campus.report.nominalSeats, 0);
  const openSeats = education.campuses.reduce((sum, campus) => sum + campus.report.operatingSeats, 0);
  const enrolled = education.campuses.reduce((sum, campus) => sum + campus.report.enrolled, 0);
  const shortTeachers = education.campuses.filter(campus => campus.open && campus.report.localStaff + campus.report.contract < campus.report.requiredStaff).length;
  host.replaceChildren(node('h3', '', 'การศึกษา'), node('p', 'reason', `ที่เรียนที่ใช้ได้ ${openSeats}/${seats} · ผู้เรียน ${enrolled} · ถือวุฒิพื้นฐาน ${education.residentBasic} · ถือวุฒิขั้นสูง ${education.residentHigher} · จบสะสม ${education.completed.basic}/${education.completed.higher} · โรงเรียนพร้อม ${education.schoolReadyDays} วัน · มหาวิทยาลัยพร้อม ${education.universityReadyDays} วัน · สถานศึกษาที่ขาดครู ${shortTeachers}`));
}
function render() {
  if (!view) return;
  reconcileParkRuntime(city, parkRuntime);
  parkScene?.setQuality(atmosphere?.diagnostics.quality ?? 'medium');
  parkScene?.sync(parkRuntime.activity);
  signalPanel?.sync();
  validateRoute(); const s = summary(city);
  // Before the pause button is drawn: reaching stage 5 while running pauses for the win screen.
  const goals = cityGoals(city, s); goalPill?.update(goals); winWatch?.check(city, goals, !paused);
  $('#day').textContent = `วันที่ ${city.tick} · เดือน ${Math.floor(city.tick / 30) + 1}`;
  $('#pause').textContent = paused ? '▶' : 'Ⅱ'; $('#pause').setAttribute('aria-label', paused ? 'เล่นต่อ' : 'หยุดเวลา'); $('#pause').title = paused ? 'เล่นต่อ (Space)' : 'หยุดเวลา (Space)'; $('#pause').setAttribute('aria-pressed', String(paused));
  ($('#pause') as HTMLButtonElement).disabled = ownerDecisionPanel?.isAutoPending() ?? false;
  panelTime?.update(paused, speed, ($('#pause') as HTMLButtonElement).disabled);
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
  const busPreview = route ? null : busController?.preview(tool, hover) ?? null;
  const placement = busPreview ?? (route ? null : previewPlacement(city, tool, start, hover));
  const frames = busPreview ? busPreview.cells.map(cell => cell.cell) : preview;
  view.render(city, selected, frames, new Set(placement?.cells.filter(cell => !cell.ok).map(cell => cell.cell)));
  busController?.refresh();
  updateMapInfo(placement);
  cityHud?.update(city, paused, s);
}

/** Tool overlays are throttled; issue facts refresh only on meaningful city/context revisions, not camera frames. */
function syncTaxiInspector() {
  const box = document.getElementById('taxi-actions');
  if (!taxiFeature || !box) return;
  const cell = route?.page === 'place' ? route.cell : null;
  const depot = cell === null ? undefined : taxiSession.at(cell);
  box.hidden = !depot;
  if (!depot || cell === null) return;
  $('#selection-title').textContent = `อู่แท็กซี่ #${depot.id} · ${cell % SIZE + 1},${Math.floor(cell / SIZE) + 1}`;
  $('#place-subtitle').textContent = `ระดับ ${depot.level} · ${depot.level === 1 ? 4 : 8} คัน · ${depot.open ? 'เปิดบริการ' : 'ปิดบริการ'}`;
  view?.setTaxiDepots(taxiSession.depots());
}
function updateMapInfo(placement: Preview | null) {
  syncTaxiInspector();
  if (!mapMarkers) return;
  const enabled = atmosphere?.settings.mapInfo !== false;
  mapMarkers.setVisible(enabled);
  if (!enabled) { view.setOverlay(null); mapMarkers.setLegend(null); mapMarkers.setPreview(null, null); return; }
  mapMarkers.setPreview(placement, hover);
  const mode = route ? undefined : TOOL_OVERLAY[tool], now = performance.now();
  const layout = city.cells.map(cell => (cell.road ? 'r' : cell.zone ?? '.') + (cell.building === null ? '' : 'b')).join('') + roadTopologyKey(city);
  const overlayKey = `${mode}:${layout}`;
  if (overlayKey !== mapInfo.overlayKey || mode && city.tick !== mapInfo.overlayTick && now - mapInfo.overlayAt > 500) {
    const overlay = mode ? mapOverlay(city, mode) : null;
    view.setOverlay(overlay); mapMarkers.setLegend(overlay);
    Object.assign(mapInfo, { overlayKey, overlayTick: city.tick, overlayAt: now });
  }
  const issueRevision = buildingIssueRevision(city);
  if (issueRevision !== mapInfo.issueLayout) {
    mapMarkers.setIssues(buildingIssues(city), [...city.buildings, ...city.plants, ...city.parks, ...(city.education?.campuses ?? [])].map(place => place.cell));
    Object.assign(mapInfo, { issueLayout: issueRevision, issueTick: city.tick, issueAt: now });
  }
}

async function boot() {
  const serverEntry=await requireServerCityEntry(()=>{const fresh=createCity(61025,{starter:STARTER});return serializeParkSession(fresh,createParkRuntime(fresh));},(import.meta as ImportMeta & {env:Record<string,string|undefined>}).env.VITE_CITY_SAVE_URL);
  const serverSave=serverEntry.client;
  const restored=deserializeParkSession(serverEntry.raw);
  city=restored.city;parkRuntime=restored.runtime;taxiSession.bind(city);
  if(!city.education)adoptSavedEducation(city);
  syncEducationTools();paused=true;
  let cityGeneration=0,saveBusy=false,resolvingConflict=false;
  const previewOnly=false,recoveryOnly=false;
  ownerDecisionSession = createOwnerDecisionSession(city);
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
  const parkSection = document.createElement('section'); parkSection.id = 'park-recreation';
  const citizenSpeed = document.createElement('button'); citizenSpeed.type = 'button';
  citizenSpeed.dataset.speed = String(1 / 1440); citizenSpeed.setAttribute('aria-pressed', 'false');
  citizenSpeed.textContent = 'ดูชีวิตประชาชน · 1 นาทีเกม/วินาที';
  citizenSpeed.title = 'ชะลอทั้งเมืองเพื่อดูการเดินและพักผ่อน · 1 วันเกมใช้ 24 นาที · กลับความเร็วเดิมด้วย 1×';
  parkPanel = document.createElement('div'); parkPanel.id = 'park-recreation-data';
  parkSection.append(citizenSpeed, parkPanel); $('#city-content').insertBefore(parkSection, ownerDecisionHost);
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
      if (active) { pausedByTyphoonAuto = !paused; if (!paused) { paused = true; } }
      else if (pausedByTyphoonAuto) { pausedByTyphoonAuto = false; paused = false; }
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
  taxiFeature = taxiEnabled();
  if (taxiFeature) { toolNames.taxi = 'อู่แท็กซี่'; help.taxi = 'อู่แท็กซี่ · แปลงว่างติดถนน · ไม่มีค่าก่อสร้าง · รถแท็กซี่รับเที่ยวตามความหนาแน่นเมื่อเปิดการจราจรจำลอง · รอบนี้ยังไม่ลงเซฟ'; }
  view = await CityView.create($('#city-canvas'), taxiActivate, index => { if (hover !== index) { hover = index; if (tool === 'F' && !route) { const hint = farmHint(index); $('#tool-help').textContent = hint; status(hint); } render(); } }, (a, b) => {
    const path = roadPath(a, b);
    if (taxiOccupies(path)) { status('มีอู่แท็กซี่ขวางทาง ต้องรื้อก่อนสร้างถนน'); render(); return; }
    ownerDecisionSession.beforeExternal(city);
    selected = b; roadStart = null; status(resultSound(roadCommand(a, b), 'ui-road').message);
    ownerDecisionSession.syncExternal(city, 'player-drag-road'); trafficLayer?.afterMapEdit(city, paused || document.hidden); render();
  });
  parkScene = new SceneParkActivity(view);
  view.traffic.setWalkersEnabled(false);
  let trafficEnabled=trafficModelEnabled();
  const trafficSection=document.createElement('section');trafficSection.id='traffic-game-status';trafficSection.className='growth-section';
  const trafficTitle=document.createElement('h3');trafficTitle.textContent='การจราจรจำลอง';
  const trafficInfo=document.createElement('p');trafficInfo.textContent='กำลังเตรียมแบบจำลอง';trafficInfo.setAttribute('role','status');
  const trafficNote=document.createElement('small');trafficNote.textContent='รถและคิวเป็นตัวแทนเพื่อวางแผนถนน แสดงรถสูงสุด 64 คันจากแบบจำลองสูงสุด 128 คัน บางช่วงถนนอาจไม่แสดงรถแม้แบบจำลองมีรถอยู่ ไม่ใช่การเดินทางหรือการส่งสินค้าจริง และไม่เปลี่ยนเศรษฐกิจหรือเซฟ';
  const trafficFocus=document.createElement('button');trafficFocus.id='traffic-game-focus';trafficFocus.type='button';trafficFocus.textContent='ไปดูจุดรถติด';trafficFocus.hidden=true;
  let bottleneckCell:number|null=null;trafficFocus.addEventListener('click',()=>{if(bottleneckCell!==null){view.focus(bottleneckCell);inspector(false);render();}});
  trafficSection.append(trafficTitle,trafficInfo,trafficFocus,trafficNote);$('#growth-anchor').insertAdjacentElement('beforebegin',trafficSection);
  const trafficControl=document.createElement('section');trafficControl.className='save-group';
  const trafficControlTitle=document.createElement('h4');trafficControlTitle.textContent='การจราจรจำลอง';
  const trafficButton=document.createElement('button');trafficButton.id='traffic-game-toggle';trafficButton.type='button';
  const trafficControlNote=document.createElement('small');trafficControlNote.textContent='ปิดหรือเปิดแบบจำลองได้ รถจำลองเริ่มใหม่เมื่อโหลดเมือง';
  trafficControl.append(trafficControlTitle,trafficButton,trafficControlNote);$('#game-content .game-menu').prepend(trafficControl);
  const setTrafficEnabled=(enabled:boolean,persist=false)=>{
    trafficEnabled=enabled;trafficOn=enabled;trafficLayer?.destroy();trafficLayer=null;view.traffic.setCarsEnabled(!enabled);
    if(enabled){try{const canvas=$('#city-canvas') as HTMLCanvasElement;trafficLayer=new TrafficLayer(view.app,screenCull(i=>view.project(i),()=>({width:canvas.clientWidth,height:canvas.clientHeight})),()=>{view.traffic.setCarsEnabled(true);status('แบบจำลองจราจรไม่พร้อม · กลับไปใช้รถตกแต่ง โดยไม่กระทบเซฟ');});}catch{view.traffic.setCarsEnabled(true);trafficInfo.textContent='แบบจำลองไม่พร้อม · แสดงรถตกแต่งแทน';}}
    trafficButton.textContent=enabled?'ปิดการจราจรจำลอง':'เปิดการจราจรจำลอง';trafficButton.setAttribute('aria-pressed',String(enabled));
    trafficSection.hidden=!enabled;
    if(persist){const saved=storeTrafficModel(enabled);try{const u=new URL(location.href);u.searchParams.delete('traffic');history.replaceState(history.state,'',u);}catch{/* preference still applies */}
      status(saved?(enabled?'เปิดการจราจรจำลองแล้ว':'ปิดการจราจรจำลองแล้ว'):'เปลี่ยนเฉพาะรอบนี้: เบราว์เซอร์ไม่อนุญาตให้จำการตั้งค่า');}
    if (taxiFeature && !taxiButton) {
      taxiButton = document.createElement('button');
      taxiButton.type = 'button'; taxiButton.dataset.tool = 'taxi'; taxiButton.className = 'tool'; taxiButton.title = 'อู่แท็กซี่';
      taxiButton.innerHTML = '<span class="tool-icon" aria-hidden="true">🚕</span><span>แท็กซี่</span>';
      document.querySelector<HTMLElement>('[data-tool="university"]')?.after(taxiButton);
      taxiButton.addEventListener('click', () => { sound('ui-select'); setTool('taxi'); });
      const actions = document.createElement('div'); actions.id = 'taxi-actions'; actions.hidden = true; actions.className = 'save-controls';
      const act = (label: string, run: (id: number) => { ok: boolean; message: string }) => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', () => {
          const cell = route?.page === 'place' ? route.cell : null; const depot = cell === null ? undefined : taxiSession.at(cell); if (!depot) return;
          status(run(depot.id).message); publishTaxi(true); render();
        });
        actions.append(button);
      };
      act('ขยายอู่เป็น 8 คัน', id => taxiSession.upgrade(id));
      act('เปิดหรือปิดบริการ', id => taxiSession.toggle(id));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'รื้ออู่';
      remove.addEventListener('click', () => {
        const cell = route?.page === 'place' ? route.cell : null; if (cell === null || !taxiSession.at(cell)) return;
        status(resultSound(taxiSession.removeAt(cell), 'ui-bulldoze').message); publishTaxi(true); render();
      });
      actions.append(remove);
      document.getElementById('campus-actions')?.after(actions);
    }
    publishTaxi(true);
  };
  trafficButton.addEventListener('click',()=>setTrafficEnabled(!trafficEnabled,true));setTrafficEnabled(trafficEnabled);
  document.addEventListener('visibilitychange',()=>trafficLayer?.pageVisibilityChanged(document.hidden));
  let trafficText='';
  if (busEnabled()) busView = new BusPresentation(view.app);
  const roadButton = document.querySelector<HTMLButtonElement>('[data-tool="road"]')!;
  roadMenu = installRoadMenu(roadButton, mode => { roadMode = mode; setTool('road'); status(roadHelp()); });
  const selectButton = document.querySelector<HTMLButtonElement>('[data-tool="select"]')!;
  selectMenu = installSelectMenu(selectButton, next => { sound('ui-select'); setTool(next); });
  servicesMenu = installServicesMenu(next => { sound('ui-select'); setTool(next); });
  constructionMenu = installConstructionMenu(next => { sound('ui-select'); setTool(next); });
  const busComposer = document.createElement('div'); busComposer.id = 'bus-composer'; busComposer.hidden = true;
  $('#tool-help').before(busComposer);
  const busPanel = document.createElement('section'); busPanel.id = 'bus-panel'; busPanel.hidden = true; busPanel.setAttribute('aria-label', 'จัดการสายรถเมล์');
  document.body.append(busPanel);
  const confirmRemoval = async (impact: BusRemovalImpact) => {
    const wasPaused = paused; paused = true; render();
    try { return await confirmBusRemoval(impact); }
    finally { if (!wasPaused) paused = false; }
  };
  busController = createBusController({
    anchor: $<HTMLButtonElement>('#bus-tool'), composer: busComposer, panel: busPanel, help: $('#tool-help'),
    enabled: () => busEnabled(), getCity: () => city, getTool: () => tool, getHover: () => hover, setTool,
    beforeChange: () => ownerDecisionSession.beforeExternal(city),
    notice: ({ ok, message, mutated }) => {
      status(message); sound(ok ? 'ui-place' : 'ui-error');
      if (mutated) { ownerDecisionSession.syncExternal(city, 'player-map-command'); trafficLayer?.afterMapEdit(city); }
      render();
    },
    focusCell: cell => { view.focus(cell); render(); },
    confirm: confirmRemoval,
  });
  busController.sync(tool);
  // Engine exists only when the traffic model and ?bus=1 are both on (PR #132). Never drain it.
  setBusLiveReader(() => trafficLayer?.bus?.engine ?? null);
  void connectPresentedBusEvents();
  document.querySelectorAll<HTMLElement>('.tool-buttons [data-tool]').forEach(b => {
    if (b === selectButton) return; // Select's popup owns its arrow and explicit demolition option.
    b.addEventListener('click', () => { const reopen = b === roadButton && !roadMenu?.isOpen(); sound('ui-select'); setTool(b.dataset.tool!); if (reopen) roadMenu?.open(roadMode); });
  });
  document.querySelectorAll<HTMLElement>('[data-camera]').forEach(b => b.addEventListener('click', () => view.control(b.dataset.camera!)));
  document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => b.addEventListener('click', () => { sound('ui-click'); speed = Number(b.dataset.speed); render(); }));
  $('#pause').addEventListener('click', () => { if (ownerDecisionPanel?.isAutoPending()) return; sound('ui-click'); paused = !paused; render(); });
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
  installHudIcons(); installKeycaps(); installBuildToolbar(); installSheetHandle($('#inspector')); guide = new Guide(next => { sound('ui-select'); setTool(next); }, () => { if (paused) $('#pause').click(); });
  educationPanel = installEducationPanel($('#campus-actions'));
  panelTime = installPanelTimeControls($('#inspector .inspector-heading'), $('#pause'));
  if (!STARTER && city.tick===0) { guide.offer(); view.focus(GATEWAY + 5); }
  goalPill = new GoalPill(() => { if (route?.page !== 'city') openRoute({page:'city'}); document.getElementById('dash-goals')?.scrollIntoView({ block: 'start' }); });
  winWatch = new WinWatch(() => $('#new-city').click(), () => { paused = true; });
  minimap = new Minimap(view, cell => { view.focus(cell); render(); }, cell => { view.focus(cell); openRoute({ page: 'place', cell, buildingId: city.cells[cell].building }); });
  watchPanels(document.querySelector<HTMLElement>('#inspector'), document.querySelector<HTMLElement>('#city-stats'));
  $('#toggle-inspector').addEventListener('click', () => { if (route?.page === 'city') { inspector(false); render(); } else openRoute({page:'city'}); });
  $('#toggle-help').addEventListener('click', () => { if (route?.page === 'help') { inspector(false); render(); } else openRoute({page:'help'}); });
  $('#toggle-game-menu').addEventListener('click', () => { if (route?.page === 'game') { inspector(false); render(); } else openRoute({page:'game'}); });
  $('#close-inspector').addEventListener('click', () => { inspector(false); render(); });
  // Trading remains disabled. Its synchronous financial callback must never pretend to await a server save.
  marketPanel = installMarketPanel(() => city, () => render(), () => { throw Error('market-disabled-server-save-required'); }, () => serializeParkSession(city, parkRuntime,city.market));
  marketPanel.client.setRecoveryReadOnly(true);
  installHudRow();
  const saveBadge=document.createElement('span');saveBadge.id='autosave-status';saveBadge.setAttribute('role','status');$('#save').insertAdjacentElement('afterend',saveBadge);
  const saveFeedback=installSaveFeedback(saveBadge,()=>document.querySelector<HTMLButtonElement>('#export-city-save')?.click(),()=> 'บันทึกบนเซิร์ฟเวอร์แล้ว');
  const enqueueSave=createSaveAttemptQueue();
  const trackedSave=(explicit=false)=>{
    const captured=city,generation=cityGeneration;
    // Start popup synchronously from the Save gesture if the memory token expired.
    const authenticated=explicit?serverEntry.auth.connect():Promise.resolve();
    void authenticated.catch(()=>{});
    return enqueueSave(async()=>{
      if(captured!==city||generation!==cityGeneration)throw Error('เมืองเปลี่ยนระหว่างรอบันทึก');
      const attempt=saveFeedback.begin();saveBusy=true;
      try{
        await authenticated;
        if(serverSave.pending)await serverSave.retry();
        const raw=serializeParkSession(captured,parkRuntime,captured.market);
        await serverSave.save(raw,citySaveMetadata(raw));
        if(captured!==city||generation!==cityGeneration){saveFeedback.cancel(attempt);throw Error('เมืองเปลี่ยนระหว่างบันทึก');}
        saveFeedback.succeeded(attempt);
      }catch(error){paused=true;saveFeedback.failed(`${error instanceof Error?error.message:'เชื่อมต่อไม่ได้'} · การเปลี่ยนแปลงยังไม่ยืนยันบนเซิร์ฟเวอร์ ไม่มีสำเนาในเบราว์เซอร์ กรุณาอย่าปิดหน้านี้`,attempt);throw error;}
      finally{saveBusy=false;}
    });
  };
  const autosave=createAutosave({canSave:()=>!resolvingConflict&&!serverSave.conflict,save:()=>trackedSave(),tick:()=>city.tick,revision:()=>serializeParkSession(city,parkRuntime,city.market),onResult:r=>{if(!r.ok){sound('ui-error');status(describeAutosave(r));}}});
  autosave.adoptLoaded();installAutosave(document,window,autosave,()=>document.hidden);
  if(serverEntry.migrationIssues.length){const warning=document.createElement('p');warning.id='city-migration-warning';warning.setAttribute('role','status');warning.textContent=`เปิดเมืองหลักจากเซิร์ฟเวอร์แล้ว แต่ยังย้ายเซฟเก่าไม่ครบ: ${serverEntry.migrationIssues.join(', ')} · ข้อมูลเก่ายังอยู่ ไม่ถูกลบ`;$('#save').insertAdjacentElement('afterend',warning);}
  window.addEventListener('beforeunload',event=>{if(saveBusy||serverSave.pending||serializeParkSession(city,parkRuntime,city.market)!==serverSave.confirmed?.raw){event.preventDefault();event.returnValue='';}});
  $('#save').addEventListener('click',async()=>{
    if(saveBusy)return;
    try{
      if(serverSave.conflict||resolvingConflict){
        paused=true;
        if(!window.confirm('เซฟบนเซิร์ฟเวอร์เปลี่ยนจากอุปกรณ์อื่น เก็บเมืองที่กำลังเล่นเป็นสำเนาบนเซิร์ฟเวอร์ แล้วเปิดเมืองหลักล่าสุดหรือไม่?'))return;
        const authenticated=serverEntry.auth.connect();void authenticated.catch(()=>{});
        await enqueueSave(async()=>{
          saveBusy=true;try{
            await authenticated;
            const raw=serializeParkSession(city,parkRuntime,city.market);
            await serverSave.archive({source:'conflict-session',raw});
            resolvingConflict=true;if(serverSave.conflict)serverSave.discardConflictedAttempt();
            const active=await serverSave.load();if(!active)throw Error('ไม่พบเมืองหลักบนเซิร์ฟเวอร์');
            const loaded=deserializeParkSession(active.raw);cityGeneration++;city=loaded.city;parkRuntime=loaded.runtime;
            taxiSession.bind(city);publishTaxi(true);cueLimiter.reset();syncEducationTools();ownerDecisionSession.reset(city);ownerDecisionPanel?.reset();
            resolvingConflict=false;selected=roadStart=null;inspector(false);setTool('select');autosave.adoptLoaded();saveFeedback.recovered();render();
          }finally{saveBusy=false;}
        });
        status('เก็บสำเนางานที่ขัดแย้งแล้ว และเปิดเมืองหลักล่าสุดจากเซิร์ฟเวอร์');return;
      }
      await trackedSave(true);sound('ui-save');status('บันทึกเมืองบนเซิร์ฟเวอร์แล้ว · ตลาดยังปิดอยู่');
    }catch(error){sound('ui-error');status(`ยังบันทึกไม่ได้: ${error instanceof Error?error.message:'เชื่อมต่อไม่ได้'} · อย่าปิดหน้านี้`);}
  });
  // Retire all browser load/recovery controls. Old copies are archived read-only at entry.
  for(const id of ['load','load-legacy','load-v2','load-v3','load-v4','load-v5','load-v6','load-backup'])$('#'+id)?.remove();
  document.querySelector('.save-group.legacy')?.remove();
  const exportButton=document.createElement('button');exportButton.id='export-city-save';exportButton.textContent='ส่งออกเซฟเมืองเป็นไฟล์';
  exportButton.onclick=()=>{const raw=serializeParkSession(city,parkRuntime,city.market),url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`citymanager-day-${city.tick}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('ส่งไฟล์ให้ดาวน์โหลดแล้ว · ไม่ใช่การบันทึกบนเซิร์ฟเวอร์');};
  $('#save').insertAdjacentElement('afterend',exportButton);
  const campusAction = (action: typeof toggleCampus) => {
    const campus = route?.page === 'place' ? campusAt(city, route.cell) : undefined;
    if (!campus) return;
    const result = action(city, campus.id); status(result.message); render(); educationPanel?.showResult(result);
  };
  $('#toggle-campus').addEventListener('click', () => campusAction(toggleCampus));
  $('#upgrade-campus').addEventListener('click', () => campusAction(upgradeCampus));
  $('#new-city').addEventListener('click',()=>{status('เมืองหลักเก็บบนเซิร์ฟเวอร์แล้ว การเริ่มเมืองใหม่ยังปิดไว้เพื่อรักษาเซฟเดิม');});

  document.addEventListener('keydown', e => {
    if (blocksGameShortcuts(e) || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    if (e.key.toLowerCase() === 'u' && !(e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]'))) { audio.change({ muted: !audio.settings.muted }); audioPanel?.sync(); status(audio.settings.muted ? 'ปิดเสียงแล้ว (U)' : 'เปิดเสียงแล้ว (U)'); return; }
    if (route) return;
    if (e.key === ' ' && !(e.target instanceof Element && e.target.closest('button, summary, a, select, input, textarea, [contenteditable]'))) { e.preventDefault(); paused = !paused; render(); }
    const shortcuts = BUILD_SHORTCUTS;
    if (shortcuts[e.key.toLowerCase()]) { sound('ui-select'); setTool(shortcuts[e.key.toLowerCase()]); }
    if (e.key.toLowerCase() === 't') cityStatsPanel?.toggle();
    if (e.key.toLowerCase() === 'm') minimap?.toggleMap();
    if (e.key.toLowerCase() === 'n') cityNetwork?.toggle();
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); view.control(e.key.slice(5).toLowerCase()); }
    if (e.key === 'q') view.control('rotate-left'); if (e.key === 'e') view.control('rotate-right');
  });
  inspector(false);
  setTool('select'); status('รับทุนตั้งเมืองแล้ว · ต่อถนนจากประตูสีเหลืองเพื่อขยายเมือง');
  mapMarkers = new MapMarkers(view, cell => {
    // Open the existing place route directly: never activate a build tool or pick a citizen.
    const next = issuePlaceRoute(city, cell); if (next) {
      openRoute(next);
      // Ordinary selection keeps its KPI-first layout; an explicit issue tap reveals its reasons.
      $('#building-issue-details').scrollIntoView({ block: 'start', inline: 'nearest' });
    }
  });
  dashboard = new OverviewDashboard($('#city-dashboard'));
  cityHud = new CityHud((cell, buildingId) => { view.focus(cell); openRoute({ page: 'place', cell, buildingId }); }, () => {
    openRoute({ page: 'city' });
    const issues = document.querySelector<HTMLDetailsElement>('#issue-section'); if (issues) { issues.open = true; issues.scrollIntoView({ block: 'start' }); }
  });
  atmosphere = new AtmosphereController({ view, getCity: () => city, isPaused: () => paused, getSpeed: () => speed, tickFraction: () => (parkRuntime.activity.minute + parkRuntime.minuteRemainder) / 1440, onChange: () => { mapInfo.overlayKey = mapInfo.issueLayout = ''; render(); } });
  const visual = atmosphere;
  audioPanel = installAudioPanel(audio, $('#atmosphere-menu'));
  // Ambience follows what the screen shows; the city-wide levels only change once a day.
  let soundTick = -1, traffic = 0, factories = 0;
  view.app.on('update', (dt: number) => {
    visual.update(dt);
    view.traffic.update(dt, !paused && !document.hidden);
    trafficLayer?.setVisible(visual.settings.traffic);
    taxiSession.bind(city);
    trafficLayer?.frame(city, parkRuntime.activity.minute, paused || document.hidden, dt);
    if (trafficLayer && taxiFeature) {
      taxiFares.observe(city, trafficLayer.taxiTrips(), !paused && !previewOnly && !recoveryOnly);
    }
    if(trafficLayer){const d=trafficLayer.diagnostics;view.traffic.setCarsEnabled(Boolean(d.failure));const text=trafficGameStatus(d);if(text!==trafficText){trafficText=text;trafficInfo.textContent=text;}const hotspot=d.loadByCell.reduce<typeof d.loadByCell[number]|null>((best,row)=>row.queued>0&&(!best||row.queued>best.queued)?row:best,null);bottleneckCell=hotspot?.cell??null;trafficFocus.hidden=bottleneckCell===null;}

    // `trafficLayer.bus` stays null on integrate/transport until bus is re-wired onto the #126 worker game.
    busView?.frame(city, trafficLayer);
    minimap?.redraw();
    if (city.tick !== soundTick) {
      soundTick = city.tick;
      traffic = Math.min(1, city.households.reduce((n, h) => n + h.members, 0) / 40);
      factories = Math.min(1, new Set(city.cropLedger.filter(e => e.kind === 'process' && e.tick === city.tick).map(e => e.from)).size / 3);
    }
    audio.updateAmbience({ ...visual.soundscape, traffic, factories, closeness: Math.min(1, Math.max(0, (130 - view.radius) / 100)) });
    if (taxiFeature && trafficOn && trafficLayer) {
      if (!taxiView) taxiView = new SceneTaxiVehicles(view.app);
      const fleet = trafficLayer.taxiFleet();
      taxiView.sync(fleet ? trafficTaxiPoses(fleet.cars, fleet.groups) : []);
      taxiView.setEnabled(visual.settings.traffic && !trafficLayer.diagnostics.failure);
    } else taxiView?.sync([]);
    if (paused || document.hidden) return;
    const minutes = Math.min(dt, 0.25) * speed * 1440;
    const tickBefore = city.tick;
    const before = dayBoundaryReached(parkRuntime.activity.minute, parkRuntime.minuteRemainder, minutes) ? cueSnapshot(city) : null;
    let days = 0;
    let dayOutcomes: ReturnType<typeof ownerDecisionSession.advance> = [];
    const frameStarted = performance.now(), frameDeadline = frameStarted + 8;
    try {
      days = advanceParkRuntime(city, parkRuntime, minutes, () => {
        dayOutcomes = ownerDecisionSession.advance(city);
      }, () => { ownerDecisionPanel?.noteOutcomes(dayOutcomes); return !paused; }, () => performance.now() < frameDeadline);
    } catch (error) { paused = true; console.error(error); status('หยุดเวลา: ไม่สามารถประมวลผลกิจกรรมประชาชนได้'); }
    parkFrameMs = performance.now() - frameStarted; parkFramePeakMs = Math.max(parkFramePeakMs, parkFrameMs);
    parkScene?.setQuality(visual.diagnostics.quality);
    parkScene?.sync(parkRuntime.activity);
    if (monthEnded(tickBefore, city.tick)) sound('ev-month');
    if (days && before) for (const cue of cueLimiter.admit(cityCues(before, city).filter(cue => cue !== 'ev-month'), performance.now())) sound(cue);
    if (days) render();
    else if (route?.page === 'city') renderParkPanel();
  });
  // Read-only diagnostics for reproducible QA; no renderer-owned simulation state.
  Object.defineProperty(window, 'cityManager', { value: { snapshot: () => serialize(city), sessionSnapshot: () => serializeParkSession(city, parkRuntime), parks: () => ({ ...parkActivityDiagnostics(parkRuntime.activity), ...parkScene?.diagnostics, minuteRemainder: parkRuntime.minuteRemainder, recreation: structuredClone(parkRuntime.recreation), paused, speed, frameMs: parkFrameMs, peakFrameMs: parkFramePeakMs }), audio: () => audio.diagnostics(), cellScreen: (i: number) => view.project(i), engine: 'PlayCanvas 2.23.3', visuals: () => view.assets?.status ?? { ready: false, loaded: [], failed: [] }, ground: () => view.ground.diagnostics, agriculture: () => view.agricultureDiagnostics(), atmosphere: () => visual.diagnostics, traffic: () => trafficLayer?.diagnostics ?? null, bus: () => busView?.diagnostics ?? null, busSnapshot: () => trafficLayer?.bus?.engine.snapshot() ?? null } });
  $('#city-canvas').addEventListener('webglcontextlost', () => { paused = true; status('Graphics context lost. Save your city, then reload.'); render(); });
}
boot().catch(error => { console.error(error); status('Could not start WebGL2. Enable hardware graphics and reload in a supported browser.'); });
