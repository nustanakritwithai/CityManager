/**
 * "เครือข่ายเมือง": the city's variables as a slowly turning 3D web. Node chips are real buttons
 * placed over a canvas that draws the links, the ambient flow along them and the pulses an
 * action sends down the chain. Read-only over City.
 */
import './city-network.css';
import {
  EDGES, GROUPS, GROUP_ORDER, NODES, NODE_BY_ID, cascade, cascadeRoots, formatNode, neighbours, networkChanges, networkEvents,
  networkSnapshot, networkValues, pastSnapshot, whatIf, type NetEdge, type NetEvent, type NetPulse, type NetSnapshot, type NetValues,
} from './city-network.ts';
import { layoutNetwork, type Vec3 } from './network-layout.ts';
import { iconElement } from './ui-icons.ts';
import type { City } from './sim.ts';

const POS: Record<string, Vec3> = layoutNetwork(NODES, EDGES, GROUP_ORDER);
const CAMERA = 3.4, HOP_MS = 620, TRAVEL_MS = 900, PING_MS = 900, FEED_SIZE = 8;
const FALLBACK: Record<number, string> = { 1: '#3987e5', 4: '#c98500', 5: '#d55181', 6: '#008300' };
const UP = '#ffe7a3', DOWN = '#ff8f7f', SAME = 'rgba(214, 232, 226, A)', OPPOSITE = 'rgba(255, 143, 127, A)';

type Projected = { x: number; y: number; s: number; d: number };
type LivePulse = NetPulse & { start: number };
type Ping = { id: string; start: number; effect: 1 | -1 };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
}
const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const mid = (a: Vec3, b: Vec3, k: number): Vec3 => ({ x: (a.x + b.x) / 2 * k, y: (a.y + b.y) / 2 * k, z: (a.z + b.z) / 2 * k });
const quad = (a: number, c: number, b: number, t: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;

export class CityNetworkView {
  private readonly root = el('div', 'city-net');
  private readonly stage = el('div', 'net-stage');
  private readonly canvas = el('canvas', 'net-canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly layer = el('div', 'net-nodes');
  private readonly caption = el('div', 'net-caption');
  private readonly side = el('aside', 'net-side');
  private readonly stamp = el('span', 'net-stamp');
  private readonly announcer = el('p', 'net-announce');
  private readonly detail = el('section', 'net-detail');
  private readonly feedBox = el('section', 'net-feed');
  private readonly index = el('section', 'net-index');
  private readonly autoButton = el('button', 'net-tool');
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly valueText = new Map<string, HTMLElement>();
  private readonly colors = new Map<string, string>();
  private readonly projected = new Map<string, Projected>();
  private values: NetValues = {};
  private before: NetValues | null = null;
  private snapshot: NetSnapshot | null = null;
  private city: City | null = null;
  private key = '';
  private feed: NetEvent[] = [];
  private pulses: LivePulse[] = [];
  private pings: Ping[] = [];
  private reached = new Map<string, 1 | -1>();
  private reachedUntil = 0;
  private selected: string | null = null;
  private hovered: string | null = null;
  private yaw = -0.7; private pitch = 0.28; private zoom = 1; private spinX = 0; private spinY = 0;
  private aim: { yaw: number; pitch: number } | null = null;
  private auto = true;
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; zoom: number } | null = null;
  private quietUntil = 0;
  private captionUntil = 0;
  private flowClock = 0;
  private raf = 0;
  private last = 0;
  private width = 0; private height = 0; private dpr = 1;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  open = false;

  constructor(private readonly isPaused: () => boolean, private readonly onToggle: (open: boolean) => void = () => {}) {
    this.root.id = 'city-network'; this.root.hidden = true; this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', 'เครือข่ายเมือง');
    const bar = el('header', 'net-bar'), title = el('h2', 'net-title'), close = el('button', 'net-close', '✕');
    title.append(iconElement('network', 'ui-icon net-title-icon'), document.createTextNode('เครือข่ายเมือง'));
    this.autoButton.type = 'button'; this.autoButton.append(iconElement('rotate-right')); this.autoButton.title = 'หมุนเอง'; this.autoButton.setAttribute('aria-label', 'หมุนเอง');
    this.autoButton.addEventListener('click', () => { this.auto = !this.auto; this.syncAuto(); });
    const reset = el('button', 'net-tool'); reset.type = 'button'; reset.append(iconElement('home')); reset.title = 'มุมเริ่มต้น'; reset.setAttribute('aria-label', 'กลับมุมเริ่มต้น');
    reset.addEventListener('click', () => { this.aim = { yaw: -0.7, pitch: 0.28 }; this.zoom = 1; });
    close.type = 'button'; close.id = 'close-city-network'; close.setAttribute('aria-label', 'ปิดเครือข่ายเมือง'); close.addEventListener('click', () => this.toggle(false));
    bar.append(title, this.stamp, this.autoButton, reset, close);
    this.stage.tabIndex = 0; this.stage.setAttribute('aria-label', 'แผนภาพเครือข่าย ลากหรือกดลูกศรเพื่อหมุน');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.layer.setAttribute('role', 'group'); this.layer.setAttribute('aria-label', 'ตัวแปรของเมือง');
    for (const node of NODES) {
      const button = el('button', 'net-node'), orb = el('span', 'net-orb'), name = el('span', 'net-name', node.label), value = el('span', 'net-value');
      button.type = 'button'; button.dataset.node = node.id; button.dataset.group = node.group; button.style.setProperty('--c', `var(--series-${GROUPS[node.group].slot})`);
      orb.append(iconElement(node.icon)); button.append(orb, name, value);
      button.addEventListener('click', () => { if (performance.now() < this.quietUntil) return; this.select(this.selected === node.id ? null : node.id); });
      button.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') this.hovered = node.id; });
      button.addEventListener('pointerleave', () => { if (this.hovered === node.id) this.hovered = null; });
      button.addEventListener('focus', () => { this.hovered = node.id; });
      button.addEventListener('blur', () => { if (this.hovered === node.id) this.hovered = null; });
      this.buttons.set(node.id, button); this.valueText.set(node.id, value); this.layer.append(button);
    }
    this.caption.hidden = true;
    const legend = el('div', 'net-legend');
    for (const group of GROUP_ORDER) { const key = el('span', 'net-key', GROUPS[group].label); key.style.setProperty('--c', `var(--series-${GROUPS[group].slot})`); legend.append(key); }
    legend.append(el('span', 'net-key same', 'ไปทางเดียวกัน'), el('span', 'net-key opposite', 'ไปทางตรงข้าม'), el('span', 'net-key pulse', 'ผลที่ส่งต่อ'));
    const hint = el('p', 'net-hint', 'ลากเพื่อหมุน · แตะจุดเพื่อดูว่าเชื่อมกับอะไร');
    this.stage.append(this.canvas, this.layer, this.caption, legend, hint);
    this.announcer.setAttribute('aria-live', 'polite');
    this.index.append(el('h3', '', 'ตัวแปรทั้งหมด'));
    for (const group of GROUP_ORDER) {
      const row = el('div', 'net-index-row'); row.style.setProperty('--c', `var(--series-${GROUPS[group].slot})`); row.append(el('span', 'net-index-group', GROUPS[group].label));
      for (const node of NODES.filter(n => n.group === group)) { const chip = el('button', 'net-chip', node.label); chip.type = 'button'; chip.addEventListener('click', () => this.select(node.id)); row.append(chip); }
      this.index.append(row);
    }
    this.side.append(this.detail, this.feedBox, this.index, this.table());
    const main = el('div', 'net-main'); main.append(this.stage, this.side);
    this.root.append(bar, main, this.announcer); document.body.append(this.root);
    this.bindStage();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.syncAuto();
  }

  toggle(open = !this.open) {
    if (open === this.open) return;
    this.open = open; this.root.hidden = !open; this.onToggle(open);
    if (open) {
      this.key = ''; this.before = null; this.pulses = []; this.pings = [];
      const style = getComputedStyle(document.documentElement);
      for (const group of GROUP_ORDER) { const slot = GROUPS[group].slot; this.colors.set(group, style.getPropertyValue(`--series-${slot}`).trim() || FALLBACK[slot]); }
      if (this.city) this.update(this.city);
      this.renderSide(); this.resize(); this.last = performance.now(); this.raf = requestAnimationFrame(t => this.frame(t));
      this.stage.focus({ preventScroll: true });
    } else cancelAnimationFrame(this.raf);
  }

  /** Called on every render; does work only while open and only when the city moved. */
  update(city: City) {
    const fresh = city !== this.city; this.city = city;
    if (!this.open) return;
    const key = `${city.tick}:${city.ledger.length}:${city.buildings.length}:${city.households.length}:${city.cells.reduce((n, c) => n + (c.road ? 1 : 0), 0)}`;
    if (!fresh && key === this.key) return;
    this.key = key;
    const values = networkValues(city), now = performance.now();
    if (fresh || !this.before || !this.snapshot) {
      // A new or reloaded city: start from the last 30 days without replaying them.
      this.feed = networkEvents(pastSnapshot(city, 30), city).slice(-FEED_SIZE);
      this.pulses = []; this.pings = [];
    } else {
      const changed = networkChanges(this.before, values), events = networkEvents(this.snapshot, city);
      const seeds = events.length ? [...new Set(events.map(e => e.node))] : cascadeRoots(changed).filter(id => NODE_BY_ID.get(id)!.kind === 'count');
      if (seeds.length) {
        for (const id of seeds) this.pings.push({ id, start: now, effect: (changed.get(id) ?? 1) > 0 ? 1 : -1 });
        const pulses = cascade(seeds, changed);
        for (const p of pulses) this.pulses.push({ ...p, start: now + p.hop * HOP_MS });
        for (const p of pulses) this.pings.push({ id: p.edge.to, start: now + p.hop * HOP_MS + TRAVEL_MS, effect: p.effect });
        if (this.pulses.length > 90) this.pulses.splice(0, this.pulses.length - 90);
        if (this.pings.length > 60) this.pings.splice(0, this.pings.length - 60);
        for (const [id, delta] of changed) this.badge(id, delta, seeds.includes(id) ? 0 : (pulses.find(p => p.edge.to === id)?.hop ?? 0) * HOP_MS + TRAVEL_MS);
        this.showCaption(events.at(-1) ?? null, seeds, pulses);
      }
      if (events.length) { this.feed = [...this.feed, ...events].slice(-FEED_SIZE); if (!this.selected) this.renderFeed(); }
    }
    this.before = values; this.values = values; this.snapshot = networkSnapshot(city);
    this.stamp.textContent = `วันที่ ${city.tick}`;
    for (const node of NODES) {
      const text = formatNode(node, values[node.id] ?? 0, true), button = this.buttons.get(node.id)!;
      if (this.valueText.get(node.id)!.textContent !== text) this.valueText.get(node.id)!.textContent = text;
      button.setAttribute('aria-label', `${node.label} ${formatNode(node, values[node.id] ?? 0)}`);
      button.classList.toggle('is-empty', !values[node.id] && node.kind !== 'flag');
      button.classList.toggle('is-off', node.kind === 'flag' && !values[node.id]);
    }
    if (fresh && !this.selected) this.renderFeed();
    if (this.selected) this.refreshDetail();
  }

  private select(id: string | null) {
    this.selected = id;
    for (const [key, button] of this.buttons) button.setAttribute('aria-pressed', String(key === id));
    if (id) {
      const p = POS[id], yaw = Math.atan2(-p.x, p.z), pitch = Math.max(-1.1, Math.min(1.1, Math.atan2(p.y, Math.hypot(p.x, p.z))));
      this.aim = { yaw, pitch };
    }
    this.reached.clear(); this.renderSide();
    if (id) this.announcer.textContent = `${NODE_BY_ID.get(id)!.label}: รับผลจาก ${neighbours(id).incoming.length} · ส่งผลต่อ ${neighbours(id).outgoing.length}`;
  }

  /** "If this rose": play every downstream link once, with ▲/▼ on what it would move. */
  private play(id: string) {
    const now = performance.now(), { pulses, reached } = whatIf(id);
    this.pulses = pulses.map(p => ({ ...p, start: now + p.hop * HOP_MS }));
    this.pings = [{ id, start: now, effect: 1 }, ...pulses.map(p => ({ id: p.edge.to, start: now + p.hop * HOP_MS + TRAVEL_MS, effect: p.effect }))];
    this.reached = reached; this.reachedUntil = now + 3 * HOP_MS + TRAVEL_MS + 4000;
    const node = NODE_BY_ID.get(id)!, up = [...reached].filter(([k, v]) => k !== id && v > 0).length, down = [...reached].filter(([, v]) => v < 0).length;
    this.caption.hidden = false; this.captionUntil = now + 7000; this.caption.replaceChildren(
      el('strong', '', `ถ้า${node.label}เพิ่มขึ้น`), el('span', 'net-caption-path', `ส่งผลต่อ ${reached.size - 1} ตัวแปร · ▲ ${up} · ▼ ${down}`));
    this.announcer.textContent = `ถ้า${node.label}เพิ่มขึ้น จะส่งผลให้ ${up} ตัวแปรเพิ่ม และ ${down} ตัวแปรลด`;
  }

  private showCaption(event: NetEvent | null, seeds: string[], pulses: NetPulse[]) {
    const first = seeds[0], label = event ? event.text : `${NODE_BY_ID.get(first)?.label ?? ''} เปลี่ยน`;
    const path = pulses.filter(p => p.hop === 0).slice(0, 4).map(p => `${NODE_BY_ID.get(p.edge.to)!.label} ${p.effect > 0 ? '▲' : '▼'}`).join(' · ');
    this.caption.hidden = false; this.captionUntil = performance.now() + 4500; this.caption.replaceChildren(el('strong', '', label), ...(path ? [el('span', 'net-caption-path', `→ ${path}`)] : []));
  }

  private badge(id: string, delta: number, delay: number) {
    const node = NODE_BY_ID.get(id)!, button = this.buttons.get(id)!;
    const value = node.unit === '฿' ? delta / 100 : delta, text = node.kind === 'flag' ? (delta > 0 ? 'พร้อม' : 'ขาด') : `${delta > 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString('th-TH')}${node.unit === '฿' ? ' ฿' : ''}`;
    const tag = el('span', `net-delta ${delta > 0 ? 'up' : 'down'}`, text); tag.setAttribute('aria-hidden', 'true'); tag.style.animationDelay = `${Math.round(delay)}ms`;
    tag.addEventListener('animationend', () => tag.remove());
    button.querySelectorAll('.net-delta').forEach(old => old.remove());
    button.append(tag);
  }

  private renderSide() {
    const id = this.selected;
    this.detail.hidden = !id; this.feedBox.hidden = this.index.hidden = !!id;
    if (!id) { this.renderFeed(); return; }
    const node = NODE_BY_ID.get(id)!, { incoming, outgoing } = neighbours(id);
    this.detail.style.setProperty('--c', `var(--series-${GROUPS[node.group].slot})`);
    const head = el('header', 'net-detail-head'), orb = el('span', 'net-orb'); orb.append(iconElement(node.icon));
    const titles = el('div'); titles.append(el('h3', '', node.label), el('span', 'net-group', GROUPS[node.group].label + (node.kind === 'flow' ? ' · รวม 30 วัน' : '')));
    const back = el('button', 'net-back', '✕'); back.type = 'button'; back.setAttribute('aria-label', 'เลิกเลือก'); back.addEventListener('click', () => this.select(null));
    head.append(orb, titles, back);
    const play = el('button', 'net-play'); play.type = 'button'; play.append(iconElement('arrow-right'), document.createTextNode('ดูผลต่อเนื่อง'));
    play.addEventListener('click', () => this.play(id));
    this.detail.replaceChildren(head, el('p', 'net-big'), play, this.linkList('ได้รับผลจาก', incoming, 'from'), this.linkList('ส่งผลต่อ', outgoing, 'to'));
    this.refreshDetail();
  }
  private refreshDetail() {
    const id = this.selected, big = this.detail.querySelector<HTMLElement>('.net-big'); if (!id || !big) return;
    const text = formatNode(NODE_BY_ID.get(id)!, this.values[id] ?? 0); if (big.textContent !== text) big.textContent = text;
  }
  private linkList(title: string, edges: NetEdge[], end: 'from' | 'to') {
    const box = el('section', 'net-links'); box.append(el('h4', '', `${title} · ${edges.length}`));
    const list = el('ul');
    for (const edge of edges) {
      const other = NODE_BY_ID.get(edge[end])!, item = el('li'), chip = el('button', 'net-chip'), sign = el('span', `net-sign ${edge.sign > 0 ? 'same' : 'opposite'}`, edge.sign > 0 ? '+' : '−');
      chip.type = 'button'; chip.style.setProperty('--c', `var(--series-${GROUPS[other.group].slot})`); chip.append(iconElement(other.icon), document.createTextNode(other.label));
      chip.addEventListener('click', () => this.select(other.id));
      sign.title = edge.sign > 0 ? 'ไปทางเดียวกัน' : 'ไปทางตรงข้าม';
      item.append(sign, chip, el('p', 'net-why', edge.why)); list.append(item);
    }
    box.append(list); return box;
  }
  private renderFeed() {
    if (this.selected || !this.open) return;
    const list = el('ol');
    for (const event of [...this.feed].reverse()) {
      const node = NODE_BY_ID.get(event.node)!, item = el('li'), button = el('button', 'net-event');
      button.type = 'button'; button.style.setProperty('--c', `var(--series-${GROUPS[node.group].slot})`);
      const icon = el('span', 'net-event-icon'); icon.append(iconElement(event.icon));
      button.append(icon, el('span', 'net-event-text', event.text), el('span', 'net-event-day', `วันที่ ${event.tick}`));
      button.addEventListener('click', () => { this.select(event.node); this.play(event.node); });
      item.append(button); list.append(item);
    }
    this.feedBox.replaceChildren(el('h3', '', 'เกิดอะไรขึ้นล่าสุด'), this.feed.length ? list : el('p', 'net-empty', 'เล่นเวลาหรือสร้างถนน แล้วดูผลวิ่งไปตามเส้น'));
  }
  /** Every link as a table, for reading without the picture. */
  private table() {
    const details = el('details', 'net-table'), summary = el('summary', '', `ดูเป็นตาราง · ${EDGES.length} เส้น`), table = el('table'), head = el('tr');
    for (const label of ['จาก', '', 'ไปยัง', 'เพราะ']) head.append(el('th', '', label));
    const thead = el('thead'); thead.append(head); const tbody = el('tbody');
    for (const e of EDGES) { const tr = el('tr'); tr.append(el('td', '', NODE_BY_ID.get(e.from)!.label), el('td', `net-sign ${e.sign > 0 ? 'same' : 'opposite'}`, e.sign > 0 ? '+' : '−'), el('td', '', NODE_BY_ID.get(e.to)!.label), el('td', '', e.why)); tbody.append(tr); }
    table.append(thead, tbody); details.append(summary, table); return details;
  }
  private syncAuto() { this.autoButton.setAttribute('aria-pressed', String(this.auto)); this.autoButton.classList.toggle('on', this.auto); }

  private bindStage() {
    const stage = this.stage;
    stage.addEventListener('pointerdown', e => {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) { const [a, b] = [...this.touches.values()]; this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom }; this.drag = null; return; }
      if (e.button === 0) this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    });
    stage.addEventListener('pointermove', e => {
      const touch = this.touches.get(e.pointerId); if (touch) { touch.x = e.clientX; touch.y = e.clientY; }
      if (this.pinch && this.touches.size === 2) { const [a, b] = [...this.touches.values()]; this.zoom = Math.max(0.6, Math.min(2.2, this.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, this.pinch.distance))); return; }
      const d = this.drag; if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 6) return;
      if (!d.moved) { d.moved = true; stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); }
      this.aim = null; this.spinX = dx * 0.0085; this.spinY = dy * 0.0085;
      this.yaw += this.spinX; this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch + this.spinY)); d.x = e.clientX; d.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      this.touches.delete(e.pointerId); if (this.touches.size < 2) this.pinch = null;
      if (this.drag?.id !== e.pointerId) return;
      if (this.drag.moved) this.quietUntil = performance.now() + 80;
      this.drag = null; stage.classList.remove('dragging');
    };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    stage.addEventListener('click', e => { if (performance.now() < this.quietUntil || (e.target as Element).closest('.net-node, .net-legend, .net-caption')) return; if (this.selected) this.select(null); });
    stage.addEventListener('wheel', e => { e.preventDefault(); this.zoom = Math.max(0.6, Math.min(2.2, this.zoom * Math.exp(-e.deltaY * 0.0015))); }, { passive: false });
    stage.addEventListener('keydown', e => {
      const turn: Record<string, [number, number]> = { ArrowLeft: [-0.16, 0], ArrowRight: [0.16, 0], ArrowUp: [0, -0.16], ArrowDown: [0, 0.16] };
      if (turn[e.key]) { e.preventDefault(); e.stopPropagation(); this.aim = null; this.yaw += turn[e.key][0]; this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch + turn[e.key][1])); }
      else if (e.key === '+' || e.key === '=') { e.stopPropagation(); this.zoom = Math.min(2.2, this.zoom * 1.12); }
      else if (e.key === '-') { e.stopPropagation(); this.zoom = Math.max(0.6, this.zoom / 1.12); }
    });
  }

  private resize() {
    const r = this.stage.getBoundingClientRect(); if (!r.width || !r.height) return;
    this.dpr = Math.min(2, devicePixelRatio || 1); this.width = r.width; this.height = r.height;
    this.canvas.width = Math.round(r.width * this.dpr); this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = `${r.width}px`; this.canvas.style.height = `${r.height}px`;
  }

  private project(p: Vec3, radius: number): Projected {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const x1 = p.x * cy + p.z * sy, z1 = -p.x * sy + p.z * cy, y2 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp, s = CAMERA / (CAMERA - z2);
    return { x: this.width / 2 + x1 * radius * s, y: this.height / 2 - y2 * radius * s, s, d: (z2 + 1) / 2 };
  }

  private frame(t: number) {
    if (!this.open) return;
    const dt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
    const reduced = this.reduced.matches;
    if (this.aim) {
      const k = reduced ? 1 : Math.min(1, dt * 5);
      this.yaw += wrap(this.aim.yaw - this.yaw) * k; this.pitch += (this.aim.pitch - this.pitch) * k;
      if (Math.abs(wrap(this.aim.yaw - this.yaw)) < 0.002 && Math.abs(this.aim.pitch - this.pitch) < 0.002) this.aim = null;
    } else if (!this.drag) {
      this.yaw += this.spinX; this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch + this.spinY)); this.spinX *= 0.9; this.spinY *= 0.9;
      if (this.auto && !reduced && !this.selected && !this.hovered && Math.abs(this.spinX) < 0.001) this.yaw += dt * 0.09;
    }
    if (!this.isPaused() && !reduced) this.flowClock += dt;
    const radius = Math.min(this.width, this.height) * (this.width < 560 ? 0.36 : 0.38) * this.zoom;
    for (const node of NODES) this.projected.set(node.id, this.project(POS[node.id], radius));
    if (this.reached.size && t > this.reachedUntil) this.reached.clear();
    if (!this.caption.hidden && t > this.captionUntil) this.caption.hidden = true;
    this.draw(t, radius);
    this.place();
    this.raf = requestAnimationFrame(next => this.frame(next));
  }

  private focus() { return this.hovered ?? this.selected; }

  private draw(now: number, radius: number) {
    const ctx = this.ctx, focus = this.focus();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.width, this.height);
    // Guide rings: an equator and two meridians that turn with the web.
    ctx.lineWidth = 1;
    for (const ring of [0, 1, 2]) {
      let prev: Projected | null = null;
      for (let i = 0; i <= 72; i++) {
        const a = i / 72 * Math.PI * 2, r = 1.12, p = ring === 0 ? { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r } : ring === 1 ? { x: Math.cos(a) * r, y: Math.sin(a) * r, z: 0 } : { x: 0, y: Math.sin(a) * r, z: Math.cos(a) * r };
        const q = this.project(p, radius);
        if (prev) { ctx.strokeStyle = `rgba(190, 225, 215, ${0.03 + 0.09 * q.d})`; ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
        prev = q;
      }
    }
    const live = new Set(this.pulses.filter(p => now >= p.start && now < p.start + TRAVEL_MS + 500).map(p => p.edge));
    const order = [...EDGES].sort((a, b) => this.edgeDepth(a) - this.edgeDepth(b));
    for (const edge of order) {
      const a = this.projected.get(edge.from)!, b = this.projected.get(edge.to)!, c = this.project(mid(POS[edge.from], POS[edge.to], 1.28), radius);
      const near = focus !== null && (edge.from === focus || edge.to === focus), depth = Math.min(a.d, b.d);
      let alpha = focus ? (near ? 0.92 : 0.05) : 0.1 + 0.32 * depth;
      if (live.has(edge)) alpha = Math.max(alpha, 0.55);
      ctx.strokeStyle = (edge.sign > 0 ? SAME : OPPOSITE).replace('A', alpha.toFixed(3));
      ctx.lineWidth = near ? 2 : 1 + depth * 0.6; ctx.setLineDash(edge.sign > 0 ? [] : [5, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      if (near || depth > 0.45) this.arrow(a, c, b, alpha, edge.sign);
      // Ambient flow: dots along links that carry a real 30-day volume.
      if (edge.stream && !focus) {
        const raw = this.values[edge.stream] ?? 0, volume = NODE_BY_ID.get(edge.stream)!.unit === '฿' ? raw / 100 : raw;
        const dots = volume > 0 ? 1 + Math.min(3, Math.floor(Math.log10(1 + volume))) : 0, colour = this.colors.get(NODE_BY_ID.get(edge.from)!.group)!;
        for (let k = 0; k < dots; k++) {
          const u = (this.flowClock * 0.22 + k / dots + (edge.from.length * 0.137 + edge.to.length * 0.071)) % 1;
          ctx.globalAlpha = 0.25 + 0.55 * depth; ctx.fillStyle = colour;
          ctx.beginPath(); ctx.arc(quad(a.x, c.x, b.x, u), quad(a.y, c.y, b.y, u), 1.6 + depth * 1.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
    // Pulses travelling down the chain.
    this.pulses = this.pulses.filter(p => now < p.start + TRAVEL_MS + 500);
    for (const p of this.pulses) {
      if (now < p.start) continue;
      const a = this.projected.get(p.edge.from)!, b = this.projected.get(p.edge.to)!, c = this.project(mid(POS[p.edge.from], POS[p.edge.to], 1.28), radius);
      const u = Math.min(1, (now - p.start) / TRAVEL_MS), e = ease(u), fade = u < 1 ? 1 : 1 - (now - p.start - TRAVEL_MS) / 500, colour = p.effect > 0 ? UP : DOWN;
      ctx.globalAlpha = 0.85 * fade; ctx.strokeStyle = colour; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      for (let i = 1; i <= 16; i++) { const v = e * i / 16; ctx.lineTo(quad(a.x, c.x, b.x, v), quad(a.y, c.y, b.y, v)); }
      ctx.stroke();
      if (u < 1) {
        const x = quad(a.x, c.x, b.x, e), y = quad(a.y, c.y, b.y, e), glow = ctx.createRadialGradient(x, y, 0, x, y, 11);
        glow.addColorStop(0, colour); glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Pings where a change lands.
    this.pings = this.pings.filter(p => now < p.start + PING_MS);
    for (const p of this.pings) {
      if (now < p.start) continue;
      const q = this.projected.get(p.id)!, u = (now - p.start) / PING_MS;
      ctx.strokeStyle = p.effect > 0 ? UP : DOWN; ctx.globalAlpha = 1 - u; ctx.lineWidth = 2.5 * (1 - u) + 0.5;
      ctx.beginPath(); ctx.arc(q.x, q.y, (16 + u * 26) * q.s * (this.width < 560 ? 0.8 : 1), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  private edgeDepth(e: NetEdge) { return Math.min(this.projected.get(e.from)!.d, this.projected.get(e.to)!.d); }
  private arrow(a: Projected, c: { x: number; y: number }, b: Projected, alpha: number, sign: 1 | -1) {
    const ctx = this.ctx, u = 0.8, x = quad(a.x, c.x, b.x, u), y = quad(a.y, c.y, b.y, u);
    const dx = 2 * (1 - u) * (c.x - a.x) + 2 * u * (b.x - c.x), dy = 2 * (1 - u) * (c.y - a.y) + 2 * u * (b.y - c.y), l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, size = 4.5 * b.s;
    ctx.fillStyle = ctx.strokeStyle = (sign > 0 ? SAME : OPPOSITE).replace('A', Math.min(1, alpha + 0.1).toFixed(3));
    if (sign > 0) { ctx.beginPath(); ctx.moveTo(x + ux * size, y + uy * size); ctx.lineTo(x - ux * size - uy * size * 0.7, y - uy * size + ux * size * 0.7); ctx.lineTo(x - ux * size + uy * size * 0.7, y - uy * size - ux * size * 0.7); ctx.closePath(); ctx.fill(); }
    else { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - uy * size, y + ux * size); ctx.lineTo(x + uy * size, y - ux * size); ctx.stroke(); }
  }

  /** Move the node buttons to their projected spots; nearer nodes sit on top and read larger. */
  private place() {
    const focus = this.focus(), near = new Set<string>();
    if (focus) { near.add(focus); for (const e of EDGES) { if (e.from === focus) near.add(e.to); if (e.to === focus) near.add(e.from); } }
    const small = this.width < 560;
    for (const [id, button] of this.buttons) {
      const p = this.projected.get(id)!, scale = (small ? 0.62 : 0.72) + p.d * (small ? 0.3 : 0.36);
      button.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      button.style.zIndex = String(id === focus ? 300 : near.has(id) ? 200 + Math.round(p.d * 99) : Math.round(p.d * 99));
      button.style.setProperty('--depth', p.d.toFixed(3));
      button.classList.toggle('is-far', p.d < 0.34 && !near.has(id));
      button.classList.toggle('is-dim', !!focus && !near.has(id));
      button.classList.toggle('is-near', !!focus && near.has(id) && id !== focus);
      button.classList.toggle('is-focus', id === focus);
      const effect = this.reached.get(id); button.dataset.effect = effect === undefined || id === this.selected ? '' : effect > 0 ? 'up' : 'down';
    }
  }
}
