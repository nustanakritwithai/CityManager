import './style.css';
import { setupSubmenus, renderSubmenus } from './submenus.ts';
import { setupSubmenuNavigation, closeSubmenus, hasOpenSubmenu } from './submenu-navigation.ts';
import './submenu-layout.css';
import { CityView } from './renderer.ts';
import { SIZE, MONTH, WAGES, access, connectedRoads, createCity, step, buildRoad, zoneCell, bulldoze, explainCell, summary, serialize, deserialize, roadPath, type City, type Zone } from './sim.ts';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const money = (n: number) => '฿' + (n / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const SAVE_KEY = 'citymanager.save.v1';
const BASE = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
let city: City = createCity(61025);
let view: CityView;
let tool = 'select', selected: number | null = null, roadStart: number | null = null, hover: number | null = null;
let paused = false, speed = 1, accumulator = 0;
const toolNames: Record<string, string> = { select: 'เลือกสถานที่', road: 'ถนน', R: 'โซนบ้าน', C: 'โซนร้านค้า', I: 'โซนโรงงาน', bulldoze: 'รื้อถอน', pan: 'เลื่อนแผนที่' };
const help: Record<string, string> = {
  select: 'แตะสถานที่เพื่อดูข้อมูลและเหตุผลการเติบโต',
  road: 'ถนน ฿50/ช่อง · ลากเส้น หรือแตะจุดเริ่มและจุดจบ · กลับเพื่อยกเลิก',
  R: 'วางบ้านข้างถนนเชื่อมเมือง · ต้องมีงานว่าง (สองบ้านแรกยกเว้น)',
  C: 'วางร้านค้าข้างถนนเชื่อมเมือง · ต้องมีลูกค้า แรงงาน และกำไรที่คุ้มค่าเช่า',
  I: 'วางโรงงานข้างถนนเชื่อมเมือง · ต้องมีแรงงาน (โรงงานแรกยกเว้น)',
  bulldoze: 'แตะถนนหรืออาคารเพื่อรื้อ ฿20 · ประตูเชื่อมภายนอกรื้อไม่ได้',
  pan: 'ลากเพื่อเลื่อน · สองนิ้วเลื่อน/ซูม · ลากปุ่มขวาเพื่อหมุน'
};
function status(message: string) { $('#status').textContent = message; $('#inspector-status').textContent = message; }
function setTool(next: string) {
  tool = next; roadStart = null; hover = null;
  if (view) { view.abortGesture(); view.mode = next; view.dragStart = null; }
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(button => {
    const active = button.dataset.tool === next; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('#tool-help').textContent = help[next]; status(`${toolNames[next]}พร้อมใช้งาน`); render();
}
function inspector(open: boolean) { if (!open) closeSubmenus(); $('#inspector').dataset.open = String(open); $('#toggle-inspector').setAttribute('aria-expanded', String(open)); }
function cancel() {
  view?.abortGesture();
  if (tool === 'select' && hasOpenSubmenu()) { closeSubmenus(); status('กลับข้อมูลสถานที่'); return; }
  if (roadStart !== null) { roadStart = null; status('ยกเลิกจุดเริ่มแล้ว · Road start cancelled'); render(); return; }
  if (tool !== 'select') { setTool('select'); return; }
  inspector(false); status('กลับสู่แผนที่เมือง');
}
function activate(index: number) {
  const selectionChanged = selected !== index; selected = index;
  if (tool === 'road') {
    if (roadStart === null) { roadStart = index; status('เลือกจุดเริ่มแล้ว · แตะจุดจบ หรือกดกลับ'); }
    else { const result = buildRoad(city, roadStart, index); roadStart = null; status(result.message); }
  } else if (['R', 'C', 'I'].includes(tool)) status(zoneCell(city, index, tool as Zone).message);
  else if (tool === 'bulldoze') status(bulldoze(city, index).message);
  else if (tool === 'select') { inspector(true); if (selectionChanged) { closeSubmenus(); $('#inspector-body').scrollTop = 0; } }
  render();
}
function node(tag: string, className = '', content?: string): HTMLElement {
  const element = document.createElement(tag); if (className) element.className = className; if (content !== undefined) element.textContent = content; return element;
}
function list(container: HTMLElement, rows: string[]) { container.replaceChildren(...rows.map(text => node('p', '', text))); }
function icon(name: string): HTMLImageElement { const img = document.createElement('img'); img.src = `${BASE}assets/kenney-ui/${name}.png`; img.alt = ''; return img; }
function tag(label: string, state: 'good' | 'warn' | 'bad' | '' = '') {
  const badge = node('span', `place-tag ${state}`); if (state === 'good' || state === 'bad') badge.append(icon(state === 'good' ? 'status-ok' : 'status-alert')); badge.append(document.createTextNode(label)); return badge;
}
function metric(label: string, value: string, isMoney = false, note?: string, rawValue?: number) {
  const keys: Record<string, string> = { 'เงินออม': 'cash', 'เงินสด': 'cash', 'คนงาน / ที่รับได้': 'workers', 'สินค้าคงคลัง': 'stock', 'สำรองค่าจ้าง': 'reserved', 'กำไรรอบก่อนภาษี': 'profit', 'ใช้จ่ายได้': 'spendable' };
  const card = node('dl', `metric${isMoney ? ' money' : ''}`); card.dataset.metric = keys[label] ?? label;
  if (rawValue !== undefined) card.dataset.value = String(rawValue);
  card.append(node('dt', '', label), node('dd', '', value)); if (note) card.append(node('small', '', note)); return card;
}
function symbol(zone: Zone, road: boolean) {
  const color = zone === 'R' ? '#87c99b' : zone === 'C' ? '#80b9db' : zone === 'I' ? '#e3a572' : '#f3c46b';
  const shape = road ? '<path d="M35 7h26v82H35z" fill="#748b88"/><path d="M48 12v15m0 10v15m0 10v15" stroke="#f3c46b" stroke-width="3"/>' : zone === 'R' ? '<path d="M17 44 48 18l31 26v37H17z" fill="currentColor"/><path d="M12 44 48 13l36 31" fill="none" stroke="#d7e9d4" stroke-width="5"/><path d="M41 55h16v26H41zM25 49h10v13H25zM64 49h10v13H64z" fill="#28474a"/>' : zone === 'C' ? '<path d="M15 36h66v45H15z" fill="currentColor"/><path d="m12 24 72 0v20H12z" fill="#d7e9d4"/><path d="M25 24v20m22-20v20m23-20v20" stroke="currentColor" stroke-width="12"/><path d="M25 54h23v18H25zM59 54h14v27H59z" fill="#28474a"/>' : zone === 'I' ? '<path d="M14 45 35 33v12l22-12v12h25v36H14zM66 14h12v31H66z" fill="currentColor"/><path d="M24 57h11v11H24zM44 57h11v11H44zM64 57h10v11H64z" fill="#28474a"/>' : '<path d="M14 44h19v37H14zM39 21h21v60H39zM66 36h16v45H66z" fill="currentColor"/><path d="M45 30h9m-9 12h9m-9 12h9" stroke="#28474a" stroke-width="4"/>';
  $('#place-art').innerHTML = `<svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:${color}"><ellipse cx="48" cy="83" rx="38" ry="6" fill="#102d32"/>${shape}</svg>`;
}
function shortReason(reason: string): string | null {
  if (reason.startsWith('No connected road frontage')) return 'ยังไม่มีถนนข้างแปลงที่เชื่อมถึงประตูภายนอก';
  if (reason.startsWith('No power')) return 'ไฟฟ้าภายนอกไม่พร้อมใช้งาน';
  if (reason.startsWith('No water')) return 'น้ำภายนอกไม่พร้อมใช้งาน';
  if (reason.startsWith('No housing demand')) return 'ยังไม่มีตำแหน่งงานว่างให้ครัวเรือนใหม่';
  if (reason.startsWith('No industry demand')) return 'โรงงานเพิ่มต้องมีคนว่างงาน และงานว่างเดิมน้อยกว่า 2 ตำแหน่ง';
  if (reason.startsWith('No retail demand')) return 'ร้านค้าที่มีอยู่รองรับความต้องการปัจจุบันแล้ว';
  if (reason.startsWith('Viability:')) { const n = reason.match(/need (\d+).*have (\d+)/); return n ? `ร้านค้าต้องมีครัวเรือนที่มีเงินและเชื่อมถนน ${n[1]} ครัวเรือน (ขณะนี้ ${n[2]})` : 'ลูกค้ายังไม่พอให้รายได้คุ้มค่าจ้างและค่าเช่า'; }
  if (reason.includes('limit (')) return 'ถึงจำนวนสูงสุดที่ต้นแบบรองรับแล้ว';
  if (reason.startsWith('Expected income')) return 'รายได้คาดหมายยังไม่พอซื้อสินค้าและจ่ายค่าเช่า';
  if (reason.startsWith('Eligible;')) return `พร้อมพัฒนา ทบทวนแปลงอีก ${3 - city.tick % 3} วัน แล้วสุ่มเลือกจากแปลงที่ผ่านเงื่อนไข`;
  return null;
}
function renderPlace() {
  const cell = selected === null ? null : city.cells[selected];
  const b = cell?.building == null ? null : city.buildings.find(v => v.id === cell.building);
  const h = b ? city.households.find(v => v.home === b.id) : null;
  const f = b ? city.firms.find(v => v.building === b.id) : null;
  const connected = selected !== null && access(city, selected);
  const coordinates = selected === null ? '' : `${selected % SIZE + 1},${Math.floor(selected / SIZE) + 1}`;
  const typeName = cell?.road ? 'ถนน' : cell?.zone === 'R' ? 'บ้านพัก' : cell?.zone === 'C' ? 'ร้านค้า' : cell?.zone === 'I' ? 'โรงงาน' : 'ที่ดินว่าง';
  $('#selection-title').textContent = selected === null ? 'ภาพรวมเมือง' : `${typeName}${b ? ` #${b.id}` : ''} · ${coordinates}`;
  $('#place-subtitle').textContent = b ? `${b.zone === 'R' ? 'ที่อยู่อาศัย' : b.zone === 'C' ? 'พาณิชยกรรม' : 'อุตสาหกรรม'} · ระดับ ${b.level} · อายุ ${b.age} วัน` : selected === null ? 'เลือกสถานที่เพื่อดูข้อมูล' : cell?.zone ? `โซน ${cell.zone} · รอการพัฒนา` : 'ข้อมูลสถานที่';
  symbol(cell?.zone ?? null, !!cell?.road);
  const tags: HTMLElement[] = [], metrics: HTMLElement[] = [], reasons: string[] = [];
  if (selected === null) {
    tags.push(tag('จำลองรายวัน'), tag('น้ำ/ไฟภายนอก', city.utilities.power && city.utilities.water ? 'good' : 'bad'));
    metrics.push(metric('ครัวเรือน', String(city.households.length)), metric('กิจการ', String(city.firms.length)), metric('สินค้าที่ใช้แล้ว', String(city.goods.consumed)));
    reasons.push('แตะอาคารเพื่อดูคนงาน เงินสด สินค้า และผลกำไรรอบล่าสุด', 'ต่อถนนจากประตูสีเหลือง แล้ววางโซนเพื่อให้เมืองพัฒนาเอง');
  } else {
    tags.push(tag(connected ? 'ถนนเชื่อมถึงเมือง' : 'ขาดถนนเชื่อม', connected ? 'good' : 'bad'));
    if (!connected) reasons.push('ต้องเชื่อมถนนข้างแปลงกับประตูสีเหลืองฝั่งตะวันตก');
    if (!city.utilities.power || !city.utilities.water) reasons.push('น้ำหรือไฟภายนอกไม่พร้อม การผลิตและเติบโตหยุดชั่วคราว');
    if (h) {
      const bought = h.lastPurchaseTick === city.tick;
      tags.push(tag(h.employer === null ? 'ยังไม่มีงาน' : 'มีงานทำ', h.employer === null ? 'warn' : 'good'));
      metrics.push(metric('เงินออม', money(city.accounts[h.wallet] ?? 0), true, undefined, city.accounts[h.wallet] ?? 0), metric('งานปัจจุบัน', h.employer === null ? 'ว่างงาน' : `กิจการ #${h.employer}`), metric('ไม่ได้ซื้อสินค้า', `${h.needs} วัน`));
      reasons.push(bought ? 'ซื้อสินค้า 1 หน่วยจากร้านค้าที่เข้าถึงได้แล้ววันนี้' : 'ยังไม่ได้ซื้อวันนี้ ต้องมีเงินและร้านค้าที่เชื่อมถึงกัน มีคนงาน และมีสินค้า');
      reasons.push('ขยายบ้านเมื่ออายุ ≥30 วัน มีงาน ซื้อสินค้าไม่นานเกิน 3 วัน และมีเงินออม ≥฿200');
    } else if (f && b) {
      const reserve = Object.values(f.workDays).reduce((sum, days) => sum + days * WAGES[f.zone] / MONTH, 0);
      const wallet = city.accounts[f.wallet] ?? 0, capacity = f.zone === 'I' ? b.level + 3 : b.level;
      tags.push(tag(f.employees.length ? 'มีแรงงาน' : 'รอแรงงาน', f.employees.length ? 'good' : 'warn'));
      metrics.push(metric('คนงาน / ที่รับได้', `${f.employees.length} / ${capacity}`, false, undefined, f.employees.length), metric('สินค้าคงคลัง', `${f.inventory} หน่วย`, false, undefined, f.inventory), metric('เงินสด', money(wallet), true, undefined, wallet), metric('สำรองค่าจ้าง', money(reserve), true, undefined, reserve), metric('ใช้จ่ายได้', money(Math.max(0, wallet - reserve)), true, undefined, Math.max(0, wallet - reserve)), metric('กำไรรอบก่อนภาษี', money(f.lastMonthProfit), true, city.tick < 30 ? 'ยังไม่ปิดเดือนแรก' : 'เดือนล่าสุดที่ปิดบัญชี', f.lastMonthProfit));
      reasons.push(f.employees.length === 0 ? 'ยังเดินกิจการไม่ได้ ต้องมีคนว่างงานที่เข้าถึง และเงินสำรองค่าจ้าง' : f.zone === 'I' ? 'ผลิต 8 หน่วย/คน/วัน ขายในเมือง ฿3 หรือส่งออก ฿3.50' : 'ซื้อสินค้าจากโรงงาน ฿3 หรือนำเข้า ฿4.50 ขายให้ครัวเรือน ฿8');
      reasons.push('เงินสำรองค่าจ้างใช้ซื้อสินค้าหรือขยายไม่ได้ · ขยายเมื่ออายุ ≥30 วัน มีกำไรรอบล่าสุด คนงาน และเงินก่อสร้าง');
    } else if (cell?.road) {
      tags.push(tag('ถนนกริด')); metrics.push(metric('สร้างต่อช่อง', money(5000), true), metric('บำรุงต่อวัน', money(10), true), metric('ช่องเชื่อมต่อ', String(connectedRoads(city).size)));
      reasons.push(connected ? 'ครัวเรือนและกิจการข้างถนนนี้เข้าถึงตลาดภายนอกได้' : 'ถนนเส้นนี้ยังแยกจากตลาดภายนอก โซนข้างถนนจึงเติบโตไม่ได้');
    } else if (cell?.zone) {
      const raw = explainCell(city, selected); const stopped = raw.some(r => r.startsWith('Growth is blocked'));
      tags.push(tag(stopped ? 'รอเงื่อนไข' : 'พร้อมพัฒนา', stopped ? 'warn' : 'good'));
      reasons.push(...raw.map(shortReason).filter((r): r is string => r !== null && !(r.startsWith('ยังไม่มีถนน') && !connected)));
    } else { tags.push(tag('ยังไม่กำหนดโซน')); reasons.push('เลือกบ้าน ร้านค้า หรือโรงงาน แล้วแตะแปลงนี้เพื่อกำหนดโซน'); }
  }
  $('#place-tags').replaceChildren(...tags); $('#place-metrics').replaceChildren(...metrics); $('#place-metrics').hidden = metrics.length === 0;
  const explanation = $('#explanation'), diagnosticOpen = explanation.querySelector('details')?.open ?? false; explanation.replaceChildren(...reasons.slice(0, 3).map(r => node('p', 'reason', r)));
  if (selected !== null) {
    const detail = document.createElement('details'); detail.className = 'diagnostic'; detail.open = diagnosticOpen; detail.append(node('summary', '', 'รายละเอียดกฎและข้อมูลจำลอง')); const body = node('div'); list(body, explainCell(city, selected)); detail.append(body); explanation.append(detail);
  }
}
function render() {
  if (!view) return;
  const s = summary(city);
  $('#population').textContent = String(s.population); $('#jobs').textContent = `${s.employed} / ${s.jobs}`; $('#treasury').textContent = money(s.treasury);
  $('#day').textContent = `วันที่ ${city.tick} · เดือน ${Math.floor(city.tick / 30) + 1}`; $('#balance').textContent = money(s.net);
  $('#pause').textContent = paused ? '▶' : 'Ⅱ'; $('#pause').setAttribute('aria-label', paused ? 'เล่นต่อ' : 'หยุดเวลา'); $('#pause').title = paused ? 'เล่นต่อ (Space)' : 'หยุดเวลา (Space)'; $('#pause').setAttribute('aria-pressed', String(paused));
  document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => { b.classList.toggle('active', Number(b.dataset.speed) === speed); b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed)); });
  const demand = node('div', 'demand-grid');
  for (const [zone, label] of [['R', 'บ้าน'], ['C', 'ร้านค้า'], ['I', 'โรงงาน']] as const) { const item = node('div', `demand-item ${zone.toLowerCase()}`); item.append(node('span', '', label), node('b', '', String(s.demand[zone]))); demand.append(item); }
  $('#growth-summary').replaceChildren(demand); renderPlace();
  renderSubmenus(city, selected);
  const start = view.dragStart ?? roadStart; const preview = start === null ? (hover === null ? [] : [hover]) : hover === null ? [start] : roadPath(start, hover);
  view.render(city, selected, preview);
}

async function boot() {
  setupSubmenus(); setupSubmenuNavigation();
  view = await CityView.create($('#city-canvas'), activate, index => { if (hover !== index) { hover = index; render(); } }, (a, b) => {
    selected = b; roadStart = null; status(buildRoad(city, a, b).message); render();
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
  $('#toggle-inspector').addEventListener('click', () => inspector($('#inspector').dataset.open !== 'true'));
  $('#close-inspector').addEventListener('click', () => inspector(false));
  $('#save').addEventListener('click', () => {
    try { localStorage.setItem(SAVE_KEY, serialize(city)); status(`บันทึกในเบราว์เซอร์แล้ว · Saved day ${city.tick}`); } catch { status('บันทึกไม่ได้: พื้นที่เบราว์เซอร์ไม่พร้อมหรือเต็ม'); }
  });
  $('#load').addEventListener('click', () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY); if (!raw) { status('ยังไม่มีเมืองที่บันทึกในเบราว์เซอร์นี้'); return; }
      const loaded = deserialize(raw); city = loaded; selected = roadStart = null; paused = true; accumulator = 0; render(); status(`โหลดวันที่ ${city.tick} แล้ว · หยุดเวลาให้ตรวจข้อมูล`);
    } catch (error) { status(`โหลดไม่สำเร็จ เมืองปัจจุบันยังอยู่ · ${error instanceof Error ? error.message : 'ข้อมูลบันทึกไม่ถูกต้อง'}`); }
  });
  $('#new-city').addEventListener('click', () => {
    const dialog = document.createElement('dialog');
    const title = document.createElement('h2'); title.textContent = 'เริ่มเมืองเดิมอีกครั้ง?';
    const text = document.createElement('p'); text.textContent = 'เมืองที่ยังไม่บันทึกจะถูกแทนที่ เมืองที่เคยบันทึกยังเรียกคืนได้ด้วยปุ่มโหลด';
    const back = document.createElement('button'); back.textContent = 'กลับสู่เมือง'; back.autofocus = true;
    const reset = document.createElement('button'); reset.textContent = 'เริ่มเมืองใหม่';
    back.onclick = () => dialog.close(); reset.onclick = () => { city = createCity(61025); selected = roadStart = null; accumulator = 0; paused = true; setTool('select'); render(); status('เมืองพร้อมแล้ว · กดเล่นต่อเพื่อเริ่มเวลา'); dialog.close(); };
    dialog.append(title, text, back, reset); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
  });
  document.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (e.key === ' ' && !(e.target instanceof Element && e.target.closest('button, summary, a, select, input, textarea, [contenteditable]'))) { e.preventDefault(); paused = !paused; accumulator = 0; render(); }
    const shortcuts: Record<string, string> = { v: 'select', r: 'road', '1': 'R', '2': 'C', '3': 'I', b: 'bulldoze', p: 'pan' };
    if (shortcuts[e.key.toLowerCase()]) setTool(shortcuts[e.key.toLowerCase()]);
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); view.control(e.key.slice(5).toLowerCase()); }
    if (e.key === 'q') view.control('rotate-left'); if (e.key === 'e') view.control('rotate-right');
  });
  document.addEventListener('visibilitychange', () => { accumulator = 0; });
  inspector(innerWidth >= 1100 && !matchMedia('(any-pointer: coarse)').matches);
  setTool('select'); status('รับทุนตั้งเมืองแล้ว · ต่อถนนจากประตูสีเหลืองเพื่อขยายเมือง');
  view.app.on('update', (dt: number) => {
    if (paused || document.hidden) return;
    accumulator += Math.min(dt, 0.25) * speed;
    let changed = false;
    while (accumulator >= 1) { step(city); accumulator -= 1; changed = true; }
    if (changed) render();
  });
  // Read-only diagnostics for reproducible QA; no renderer-owned simulation state.
  Object.defineProperty(window, 'cityManager', { value: { snapshot: () => serialize(city), cellScreen: (i: number) => view.project(i), engine: 'PlayCanvas 2.23.3', visuals: () => view.assets?.status ?? { ready: false, loaded: [], failed: [] }, ground: () => view.ground.diagnostics } });
  $('#city-canvas').addEventListener('webglcontextlost', () => { paused = true; status('Graphics context lost. Save your city, then reload.'); render(); });
}
boot().catch(error => { console.error(error); status('Could not start WebGL2. Enable hardware graphics and reload in a supported browser.'); });
