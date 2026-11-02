import test from 'node:test';
import assert from 'node:assert/strict';
import { expandedCellAt, expandedCellPath } from '../src/expanded-map-grid.ts';
import { configureExpandedRoadPath, forgetExpandedRoadTopology, setExpandedRoadJunction, expandedDirectionTarget, expandedEdgeKey, expandedRoadDirection, expandedRoadDriveAllowed, expandLegacyRoadTopology, validateExpandedRoadTopology } from '../src/expanded-road-topology.ts';
import { configureRoadPath, edgeKey, roadDriveAllowed, roadLinked, roadNeighbors, type RoadMap } from '../src/road-topology.ts';
import { expandedRoadLinked } from '../src/expanded-road-topology.ts';
import { shortestRoadRoute } from '../src/road-network.ts';
import type { City } from '../src/sim.ts';

test('validated legacy blocked edges and directions migrate without changing road IDs', () => {
  const roads = new Set([24,25,26,49]);
  const legacy: RoadMap = { cells: Array.from({length:576}, (_, i) => ({road:roads.has(i)})), roadTopology: {version:1, blocked:[edgeKey(24,25),edgeKey(25,49)], oneWay:{'24':1,'25':24,'26':-1,'49':-24}} };
  const before = JSON.stringify(legacy);
  const result = expandLegacyRoadTopology(legacy)!;
  assert.deepEqual(result, {version:2, blocked:[expandedEdgeKey(24,25),expandedEdgeKey(25,49)], oneWay:{'24':'east','25':'south','26':'west','49':'north'}});
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(expandLegacyRoadTopology({cells:legacy.cells}), undefined);
  assert.throws(() => expandLegacyRoadTopology({...legacy, roadTopology:{...legacy.roadTopology!,blocked:[edgeKey(24,26)]}}), /Invalid road junction/);
});

test('north seam direction and blocked junctions use coordinates rather than numeric deltas', () => {
  const north = expandedCellAt(5,-1)!, old = expandedCellAt(5,0)!;
  assert.equal(expandedRoadDirection(old,north), 'north');
  assert.equal(expandedRoadDirection(north,old), 'south');
  assert.equal(expandedDirectionTarget(old,'north'), north);
  assert.equal(expandedDirectionTarget(north,'south'), old);
  assert.equal(expandedDirectionTarget(expandedCellAt(0,-4)!,'north'), null);
  assert.throws(() => expandedEdgeKey(old,expandedCellAt(5,-2)!), /Invalid/);
  const cells = Array.from({length:672}, (_, i) => ({road:i === old || i === north}));
  const topology = {version:2 as const,blocked:[expandedEdgeKey(old,north)],oneWay:{[old]:'north' as const}};
  validateExpandedRoadTopology(cells,topology);
  assert.throws(() => validateExpandedRoadTopology(cells,{...topology,blocked:[...topology.blocked,...topology.blocked]}), /Invalid/);
  assert.throws(() => validateExpandedRoadTopology(cells,{...topology,oneWay:{[old]:'invalid'}}), /Invalid/);
  assert.throws(() => validateExpandedRoadTopology(cells.slice(1),topology), /Invalid/);
});

test('real road routing crosses the seam and respects blocked junctions', () => {
  const from = expandedCellAt(5,1)!, seam = expandedCellAt(5,0)!, north = expandedCellAt(5,-1)!, to = expandedCellAt(5,-3)!;
  const path = expandedCellPath(from,to);
  assert.deepEqual(path, [from,seam,north,expandedCellAt(5,-2),to]);
  const roads = new Set(path);
  const cells = Array.from({length:672}, (_, i) => ({road:roads.has(i),zone:null,building:null}));
  const map = { cells } as unknown as Pick<City,'cells'|'roadTopology'>;
  assert.deepEqual(shortestRoadRoute(map,from,to), path);
  const topology = { version:2 as const,blocked:[expandedEdgeKey(seam,north)],oneWay:{} };
  const closed = { cells, roadTopology:topology } as unknown as Pick<City,'cells'|'roadTopology'>;
  assert.deepEqual(shortestRoadRoute(closed,from,to), []);
  const oneWay = {cells,roadTopology:{version:2 as const,blocked:[],oneWay:{[seam]:'north' as const,[north]:'north' as const}}};
  assert.equal(expandedRoadDriveAllowed(oneWay,seam,north),true);
  assert.equal(expandedRoadDriveAllowed(oneWay,north,seam),false);
});

test('road editing connects and directs the north seam without changing crossing roads', () => {
  const old = expandedCellAt(5,0)!, north = expandedCellAt(5,-1)!, north2 = expandedCellAt(5,-2)!, east = expandedCellAt(6,-1)!;
  const roads = new Set([old,north,north2,east]);
  const map = { cells: Array.from({length:672}, (_,i) => ({road:roads.has(i)})), roadTopology: undefined as import('../src/expanded-road-topology.ts').ExpandedRoadTopology | undefined };
  configureExpandedRoadPath(map,[old,north,north2],new Set([north,north2]),true);
  assert.equal(expandedRoadDriveAllowed(map,old,north),true);
  assert.equal(expandedRoadDriveAllowed(map,north,old),false);
  assert.deepEqual(map.roadTopology?.blocked,[expandedEdgeKey(north,east)]);
  assert.equal(setExpandedRoadJunction(map,north,east,true),true);
  assert.deepEqual(map.roadTopology?.blocked,[]);
  assert.equal(setExpandedRoadJunction(map,north,east,false),true);
  const before = JSON.stringify(map);
  assert.throws(() => configureExpandedRoadPath(map,[old,north2],new Set(),false), /Invalid/);
  assert.equal(JSON.stringify(map),before);
  forgetExpandedRoadTopology(map,north);
  assert.deepEqual(map.roadTopology?.blocked,[]);
  assert.equal(map.roadTopology?.oneWay[north],undefined);
});

test('single-tile repair recognizes opposite roads across the seam', () => {
  const old=expandedCellAt(5,0)!, north=expandedCellAt(5,-1)!, north2=expandedCellAt(5,-2)!;
  const map = {cells:Array.from({length:672},(_,i)=>({road:[old,north,north2].includes(i)})), roadTopology:undefined as import('../src/expanded-road-topology.ts').ExpandedRoadTopology | undefined};
  configureExpandedRoadPath(map,[north],new Set([north]),false);
  assert.equal(map.roadTopology,undefined);
});

test('expanded road editing preserves legacy topology semantics across representative strokes', () => {
  for (const path of [[0,1,2,3], [23,47,71], [288,264,240], [574,550,526], [100,101,125,149]]) {
    for (const oneWay of [false,true]) {
      const legacy: RoadMap = {cells:Array.from({length:576},()=>({road:true}))};
      const expanded = {cells:Array.from({length:672},(_,i)=>({road:i<576})), roadTopology:undefined as import('../src/expanded-road-topology.ts').ExpandedRoadTopology | undefined};
      configureRoadPath(legacy,path,new Set(path),oneWay);
      configureExpandedRoadPath(expanded,path,new Set(path),oneWay);
      for (let a=0;a<576;a++) for (const b of roadNeighbors(a)) {
        assert.equal(expandedRoadLinked(expanded,a,b),roadLinked(legacy,a,b), `${a} -> ${b}`);
        assert.equal(expandedRoadDriveAllowed(expanded,a,b),roadDriveAllowed(legacy,a,b), `${a} -> ${b} direction`);
      }
    }
  }
});
