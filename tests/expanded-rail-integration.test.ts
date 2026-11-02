import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity } from '../src/sim.ts';
import { createParkRuntime, deserializeParkSession, expandValidatedParkSession, serializeParkSession } from '../src/park-runtime.ts';
import { RailNetworkRuntime } from '../src/rail/network-runtime.ts';
import { expandedCellAt } from '../src/expanded-map-grid.ts';
import { railPath } from '../src/rail/graph.ts';

test('validated legacy rail session rebinds without loss and can extend track across seam', () => {
 const legacy=createCity(123,{starter:false}), runtime=createParkRuntime(legacy);
 runtime.rail=RailNetworkRuntime.create(legacy,'synthetic-city',0);
 runtime.rail.addStation('old',expandedCellAt(5,2)!);
 runtime.rail.addTrackPath(expandedCellAt(5,2)!,expandedCellAt(5,0)!);
 const raw=serializeParkSession(legacy,runtime), loaded=deserializeParkSession(raw), before=loaded.runtime.rail!.snapshot;
 const next=expandValidatedParkSession(loaded);
 assert.deepEqual(next.runtime.rail!.snapshot,before);
 const north=expandedCellAt(5,-2)!;
 next.runtime.rail!.addTrackPath(expandedCellAt(5,0)!,north);
 next.runtime.rail!.addStation('north',north);
 assert.deepEqual(railPath(next.runtime.rail!.snapshot.graph,expandedCellAt(5,2)!,north)?.cells,[53,29,5,653,629]);
 const saved=serializeParkSession(next.city,next.runtime), restored=deserializeParkSession(saved);
 assert.deepEqual(restored.runtime.rail!.snapshot,next.runtime.rail!.snapshot);
 assert.deepEqual(restored.city.cells.slice(0,576),loaded.city.cells);
});
