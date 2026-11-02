import test from 'node:test';import assert from 'node:assert/strict';
import { createCity,serialize,deserialize,expandValidatedCity,buildRoad,zoneCell,step,access,connectedRoads } from '../src/sim.ts';
import { utilityService } from '../src/utilities.ts';
import { expandedCellAt } from '../src/expanded-map-grid.ts';

test('a road from the existing gateway supports actual growth and utilities in northern land',()=>{
 const city=expandValidatedCity(deserialize(serialize(createCity(7,{starter:false}))));
 const north=expandedCellAt(5,-1)!,lot=expandedCellAt(6,-1)!;
 assert.ok(buildRoad(city,288,293).ok);assert.ok(buildRoad(city,293,north).ok);assert.ok(zoneCell(city,lot,'R').ok);assert.ok(access(city,lot));
 for(let i=0;i<80;i++)step(city);
 const building=city.buildings.find(b=>b.cell===lot);assert.ok(building);assert.equal(city.cells[lot].building,building.id);assert.ok(utilityService(city,connectedRoads(city)).ok(building.id));
 const loaded=deserialize(serialize(city));assert.deepEqual(loaded.cells,city.cells);assert.deepEqual(loaded.buildings,city.buildings);assert.deepEqual(loaded.accounts,city.accounts);assert.equal(loaded.rng,city.rng);
});
