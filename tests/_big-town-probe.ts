import { createCity, step, buildRoad, zoneCell, access, buildReadyParcels, summary, serialize, deserialize, GATEWAY, SIZE, type City, type Zone } from '../src/sim.ts';
import { keepSupplied } from './plants.ts';
import { OUTSIDE_SUPPLY } from '../src/utilities.ts';
const big = process.argv[2] !== 'small', days = Number(process.argv[3] ?? 120);
const c = createCity(61025, { starter: false }); c.unlocks = { version: 1 };
if (big) { c.tileScale = 10; c.utilities.outside = { power: OUTSIDE_SUPPLY.power * 10, water: OUTSIDE_SUPPLY.water * 10 }; }
const W = SIZE, H = Math.floor(c.cells.length / SIZE), gy = Math.floor(GATEWAY / SIZE);
// A spine from the gate and streets every third row.
buildRoad(c, GATEWAY, gy * W + 1);
buildRoad(c, 1, (H - 1) * W + 1);
for (let y = 0; y < H; y += 3) buildRoad(c, y * W + 1, y * W + W - 1);
// Every sixth roadside parcel stays empty for a water or power plant, as a player leaves room for them.
const pattern = 'RRFRCRIRFRRCRF'; let k = 0, n = 0, placed = 0;
for (let i = 0; i < c.cells.length; i++) {
  const cell = c.cells[i]; if (cell.road || cell.zone || !access(c, i)) continue;
  if (n++ % 6 === 5) continue;
  const z = pattern[k++ % pattern.length] as Zone;
  if (zoneCell(c, i, z).ok) { placed++; buildReadyParcels(c, i); }
  if (keepSupplied(c, 60)) buildReadyParcels(c);
}
const people = () => c.households.reduce((n, h) => n + h.members, 0);
console.log(`${big ? 'BIG' : 'small'} placed ${placed} parcels, buildings ${c.buildings.length}, treasury ${(c.accounts.treasury / 100).toFixed(0)}`);
let worst = 0;
for (let d = 1; d <= days; d++) {
  const t0 = performance.now(); step(c); const ms = performance.now() - t0; worst = Math.max(worst, ms);
  if (keepSupplied(c, 60)) buildReadyParcels(c);
  if (d % 10 === 0) { try { const j = serialize(c); if (serialize(deserialize(j)) !== j) throw Error('reload differs'); } catch (e) { console.log(`day ${d}: SAVE FAILS ${(e as Error).message}`); console.log((e as Error).stack?.split('\n').slice(1, 6).join(' | ')); process.exit(1); } }
  if (d % 15 === 0 || d === 1 || d === 5) {
    const s = summary(c);
    console.log(`day ${d}: people ${people()} households ${c.households.length} homeless ${s.homeless} jobs ${s.jobs} employed ${s.employed} open ${s.openJobs} buildings ${c.buildings.length} plants ${c.plants.length} treasury ${(c.accounts.treasury / 100).toFixed(0)} step ${ms.toFixed(0)}ms worst ${worst.toFixed(0)}ms`);
  }
}
const t1 = performance.now(); const json = serialize(c); const back = deserialize(json); console.log(`save ${(json.length / 1e6).toFixed(2)} MB, reload ${(performance.now() - t1).toFixed(0)} ms, same ${serialize(back) === json}`);
// What the save is made of.
const raw = JSON.parse(json) as Record<string, unknown>;
const sizes = Object.entries(raw).map(([k, v]) => [k, JSON.stringify(v).length] as const).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('largest sections', sizes.map(([k, n]) => `${k} ${(n / 1e6).toFixed(2)}MB`).join(', '));
const reasons = new Map<string, number>();
for (const e of c.ledger) { const r = e.reason.replace(/#\d+/g, '#').replace(/\d+/g, 'N'); reasons.set(r, (reasons.get(r) ?? 0) + 1); }
console.log('ledger entries', c.ledger.length, 'top reasons', [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([r, n]) => `${r}: ${n}`).join(' | '));
const s2 = summary(c);
console.log('workforce', s2.workforce, 'employed', s2.employed, 'unemployed', s2.unemployed, 'open', s2.openJobs, 'unfunded', s2.unfundedJobs);
