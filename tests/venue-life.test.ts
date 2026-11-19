import { test } from 'node:test';
import assert from 'node:assert/strict';
import { civicFeeReason, type CivicSite } from '../src/civic/sites.ts';
import { HEARING, MAX_FIGURES, VISITORS_PER_FIGURE, venueCrowds, venueSounds } from '../src/venue-life.ts';
import type { City } from '../src/sim.ts';

const staffed = { allocations: [{ householdId: 1, skill: 'basic', workers: 2 }], workDays: {} } as unknown as CivicSite['staffing'];
const site = (id: number, kind: CivicSite['kind'], cell: number, open = true): CivicSite => ({ id, kind, cell, tick: 0, ...(open ? { staffing: staffed } : {}) });
const fee = (kind: CivicSite['kind'], id: number, tick: number) => ({ tick, from: 'household:1', to: 'treasury', amount: 4_000, reason: civicFeeReason(kind, id) });

test('crowds follow today’s visitor fees, are capped and stay empty at closed venues', () => {
  const sites = [site(1, 'stadium', 10), site(2, 'cinema', 20), site(3, 'concert', 30, false), site(4, 'temple', 40)];
  const ledger = [fee('stadium', 1, 4), ...Array.from({ length: 5 }, () => fee('stadium', 1, 5)), ...Array.from({ length: 40 }, () => fee('cinema', 2, 5)), fee('concert', 3, 5)];
  const crowds = venueCrowds({ tick: 5, ledger, civic: { version: 1, sites } } as unknown as City);
  assert.equal(crowds.get(1), Math.ceil(5 / VISITORS_PER_FIGURE), 'yesterday’s visit is not counted');
  assert.equal(crowds.get(2), MAX_FIGURES);
  assert.equal(crowds.has(3), false, 'a closed venue has no crowd');
  assert.equal(crowds.has(4), false, 'a temple is not a crowd venue');
  assert.equal(venueCrowds({ tick: 5, ledger: [], civic: undefined } as unknown as City).size, 0);
});

test('venue sounds come from the nearest open venue busy at this time of day, scaled by zoom', () => {
  const at = (cell: number) => ({ x: cell, z: 0 });
  const sites = [site(1, 'stadium', 0), site(2, 'nightmarket', 4), site(3, 'temple', 8), site(4, 'concert', 0, false)];
  const day = venueSounds(sites, { x: 0, z: 0 }, at, 'day', 1);
  assert.equal(day.crowd, 1); assert.equal(day.chatter, 0, 'a night market is quiet by day');
  assert.ok(Math.abs(day.temple - (1 - 8 / HEARING)) < 1e-9);
  const night = venueSounds(sites, { x: 0, z: 0 }, at, 'night', .5);
  assert.ok(Math.abs(night.chatter - .5 * (1 - 4 / HEARING)) < 1e-9); assert.equal(night.temple, 0);
  assert.equal(venueSounds([site(4, 'concert', 0, false)], { x: 0, z: 0 }, at, 'night', 1).crowd, 0, 'a closed concert ground is silent');
  assert.equal(venueSounds(sites, { x: 100, z: 0 }, at, 'day', 1).crowd, 0, 'too far to hear');
  assert.equal(venueSounds([site(5, 'airport', 0)], { x: 0, z: 0 }, at, 'night', 1).airport, 1, 'an airport needs no staff');
});
