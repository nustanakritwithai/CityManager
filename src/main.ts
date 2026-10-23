import './style.css';
import { CityView } from './renderer.ts';
import { SIZE, createCity, step, buildRoad, zoneCell, bulldoze, explainCell, summary, serialize, deserialize, roadPath, type City, type Zone } from './sim.ts';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const money = (n: number) => '฿' + (n / 100).toLocaleString('en', { maximumFractionDigits: 2 });
const SAVE_KEY = 'citymanager.save.v1';
let city: City = createCity(61025);
let view: CityView;
let tool = 'select', selected: number | null = null, roadStart: number | null = null, hover: number | null = null;
let paused = false, speed = 1, accumulator = 0;
const help: Record<string, string> = {
  select: 'Select a parcel to see its growth conditions and agents.',
  road: 'Road ฿50 / tile · Drag a path or tap start, then end for an L-shaped road. Cancel clears the start.',
  R: 'Residential · Tap empty land beside a connected road. Households arrive when jobs exist (first two homes are bootstrap).',
  C: 'Commercial · Tap beside a connected road. Shops need households, workers and viable demand.',
  I: 'Industrial · Tap beside a connected road. Firms need workers and viable demand (first factory is bootstrap).',
  bulldoze: 'Bulldoze · Tap one road, zone or building. Gateway is protected. Demolition has a cost.',
  pan: 'Pan · Drag the city. Two-finger pan/pinch, right-drag rotation and the camera buttons also work.'
};
function status(message: string) { $('#status').textContent = message; }
function setTool(next: string) {
  tool = next; roadStart = null; hover = null;
  if (view) { view.abortGesture(); view.mode = next; }
  if (view) view.dragStart = null;
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(button => {
    const active = button.dataset.tool === next; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  $('#tool-help').textContent = help[next];
  status(`${next === 'select' ? 'Select' : next} tool ready.`); render();
}
function inspector(open: boolean) {
  $('#inspector').dataset.open = String(open);
  $('#toggle-inspector').setAttribute('aria-expanded', String(open));
}
function cancel() {
  view?.abortGesture();
  if (roadStart !== null) { roadStart = null; status('Road start cancelled. Road tool is still ready.'); render(); return; }
  if (tool !== 'select') { setTool('select'); return; }
  inspector(false); status('Returned to city view.');
}
function activate(index: number) {
  selected = index;
  if (tool === 'road') {
    if (roadStart === null) { roadStart = index; status('Start set. Tap the end tile, or Cancel.'); }
    else { const result = buildRoad(city, roadStart, index); roadStart = null; status(result.message); }
  } else if (['R', 'C', 'I'].includes(tool)) status(zoneCell(city, index, tool as Zone).message);
  else if (tool === 'bulldoze') status(bulldoze(city, index).message);
  else if (tool === 'select') inspector(true);
  render();
}
function list(container: HTMLElement, rows: string[]) {
  container.replaceChildren(...rows.map(text => { const row = document.createElement('p'); row.textContent = text; return row; }));
}
function render() {
  if (!view) return;
  const s = summary(city);
  $('#population').textContent = String(s.population);
  $('#jobs').textContent = `${s.employed} / ${s.jobs}`;
  $('#treasury').textContent = money(s.treasury);
  $('#day').textContent = `DAY ${city.tick} · M${Math.floor(city.tick / 30) + 1}`;
  $('#balance').textContent = `${money(s.net)} / month`;
  $('#pause').textContent = paused ? '▶' : 'Ⅱ';
  $('#pause').setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
  $('#pause').title = paused ? 'Resume (Space)' : 'Pause (Space)';
  $('#pause').setAttribute('aria-pressed', String(paused));
  document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => { b.classList.toggle('active', Number(b.dataset.speed) === speed); b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed)); });
  $('#growth-summary').textContent = `Demand R ${s.demand.R} · C ${s.demand.C} · I ${s.demand.I} | ${city.households.length} households · ${city.firms.length} firms. Tick = 1 day; wages, rent and tax settle every 30 days.`;
  $('#selection-title').textContent = selected === null ? 'City observatory' : `Parcel ${selected % SIZE + 1}, ${Math.floor(selected / SIZE) + 1}`;
  const reasons = selected === null ? ['Build roads from the amber western gateway. Zone R / C / I along connected roads.', 'Select any parcel to see why it grows or waits.', 'Prototype utilities: outside power and water are universally available; network capacity is a future stage.'] : explainCell(city, selected);
  list($('#explanation'), reasons);
  list($('#ledger'), city.ledger.slice(-16).reverse().map(e => `D${e.tick} · ${e.reason} · ${e.from} → ${e.to} · ${money(e.amount)}`));
  list($('#goods-ledger'), city.goodsLedger.slice(-10).reverse().map(e => `D${e.tick} · ${e.reason} · ${e.from} → ${e.to} · ${e.quantity} goods`));
  list($('#accounts'), Object.entries(city.accounts).map(([name, amount]) => `${name}: ${money(amount)}`));
  const start = view.dragStart ?? roadStart;
  const preview = start === null ? (hover === null ? [] : [hover]) : hover === null ? [start] : roadPath(start, hover);
  view.render(city, selected, preview);
}
async function boot() {
  view = await CityView.create($('#city-canvas'), activate, index => { if (hover !== index) { hover = index; render(); } }, (a, b) => {
    selected = b; roadStart = null; status(buildRoad(city, a, b).message); render();
  });
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool!)));
  document.querySelectorAll<HTMLElement>('[data-camera]').forEach(b => b.addEventListener('click', () => view.control(b.dataset.camera!)));
  document.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => b.addEventListener('click', () => { speed = Number(b.dataset.speed); accumulator = 0; render(); }));
  $('#pause').addEventListener('click', () => { paused = !paused; accumulator = 0; render(); });
  $('#cancel-tool').addEventListener('click', cancel);
  $('#toggle-inspector').addEventListener('click', () => inspector($('#inspector').dataset.open !== 'true'));
  $('#close-inspector').addEventListener('click', () => inspector(false));
  $('#save').addEventListener('click', () => {
    try { localStorage.setItem(SAVE_KEY, serialize(city)); status(`Saved day ${city.tick} locally (v1).`); } catch { status('Save failed: browser storage is unavailable or full.'); }
  });
  $('#load').addEventListener('click', () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY); if (!raw) { status('No local v1 save yet.'); return; }
      const loaded = deserialize(raw); city = loaded; selected = roadStart = null; paused = true; accumulator = 0; render(); status(`Loaded day ${city.tick}. Paused for inspection.`);
    } catch (error) { status(`Load rejected; current city kept. ${error instanceof Error ? error.message : 'Invalid save'}`); }
  });
  $('#new-city').addEventListener('click', () => {
    const dialog = document.createElement('dialog');
    const title = document.createElement('h2'); title.textContent = 'Start the same seeded city again?';
    const text = document.createElement('p'); text.textContent = 'The current unsaved city will be replaced. Your saved city stays available with Load.';
    const back = document.createElement('button'); back.textContent = 'Keep city'; back.autofocus = true;
    const reset = document.createElement('button'); reset.textContent = 'Start new city';
    back.onclick = () => dialog.close(); reset.onclick = () => { city = createCity(61025); selected = roadStart = null; accumulator = 0; paused = true; setTool('select'); render(); status('New seeded city ready. Press Resume to grow.'); dialog.close(); };
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
  inspector(innerWidth >= 800);
  setTool('select'); status('Founding grant received. Starter plots will grow; extend from the amber gateway.');
  view.app.on('update', (dt: number) => {
    if (paused || document.hidden) return;
    accumulator += Math.min(dt, 0.25) * speed;
    let changed = false;
    while (accumulator >= 1) { step(city); accumulator -= 1; changed = true; }
    if (changed) render();
  });
  // Read-only diagnostics for reproducible QA; no renderer-owned simulation state.
  Object.defineProperty(window, 'cityManager', { value: { snapshot: () => serialize(city), cellScreen: (i: number) => view.project(i), engine: 'PlayCanvas 2.23.3' } });
  $('#city-canvas').addEventListener('webglcontextlost', () => { paused = true; status('Graphics context lost. Save your city, then reload.'); render(); });
}
boot().catch(error => { console.error(error); status('Could not start WebGL2. Enable hardware graphics and reload in a supported browser.'); });
