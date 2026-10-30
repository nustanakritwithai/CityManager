/**
 * 2D bus overlay for the minimap and the full city map. Paints only a list the 3D renderer
 * published this frame. No engine, and nothing when `?bus=1` is off or `trafficLayer.bus` was missing.
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
  for (const stop of draw.stops) {
    const p = worldToCanvas(stop.x, stop.z, cellPx);
    const w = stop.kind === 'shelter' ? cellPx * 0.42 : cellPx * 0.16;
    const h = stop.kind === 'shelter' ? cellPx * 0.28 : cellPx * 0.16;
    ctx.fillStyle = stop.kind === 'shelter' ? '#f4f7fb' : '#d5dbe3';
    ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h);
    ctx.strokeStyle = '#243044'; ctx.lineWidth = 1; ctx.strokeRect(p.x - w / 2, p.y - h / 2, w, h);
  }
  for (const depot of draw.depots) {
    const p = worldToCanvas(depot.x, depot.z, cellPx), s = cellPx * 0.56;
    ctx.fillStyle = depot.open ? '#f2c14e' : '#8d887c';
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
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
  ctx.strokeStyle = seg.color;
  ctx.globalAlpha = seg.paused ? 0.45 : 0.9;
  ctx.lineWidth = Math.max(1.25, cellPx * (seg.paused ? 0.12 : 0.16));
  ctx.setLineDash(seg.paused ? [Math.max(2, cellPx * 0.35), Math.max(2, cellPx * 0.28)] : []);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

/** Hover text for a stop or depot cell. Null when the bus layer published nothing. */
export function busCellNote(cell: number): string | null {
  if (!busEnabled()) return null;
  const draw = publishedBusMap(); if (!draw) return null;
  const stop = draw.stops.find(item => item.cell === cell);
  if (stop) {
    const kind = stop.kind === 'shelter' ? 'ศาลา' : 'ป้ายเสา';
    return stop.waiting > 0 ? `${kind} · รอ ${stop.waiting}` : kind;
  }
  const depot = draw.depots.find(item => item.cell === cell);
  if (depot) return `อู่รถเมล์ ระดับ ${depot.level}${depot.open ? '' : ' · ปิด'}`;
  return null;
}
