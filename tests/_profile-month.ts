import { Session } from 'node:inspector/promises';
import { writeFileSync } from 'node:fs';
import { createCity, step, buildRoad, zoneCell, access, buildReadyParcels, GATEWAY, SIZE, type Zone } from '../src/sim.ts';
import { keepSupplied } from './plants.ts';
import { OUTSIDE_SUPPLY } from '../src/utilities.ts';
const c = createCity(61025, { starter: false }); c.unlocks = { version: 1 };
c.tileScale = 10; c.utilities.outside = { power: OUTSIDE_SUPPLY.power * 10, water: OUTSIDE_SUPPLY.water * 10 };
const W = SIZE, H = Math.floor(c.cells.length / SIZE), gy = Math.floor(GATEWAY / SIZE);
buildRoad(c, GATEWAY, gy * W + 1); buildRoad(c, 1, (H - 1) * W + 1);
for (let y = 0; y < H; y += 3) buildRoad(c, y * W + 1, y * W + W - 1);
const pattern = 'RRFRCRIRFRRCRF'; let k = 0, n = 0;
for (let i = 0; i < c.cells.length; i++) {
  const cell = c.cells[i]; if (cell.road || cell.zone || !access(c, i)) continue;
  if (n++ % 6 === 5) continue;
  if (zoneCell(c, i, pattern[k++ % pattern.length] as Zone).ok) buildReadyParcels(c, i);
  if (keepSupplied(c, 60)) buildReadyParcels(c);
}
for (let d = 1; d < 60; d++) { step(c); if (keepSupplied(c, 60)) buildReadyParcels(c); }
console.log('households', c.households.length, 'ledger', c.ledger.length, 'tick', c.tick);
const session = new Session(); session.connect();
await session.post('Profiler.enable'); await session.post('Profiler.start');
const t0 = performance.now(); step(c); const ms = performance.now() - t0;
const { profile } = await session.post('Profiler.stop');
console.log('month-end step ms', ms.toFixed(0));
// Self time by function.
const self = new Map<string, number>(); const dt = profile.timeDeltas ?? []; const byId = new Map(profile.nodes.map(n => [n.id, n]));
profile.samples?.forEach((id, i) => { const nd = byId.get(id)!; const key = `${nd.callFrame.functionName || '(anon)'} ${nd.callFrame.url.split('/').pop()}:${nd.callFrame.lineNumber + 1}`; self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000); });
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${v.toFixed(0)}ms ${k}`).join('\n'));
writeFileSync('/tmp/claude-0/-home-user-CityManager/2463f425-62b2-5196-bf7a-751c8c2cd98a/scratchpad/month.cpuprofile', JSON.stringify(profile));
