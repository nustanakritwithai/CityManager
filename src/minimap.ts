/**
 * Minimap (desktop corner) and the full city map (M): the 24 × 24 grid drawn from the city's
 * own cells, with the camera's view, the selection and problem markers. Clicking moves the
 * camera (minimap) or opens the place (map). Read-only over City.
 */
import './minimap.css';
import { SIZE, GATEWAY, type City } from './sim.ts';
import { commercialPresentation } from './commercial-visuals.ts';
import { buildingIssues } from './map-overlay.ts';
import { busCellNote, paintBusOverlay } from './bus/map-paint.ts';
import { busMapRevision } from './bus/map-state.ts';

type View = { target: { x: number; z: number }; yaw: number; radius: number };
const UNIT = 2;
const FILL: Record<string, string> = { R: '#8fd1a7', C: '#8cc3e6', I: '#e9b07c', F: '#c7dc8a' };
const BUILT: Record<string, string> = { R: '#3f9c6b', C: '#3c84b8', I: '#c27a3a', F: '#8aa543', market: '#9cb85a' };
const NAMES = { shop: 'ร้าน', market: 'ตลาด', I: 'โรงงาน', F: 'ฟาร์ม' } as const;

function draw(ctx: CanvasRenderingContext2D, city: City, size: number, opts: { view?: View; selected?: number | null; issues?: Set<number>; labels?: boolean }) {
  const cell = size / SIZE;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#6f9a62'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < city.cells.length; i++) {
    const c = city.cells[i], x = (i % SIZE) * cell, y = Math.floor(i / SIZE) * cell;
    if (c.road) { ctx.fillStyle = i === GATEWAY ? '#f3c46b' : '#556078'; ctx.fillRect(x, y, cell, cell); continue; }
    if (!c.zone) continue;
    ctx.fillStyle = FILL[c.zone]; ctx.fillRect(x + .5, y + .5, cell - 1, cell - 1);
    if (c.building !== null) {
      const building = city.buildings.find(b => b.id === c.building);
      ctx.fillStyle = c.zone === 'C' && building && building.level <= 3 ? BUILT.market : BUILT[c.zone];
      const pad = Math.max(1, cell * .18); ctx.fillRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2);
    }
  }
  if (opts.issues?.size) {
    for (const i of opts.issues) {
      const x = (i % SIZE + .5) * cell, y = (Math.floor(i / SIZE) + .5) * cell;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, cell * .22), 0, Math.PI * 2); ctx.fillStyle = '#ff6b5b'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
  if (opts.selected != null) {
    const i = opts.selected, x = (i % SIZE) * cell, y = Math.floor(i / SIZE) * cell;
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff1bb'; ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
  }
  if (opts.view) {
    // The camera looks from its position toward the target; draw the rough ground footprint.
    const v = opts.view, cx = (v.target.x / UNIT + (SIZE - 1) / 2 + .5) * cell, cy = (v.target.z / UNIT + (SIZE - 1) / 2 + .5) * cell;
    const half = v.radius * .5 / UNIT * cell, depth = v.radius * .36 / UNIT * cell;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-v.yaw + Math.PI);
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(-half * .7, -depth); ctx.lineTo(half * .7, -depth); ctx.lineTo(half, depth); ctx.lineTo(-half, depth); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  if (opts.labels) {
    ctx.font = `600 ${Math.max(10, cell * .42)}px "IBM Plex Sans Thai", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = (text: string, i: number) => {
      const x = (i % SIZE + .5) * cell, y = (Math.floor(i / SIZE) + .5) * cell - cell * .75;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(15, 25, 46,.85)'; ctx.strokeText(text, x, y); ctx.fillStyle = '#f4f8f2'; ctx.fillText(text, x, y);
    };
    for (const f of city.firms) {
      const b = city.buildings.find(v => v.id === f.building); if (!b) continue;
      label(`${f.zone === 'C' ? commercialPresentation(b.level).title : NAMES[f.zone as 'I' | 'F']} #${b.id}`, b.cell);
    }
    label('ประตูเมือง', GATEWAY);
  }
  paintBusOverlay(ctx, cell, !!opts.labels);
}

function setupCanvas(canvas: HTMLCanvasElement, size: number) {
  const dpr = Math.min(2, devicePixelRatio || 1); canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx;
}
const cellAt = (canvas: HTMLCanvasElement, e: PointerEvent | MouseEvent) => {
  const r = canvas.getBoundingClientRect(), col = Math.floor((e.clientX - r.left) / r.width * SIZE), row = Math.floor((e.clientY - r.top) / r.height * SIZE);
  return col < 0 || row < 0 || col >= SIZE || row >= SIZE ? null : row * SIZE + col;
};

export class Minimap {
  private readonly root = document.createElement('aside');
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map = document.createElement('div');
  private readonly mapCanvas = document.createElement('canvas');
  private readonly mapInfo = document.createElement('p');
  private city: City | null = null;
  private selected: number | null = null;
  private key = '';
  private issues = new Set<number>();
  constructor(private readonly view: View, private readonly onFocus: (cell: number) => void, private readonly onOpen: (cell: number) => void) {
    this.root.className = 'minimap'; this.root.setAttribute('aria-label', 'แผนที่ย่อ');
    const head = document.createElement('div'); head.className = 'minimap-head';
    const title = document.createElement('span'); title.textContent = 'แผนที่';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'minimap-open'; open.textContent = 'M'; open.title = 'เปิดแผนที่เมือง (M)'; open.setAttribute('aria-label', 'เปิดแผนที่เมือง');
    open.addEventListener('click', () => this.toggleMap(true));
    head.append(title, open);
    this.canvas.className = 'minimap-canvas'; this.canvas.setAttribute('role', 'img'); this.canvas.setAttribute('aria-label', 'แผนที่ย่อ แตะเพื่อเลื่อนกล้องไปที่จุดนั้น');
    this.ctx = setupCanvas(this.canvas, 152);
    this.canvas.addEventListener('pointerdown', e => { const cell = cellAt(this.canvas, e); if (cell !== null) { this.onFocus(cell); this.redraw(true); } });
    this.root.append(head, this.canvas); document.body.append(this.root);
    // Full map overlay.
    this.map.className = 'city-map'; this.map.hidden = true; this.map.setAttribute('role', 'dialog'); this.map.setAttribute('aria-label', 'แผนที่เมือง');
    const bar = document.createElement('header'); bar.className = 'city-map-bar';
    const h = document.createElement('h2'); h.textContent = 'แผนที่เมือง';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'city-map-close'; close.textContent = '✕'; close.setAttribute('aria-label', 'ปิดแผนที่');
    close.addEventListener('click', () => this.toggleMap(false));
    bar.append(h, close);
    const legend = document.createElement('div'); legend.className = 'city-map-legend';
    for (const [tone, label] of [['R', 'บ้าน'], ['C', 'พาณิชย์'], ['I', 'โรงงาน'], ['F', 'ฟาร์ม'], ['road', 'ถนน'], ['gate', 'ประตูเมือง'], ['issue', 'มีปัญหา']] as const) {
      const item = document.createElement('span'); item.className = `city-map-key ${tone}`; item.textContent = label; legend.append(item);
    }
    this.mapCanvas.className = 'city-map-canvas';
    this.mapCanvas.addEventListener('pointermove', e => this.describe(cellAt(this.mapCanvas, e)));
    this.mapCanvas.addEventListener('click', e => { const cell = cellAt(this.mapCanvas, e); if (cell !== null) { this.toggleMap(false); this.onOpen(cell); } });
    this.mapInfo.className = 'city-map-info'; this.mapInfo.textContent = matchMedia('(pointer: coarse)').matches ? 'แตะช่องเพื่อเปิดข้อมูลสถานที่' : 'ชี้เพื่อดูว่าตรงนั้นคืออะไร · คลิกเพื่อเปิดข้อมูลสถานที่ · กด M หรือ Esc เพื่อปิด';
    this.map.append(bar, legend, this.mapCanvas, this.mapInfo); document.body.append(this.map);
  }
  get mapOpen() { return !this.map.hidden; }
  toggleMap(open = this.map.hidden) {
    this.map.hidden = !open;
    if (open && this.city) {
      const size = Math.max(260, Math.min(640, innerHeight - 220, innerWidth - (innerWidth < 600 ? 34 : 64)));
      const ctx = setupCanvas(this.mapCanvas, size); draw(ctx, this.city, size, { selected: this.selected, issues: this.issues, labels: true, view: this.view });
    }
  }
  update(city: City, selected: number | null) {
    const key = `${city.tick}:${city.buildings.length}:${city.cells.filter(c => c.road).length}:${selected}`;
    if (city !== this.city || key !== this.key) { this.issues = new Set(buildingIssues(city).map(i => i.cell)); }
    this.city = city; this.selected = selected; this.key = key; this.redraw(true);
    if (!this.map.hidden) this.toggleMap(true);
  }
  private camera = '';
  /** Called every frame: redraws only when the camera or the city changed. */
  redraw(force = false) {
    if (!this.city) return;
    const camera = `${this.view.target.x.toFixed(1)}:${this.view.target.z.toFixed(1)}:${this.view.yaw.toFixed(2)}:${this.view.radius.toFixed(0)}:${busMapRevision()}`;
    if (!force && camera === this.camera) return; this.camera = camera;
    draw(this.ctx, this.city, 152, { view: this.view, selected: this.selected, issues: this.issues });
    if (!this.map.hidden) this.toggleMap(true);
  }
  private describe(cell: number | null) {
    if (cell === null || !this.city) return;
    const c = this.city.cells[cell], col = cell % SIZE + 1, row = Math.floor(cell / SIZE) + 1, b = c.building === null ? null : this.city.buildings.find(v => v.id === c.building);
    const kind = c.road ? (cell === GATEWAY ? 'ประตูเมือง' : 'ถนน') : !c.zone ? 'ที่ดินว่าง' : b ? `${{ R: 'บ้าน', C: 'พาณิชย์', I: 'โรงงาน', F: 'ฟาร์ม' }[c.zone]} #${b.id} · ระดับ ${b.level}` : `โซน${{ R: 'บ้าน', C: 'พาณิชย์', I: 'โรงงาน', F: 'ฟาร์ม' }[c.zone]} (ว่าง)`;
    const bus = busCellNote(cell);
    this.mapInfo.textContent = `${col},${row} · ${kind}${this.issues.has(cell) ? ' · มีปัญหา' : ''}${bus ? ` · ${bus}` : ''}`;
  }
}
