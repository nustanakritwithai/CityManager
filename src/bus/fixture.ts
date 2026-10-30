/**
 * Static snapshots for renderer tests and for a dev preview when no engine is attached.
 * Not movement: progress is fixed. The live map uses `trafficLayer.bus.engine.snapshot()` instead.
 */
import type { BusSnapshot } from './types.ts';

export function fixtureBusSnapshots(): BusSnapshot[] {
  return [
    Object.freeze({ id: 'fix-l1', lineId: 1, phase: 'running', cell: 0, next: 1, progress: 0.25, persons: 10, capacity: 40 }),
    Object.freeze({ id: 'fix-l2', lineId: 1, phase: 'running', cell: 24, next: 48, progress: 0.5, persons: 30, capacity: 60 }),
    Object.freeze({ id: 'fix-l3', lineId: 1, phase: 'dwelling', cell: 50, next: 50, progress: 0, persons: 40, capacity: 80 }),
    Object.freeze({ id: 'fix-home-a', lineId: 1, phase: 'home', cell: 10, next: 10, progress: 0, persons: 0, capacity: 40 }),
    Object.freeze({ id: 'fix-home-b', lineId: 1, phase: 'home', cell: 10, next: 10, progress: 0, persons: 0, capacity: 40 }),
    Object.freeze({ id: 'fix-start', lineId: 2, phase: 'toStart', cell: 2, next: 3, progress: 0, persons: 0, capacity: 40 }),
  ];
}
