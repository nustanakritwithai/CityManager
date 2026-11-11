/**
 * 2D bus overlay for the minimap and the full city map. Paints only a list the 3D renderer
 * published this frame. Saved stops and depots remain visible without a running traffic engine.
 */
import { busEnabled } from './types.ts';
import { BUS_BODY, cellCenter, worldToCanvas } from './geometry.ts';
import { publishedBusMap } from './map-state.ts';
import type { BusRibbon } from './overlay.ts';

export function paintBusOverlay(ctx: CanvasRenderingContext2D, cellPx: number, labels: boolean): void {
  if (!busEnabled()) return;
  const draw = publishedBusMap();
  if (!draw) return;
  ctx.save();
  for (const seg of draw.lines) strokeRibbon(ctx, seg, cellPx);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  // Stops: white discs with a bus-blue ring, numbered on the city map; riders waiting under them.
  const order = stopOrder(draw.stops);
  for (const stop of draw.stops) {
    const p = worldToCanvas(stop.x, stop.z, cellPx), r = Math.max(2.5, cellPx * (stop.kind === 'shelter' ? 0.3 : 0.24));
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f7fb'; ctx.fill(); ctx.lineWidth = Math.max(1.2, cellPx * 0.08); ctx.strokeStyle = '#2f8fd8'; ctx.stroke();
    if (labels || cellPx >= 10) {
      ctx.fillStyle = '#16314d'; ctx.font = `700 ${Math.max(6, r * 1.15)}px "IBM Plex Sans Thai", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(order.get(stop.id) ?? ''), p.x, p.y + 0.5);
    }
    if (labels && stop.waiting !== null && stop.waiting > 0) {
      // Waiting riders as a gold count badge on the stop's shoulder (building names sit above and below).
      const text = String(stop.waiting);
      ctx.font = `700 ${Math.max(8, cellPx * 0.26)}px "IBM Plex Sans Thai", sans-serif`;
      const bw = Math.max(r * 1.3, ctx.measureText(text).width + 6), bh = Math.max(10, cellPx * 0.34), bx = p.x + r * 0.55, by = p.y - r * 1.35;
      ctx.beginPath(); ctx.roundRect(bx, by - bh / 2, bw, bh, bh / 2); ctx.fillStyle = '#f3c46b'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#0f192e'; ctx.stroke();
      ctx.fillStyle = '#1d1405'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + bw / 2, by + 0.5);
    }
  }
  // Depots: pale garage tiles with a blue edge (grey when closed).
  for (const depot of draw.depots) {
    const p = worldToCanvas(depot.x, depot.z, cellPx), s = cellPx * 0.62;
    ctx.beginPath(); ctx.roundRect(p.x - s / 2, p.y - s / 2, s, s, s * 0.2);
    ctx.fillStyle = depot.open ? '#dfe6f0' : '#8d887c'; ctx.fill();
    ctx.lineWidth = Math.max(1.2, cellPx * 0.08); ctx.strokeStyle = depot.open ? '#2f8fd8' : '#5d5a52'; ctx.stroke();
    if (labels) { ctx.fillStyle = '#16314d'; ctx.font = `700 ${Math.max(8, s * 0.42)}px "IBM Plex Sans Thai", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('อู่', p.x, p.y + 0.5); }
  }
  for (const bus of draw.buses) {
    const p = worldToCanvas(bus.x, bus.z, cellPx);
    const w = Math.max(2, cellPx * 0.22), h = Math.max(3, cellPx * (0.28 + (bus.level - 1) * 0.08));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(bus.headingX, bus.headingZ));
    ctx.fillStyle = BUS_BODY[bus.level].color;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    if (bus.load > 0) { ctx.fillStyle = '#ffe08a'; ctx.fillRect(-w * 0.2, -h / 2, w * 0.18, h * bus.load); }
    ctx.restore();
  }
  if (labels) {
    ctx.font = `600 ${Math.max(9, cellPx * 0.28)}px "IBM Plex Sans Thai", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(15, 25, 46, .85)';
    draw.captions.forEach((caption, index) => {
      const world = cellCenter(caption.cell), p = worldToCanvas(world.x, world.z, cellPx);
      const y = p.y - cellPx * 0.55 - index * 11;
      ctx.strokeText(caption.text, p.x, y);
      ctx.fillStyle = caption.paused ? '#c9c3b8' : caption.color;
      ctx.fillText(caption.text, p.x, y);
    });
  }
  ctx.restore();
}

function strokeRibbon(ctx: CanvasRenderingContext2D, seg: BusRibbon, cellPx: number) {
  const a = worldToCanvas(seg.x - seg.headingX * seg.length / 2, seg.z - seg.headingZ * seg.length / 2, cellPx);
  const b = worldToCanvas(seg.x + seg.headingX * seg.length / 2, seg.z + seg.headingZ * seg.length / 2, cellPx);
  const width = Math.max(1.6, cellPx * (seg.paused ? 0.14 : 0.22));
  ctx.setLineDash(seg.paused ? [Math.max(2, cellPx * 0.35), Math.max(2, cellPx * 0.28)] : []);
  // A dark casing under the line colour keeps it readable over roads and zones.
  ctx.globalAlpha = seg.paused ? 0.35 : 0.75; ctx.strokeStyle = '#0f192e'; ctx.lineWidth = width + Math.max(1.5, cellPx * 0.08);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.globalAlpha = seg.paused ? 0.5 : 1; ctx.strokeStyle = seg.color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

/** Hover text for a stop or depot cell. Null when the bus layer published nothing. */
export function busCellNote(cell: number): string | null {
  if (!busEnabled()) return null;
  const draw = publishedBusMap(); if (!draw) return null;
  const stop = draw.stops.find(item => item.cell === cell);
  if (stop) return `ป้ายรถเมล์ ${stopOrder(draw.stops).get(stop.id)} · ${stop.kind === 'shelter' ? 'ศาลา' : 'ป้ายเสา'}${stop.waiting === null ? '' : ` · รอ ${stop.waiting} คน`}`;
  const depot = draw.depots.find(item => item.cell === cell);
  if (depot) return `อู่รถเมล์ · ระดับ ${depot.level}${depot.open ? '' : ' · ปิด'}`;
  return null;
}

/** Stop numbers for the map: 1, 2, 3… by stop id, so a stop keeps its number as others are added. */
export function stopOrder(stops: readonly { id: number }[]): Map<number, number> {
  return new Map([...stops].map(stop => stop.id).sort((a, b) => a - b).map((id, index) => [id, index + 1]));
}
