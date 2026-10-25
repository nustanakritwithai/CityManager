import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, buildRoad, zoneCell, bulldoze, step, serialize, deserialize, connectedRoads, access, GATEWAY, SIZE, type City } from '../src/sim.ts';
import { previewPlacement } from '../src/placement-preview.ts';
import { mapOverlay, buildingIssues, TOOL_OVERLAY, type OverlayMode } from '../src/map-overlay.ts';

function grownCity(days: number): City {
  const c = createCity(61025), S = SIZE;
  buildRoad(c, GATEWAY, 12 * S + 20);
  for (const col of [5, 10, 15]) buildRoad(c, 6 * S + col, 18 * S + col);
  for (let r = 7; r <= 17; r++) for (const col of [4, 6, 9, 11]) if (r !== 12) zoneCell(c, r * S + col, r < 12 ? 'R' : 'I');
  for (const col of [6, 7, 8, 9]) { zoneCell(c, 11 * S + col, 'C'); zoneCell(c, 13 * S + col, 'F'); }
  buildRoad(c, 3 * S + 2, 3 * S + 6); // a road that never reaches the gateway
  for (let t = 0; t < days; t++) step(c);
  return c;
}
const clone = (c: City) => deserialize(serialize(c));

test('placement previews agree with the real action on a cloned city', () => {
  const c = grownCity(200), checks: string[] = [];
  const cells = [0, 5, 3 * SIZE + 4, 11 * SIZE + 6, 12 * SIZE + 7, 13 * SIZE + 7, 7 * SIZE + 4, GATEWAY, 20 * SIZE + 20, 22 * SIZE + 3];
  for (const tool of ['R', 'C', 'I', 'F', 'bulldoze'] as const) for (const cell of cells) {
    const preview = previewPlacement(c, tool, null, cell)!, copy = clone(c);
    const result = tool === 'bulldoze' ? bulldoze(copy, cell) : zoneCell(copy, cell, tool);
    // Firm closures may still be refused for unpaid wages/tax, which no preview can see.
    if (tool === 'bulldoze' && preview.ok && !result.ok && /Closure|Crop disposal/.test(result.message)) continue;
    assert.equal(preview.ok, result.ok, `${tool} @ ${cell}: preview "${preview.label}" vs sim "${result.message}"`);
    checks.push(`${tool}${cell}`);
  }
  for (const [a, b] of [[GATEWAY, 2 * SIZE], [12 * SIZE + 3, 4 * SIZE + 3], [20 * SIZE + 1, 20 * SIZE + 9], [7 * SIZE + 4, 7 * SIZE + 8]]) {
    const preview = previewPlacement(c, 'road', a, b)!, copy = clone(c), result = buildRoad(copy, a, b);
    assert.equal(preview.ok, result.ok, `road ${a}->${b}: "${preview.label}" vs "${result.message}"`);
    const spent = (c.accounts.treasury ?? 0) - (copy.accounts.treasury ?? 0);
    if (result.ok) assert.equal(spent, preview.cost, 'previewed road cost matches the charge');
  }
  assert.ok(checks.length >= 40);
});

test('road previews refuse paths through buildings and unaffordable roads', () => {
  const c = grownCity(200), building = c.buildings[0];
  const row = Math.floor(building.cell / SIZE), through = previewPlacement(c, 'road', row * SIZE, row * SIZE + SIZE - 1)!;
  assert.equal(through.ok, false); assert.ok(through.cells.some(p => p.cell === building.cell && !p.ok));
  c.accounts.treasury = 1_000;
  const poor = previewPlacement(c, 'road', 22 * SIZE, 22 * SIZE + 10)!;
  assert.equal(poor.ok, false); assert.match(poor.label, /เงินคลังไม่พอ/);
  assert.equal(previewPlacement(c, 'select', null, 5), null);
  assert.equal(previewPlacement(c, 'road', null, null), null);
});

test('overlays follow the simulator: fertility threshold, connectivity, readiness and occupancy', () => {
  const c = grownCity(300), roads = connectedRoads(c);
  const fertility = mapOverlay(c, 'fertility');
  for (const p of fertility.cells) assert.equal(p.tone === 'bad', c.resources.fertility[p.cell] < 50);
  for (const p of mapOverlay(c, 'roads').cells) assert.equal(p.tone === 'good', c.cells[p.cell].road ? roads.has(p.cell) : access(c, p.cell));
  assert.ok(mapOverlay(c, 'roads').cells.some(p => p.tone === 'bad' && c.cells[p.cell].road), 'the stray road is shown as disconnected');
  for (const p of mapOverlay(c, 'growth').cells) assert.ok(c.cells[p.cell].zone);
  for (const p of mapOverlay(c, 'housing').cells) assert.equal(c.cells[p.cell].zone, 'R');
  for (const mode of Object.values(TOOL_OVERLAY)) assert.ok(mapOverlay(c, mode as OverlayMode).legend.length >= 2);
});

test('issue markers come from real diagnostics and never change the city', () => {
  const c = grownCity(300), before = serialize(c), issues = buildingIssues(c);
  for (const issue of issues) assert.ok(c.buildings.some(b => b.cell === issue.cell), 'markers sit on buildings');
  assert.equal(new Set(issues.map(i => i.cell)).size, issues.length, 'one marker per building');
  for (const mode of ['fertility', 'roads', 'growth', 'housing'] as const) mapOverlay(c, mode);
  previewPlacement(c, 'road', GATEWAY, 2 * SIZE); previewPlacement(c, 'bulldoze', null, c.buildings[0].cell);
  assert.equal(serialize(c), before);
});
