import test from 'node:test';
import assert from 'node:assert/strict';
import { expandedCellAt, expandedCellPath } from '../src/expanded-map-grid.ts';
import { TrafficGame } from '../src/traffic/game.ts';
import { buildNetwork, linkKey } from '../src/traffic/network.ts';
import { gamePoses } from '../src/traffic/game-poses.ts';
import { movementMask } from '../src/traffic/movements.ts';

test('traffic routes and renders through the old/new north seam', () => {
 const from=expandedCellAt(5,1)!,to=expandedCellAt(5,-2)!,path=expandedCellPath(from,to), roads=new Set(path);
 const map={cells:Array.from({length:672},(_,i)=>({road:roads.has(i)}))};
 assert.throws(()=>buildNetwork(map,{parcelZones:true}),/Legacy aggregate/);
 const net=buildNetwork(map);
 assert.ok(net.links.has(linkKey(path[1],path[2])));
 assert.ok(movementMask(path[0],path[1],path[2]));
 const game=new TrafficGame({map,demand:[{from,to,rate:1}]});
 let sawSeam=false;
 for(let i=0;i<80;i++){const frame=game.step(); const poses=gamePoses(frame.cars,frame.groups); if(frame.cars.some(c=>c.from===path[1]&&c.to===path[2])) {sawSeam=true; assert.ok(poses.some(p=>p.z<=-23&&p.z>=-25));}}
 assert.ok(sawSeam); assert.ok(game.frame.completed>0);
});
