import { BusEngine } from '../src/bus/engine.ts';
import { busPoses } from '../src/bus/poses.ts';
import { busDrawList } from '../src/bus/draw-list.ts';
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

test('bus movement proposals and rendered snapshots cross the seam using the actual map bound',()=>{
 const a=expandedCellAt(5,1)!,b=expandedCellAt(5,0)!,n=expandedCellAt(5,-1)!,top=expandedCellAt(5,-2)!;
 const roads=new Set([a,b,n,top]);const city={cells:Array.from({length:672},(_,i)=>({road:roads.has(i)})),nextId:10,bus:createBus()};
 city.bus.depots.push({id:1,cell:expandedCellAt(6,1)!,level:1,open:true,tick:0});city.bus.stops.push({id:2,cell:a,side:'e',level:1},{id:3,cell:n,side:'e',level:1});
 assert.ok(createBusLine(city,{depotId:1,stopIds:[2,3],busCount:1,busLevel:1}).ok);
 let proposals=0,seam=false;const engine=new BusEngine(city,300,{movementGate:(proposal,others)=>{
  const options={stops:city.bus.stops,cellCount:city.cells.length};
  assert.equal(busPoses([proposal.from],options).length,1);assert.equal(busPoses([proposal.to],options).length,1);
  const draw=busDrawList(city,[proposal.to],[],()=>0);assert.equal(draw.buses.length,1);
  proposals++;if([proposal.from.cell,proposal.from.next,proposal.to.cell,proposal.to.next].includes(n))seam=true;return true;
 }});
 for(let t=300;t<=330;t+=.125)engine.advanceTo(t);
 assert.ok(proposals>0);assert.ok(seam,'movement gate received the new northern cell');
 const northern={id:'north',lineId:10,phase:'running' as const,cell:b,next:n,progress:.5,persons:2,capacity:40};
 const [pose]=busPoses([northern],{cellCount:672});assert.equal(pose.z,-24);assert.equal(pose.headingZ,-1);
 assert.throws(()=>busPoses([northern]),/Invalid bus cell/,'legacy bounds remain enforced');
});
