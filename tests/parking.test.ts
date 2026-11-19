import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, linkKey, FREE_FLOW_KMH, LANE_CAPACITY_VPH } from '../src/traffic/network.ts';
import { linkTimes, shortestPath } from '../src/traffic/routing.ts';
import { configureRoadPath, type RoadMap } from '../src/road-topology.ts';
import { ROAD_CLASS, linkRoadClass, setRoadClass } from '../src/road-classes.ts';
import { buildingAccess, buildingParking, civicParking, driveway, totalSpaces } from '../src/parking.ts';
import { createCity, step } from '../src/sim.ts';
import { factoryLevel } from '../src/factory-levels.ts';

const S = 24;
type Map = RoadMap & { cells: { road: boolean; building: number | null }[] };
const blank = (): Map => ({ cells: Array.from({ length: S * S }, () => ({ road: false, building: null })) });
const at = (x: number, y: number) => y * S + x;
function draw(c: Map, path: number[], oneWay = false) {
  const fresh = new Set(path.filter(i => !c.cells[i].road));
  for (const i of path) c.cells[i].road = true;
  configureRoadPath(c, path, fresh, oneWay);
}

test('a local street keeps the network’s earlier figures, so a city without upgrades routes as before', () => {
  assert.equal(ROAD_CLASS.local.speedKmh, FREE_FLOW_KMH);
  assert.equal(ROAD_CLASS.local.laneCapacityPerHour, LANE_CAPACITY_VPH);
  const c = blank(); draw(c, [0, 1, 2]);
  const l = buildNetwork(c).links.get(linkKey(0, 1))!;
  assert.deepEqual([l.freeFlowKmh, l.lanes, l.capacityPerHour], [FREE_FLOW_KMH, 1, LANE_CAPACITY_VPH]);
  assert.equal(buildNetwork(c, { capacityPerLane: 30 }).links.get(linkKey(0, 1))!.capacityPerHour, 30, 'a caller’s lane capacity still applies to a local street');
});

test('road classes set each link’s speed, lanes and capacity, limited by the slower end', () => {
  const c = blank(); draw(c, [0, 1, 2, 3]);
  setRoadClass(c, [0, 1, 2], 'arterial'); setRoadClass(c, [3], 'collector');
  const n = buildNetwork(c), arterial = n.links.get(linkKey(0, 1))!, joint = n.links.get(linkKey(2, 3))!;
  assert.deepEqual([arterial.freeFlowKmh, arterial.lanes, arterial.capacityPerHour], [60, 2, 2 * ROAD_CLASS.arterial.laneCapacityPerHour]);
  assert.equal(linkRoadClass(c, 2, 3), 'collector');
  assert.deepEqual([joint.freeFlowKmh, joint.lanes, joint.capacityPerHour], [50, 1, ROAD_CLASS.collector.laneCapacityPerHour]);
  const oneWay = blank(); draw(oneWay, [0, 1, 2], true); setRoadClass(oneWay, [0, 1, 2], 'arterial');
  assert.equal(buildNetwork(oneWay).links.get(linkKey(0, 1))!.lanes, 4, 'a one-way arterial carries both directions’ lanes one way');
});

test('a faster road draws the route when it is quicker even if a little longer', () => {
  // Two ways from (0,0) to (6,0): straight along row 0 (6 links), or a detour along row 1 that is two links longer.
  const c = blank(), top = Array.from({ length: 7 }, (_, x) => at(x, 0));
  const detour = [at(0, 0), ...Array.from({ length: 7 }, (_, x) => at(x, 1)), at(6, 0)];
  draw(c, top); draw(c, detour);
  const before = shortestPath(buildNetwork(c), linkTimes(buildNetwork(c), new Map()), at(0, 0), at(6, 0))!;
  assert.deepEqual(before, top, 'all local: the shorter way wins');
  setRoadClass(c, detour, 'arterial');
  const net = buildNetwork(c), after = shortestPath(net, linkTimes(net, new Map()), at(0, 0), at(6, 0))!;
  assert.ok(after.includes(at(3, 1)), 'the arterial is quicker: 8 links at 60 km/h (48 s) beat 6 at 40 km/h (54 s)');
});

test('a building’s driveway is its smallest neighbouring road, then the lowest parcel', () => {
  const c = blank(); draw(c, [at(4, 4), at(5, 4), at(6, 4)]); draw(c, [at(5, 6), at(5, 7)]);
  const home = at(5, 5);
  assert.equal(driveway(c, [home]), at(5, 4), 'two local roads: the lower parcel');
  setRoadClass(c, [at(4, 4), at(5, 4), at(6, 4)], 'arterial');
  assert.equal(driveway(c, [home]), at(5, 6), 'the side street, not the arterial');
  assert.equal(driveway(c, [at(12, 12)]), null);
  assert.equal(driveway(c, [at(5, 5), at(6, 5)]), at(5, 6), 'a footprint never counts its own parcels and looks around all of them');
});

test('parking follows what the building holds: homes per dwelling, workplaces per post, plus customers and loading', () => {
  assert.deepEqual(buildingParking({ id: 1, cell: 0, zone: 'R', level: 1, housingType: 'cottage' }), { residentOrStaff: 1, visitor: 0, loadingBays: 0 });
  assert.equal(buildingParking({ id: 1, cell: 0, zone: 'R', level: 6, housingType: 'apartment' }).residentOrStaff, 12);
  assert.deepEqual(buildingParking({ id: 2, cell: 0, zone: 'C', level: 1 }), { residentOrStaff: 1, visitor: 2, loadingBays: 1 });
  const factory = buildingParking({ id: 3, cell: 0, zone: 'I', level: 4 });
  assert.deepEqual(factory, { residentOrStaff: factoryLevel(4).jobs, visitor: 0, loadingBays: 2 });
  assert.deepEqual(buildingParking({ id: 4, cell: 0, zone: 'F', level: 2 }), { residentOrStaff: 2, visitor: 0, loadingBays: 1 });
  assert.deepEqual(civicParking('restaurant'), { residentOrStaff: 2, visitor: 8, loadingBays: 1 });
  assert.equal(civicParking('hospital').loadingBays, 2, 'ambulance bays');
  assert.ok(totalSpaces(civicParking('stadium')) > totalSpaces(civicParking('clinic')));
});

test('every connected building in a grown city has a driveway on a real road', () => {
  const c = createCity(61025); for (let i = 0; i < 30; i++) step(c);
  assert.ok(c.buildings.length > 0);
  for (const b of c.buildings) {
    const report = buildingAccess(c, b);
    if (report.driveway === null) continue;
    assert.equal(c.cells[report.driveway].road, true);
    assert.equal(report.roadLabel, ROAD_CLASS.local.label);
    assert.ok(totalSpaces(report.parking) >= 1);
  }
});
