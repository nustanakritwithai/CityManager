import test from 'node:test';
import assert from 'node:assert/strict';
import { expandedCellAt } from '../src/expanded-map-grid.ts';
import { createBus, busStopSides } from '../src/bus/buildings.ts';
import { createBusLine, busLineRoutes } from '../src/bus/lines.ts';
import { cellCenter } from '../src/bus/geometry.ts';

test('bus stop and route traverse the north seam with correct visual coordinates', () => {
 const a=expandedCellAt(5,1)!, b=expandedCellAt(5,0)!, n=expandedCellAt(5,-1)!, top=expandedCellAt(5,-2)!;
 const roads=new Set([a,b,n,top]);
 const city={cells:Array.from({length:672},(_,i)=>({road:roads.has(i)})), nextId:10, bus:createBus()};
 city.bus.depots.push({id:1,cell:expandedCellAt(6,1)!,level:1,open:true,tick:0});
 city.bus.stops.push({id:2,cell:a,side:'e',level:1},{id:3,cell:n,side:'e',level:1});
 assert.deepEqual(busStopSides(city,n,24),{sides:['e','w']});
 assert.ok(createBusLine(city,{depotId:1,stopIds:[2,3],busCount:1,busLevel:1}).ok);
 const [route]=busLineRoutes(city); assert.equal(route.status,'running');
 assert.deepEqual(route.legs[0].path,[a,b,n]);
 assert.deepEqual(cellCenter(n),{x:-13,z:-25});
});
