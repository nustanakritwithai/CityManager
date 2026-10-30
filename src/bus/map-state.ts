/** Last draw list the renderer published for the 2D map. Null means draw nothing. */
import type { BusDrawList } from './draw-list.ts';

let current: BusDrawList | null = null;
let revision = 0;
export function publishBusMap(draw: BusDrawList | null): void {
  if (draw === null && current === null) return;
  current = draw;
  revision++;
}
export function publishedBusMap(): BusDrawList | null { return current; }
/** Bumps when a frame actually changes the published overlay, so the minimap can redraw. */
export function busMapRevision(): number { return revision; }
