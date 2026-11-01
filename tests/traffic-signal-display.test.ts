import test from 'node:test';import assert from 'node:assert/strict';
import {TrafficSignalDisplay,signalSymbol,writeSignalMatrix,SIGNAL_STOP_OFFSET,SIGNAL_ROADSIDE_OFFSET} from '../src/traffic/signal-display.ts';
import {signalTopologyKey} from '../src/traffic/adaptive-signals.ts';
import {edgeKey,type RoadMap} from '../src/road-topology.ts';
const cross=():RoadMap=>({cells:Array.from({length:576},(_,i)=>({road:[300,299,301,276,324].includes(i)}))});
test('accepted phase maps only its legal incoming arm to green and idle or clearance is all red',()=>{
 const map=cross(),d=new TrafficSignalDisplay();d.reset(map);
 const heads=d.accept({topology:signalTopologyKey(map),phases:[{node:300,approach:299,state:'green'}]});assert.equal(heads.length,4);assert.deepEqual(heads.filter(h=>h.state==='green').map(h=>h.approach),[299]);
 assert.ok(d.accept({topology:signalTopologyKey(map),phases:[{node:300,approach:null,state:'all-red'}]}).every(h=>h.state==='red'&&h.allRed));
});
test('four approach heads face true motion and sit before stop line outside all active road lanes',()=>{
 const map=cross(),d=new TrafficSignalDisplay();d.reset(map);const heads=d.accept({topology:signalTopologyKey(map),phases:[{node:300,approach:null,state:'all-red'}]});
 for(const h of heads){const nx=(300%24-11.5)*2,nz=(Math.floor(300/24)-11.5)*2,dx=h.x-nx,dz=h.z-nz;
  assert.ok(Math.abs(dx*h.headingX+dz*h.headingZ+SIGNAL_STOP_OFFSET)<1e-12);assert.ok(SIGNAL_STOP_OFFSET>.71);
  assert.ok(Math.abs(dx*h.headingZ-dz*h.headingX-SIGNAL_ROADSIDE_OFFSET)<1e-12);assert.ok(SIGNAL_ROADSIDE_OFFSET-.035/2>.62+.42/2,'post clear of widest kerb bus');
  assert.ok(Math.abs(dx)+.125<=1&&Math.abs(dz)+.125<=1,'supported head stays in road parcel');
  const matrix=new Float32Array(16);writeSignalMatrix(matrix,0,h);assert.equal(matrix[8],h.headingX);assert.equal(matrix[10],h.headingZ);
 }
});
test('one-way and blocked links never display an invented incoming approach',()=>{
 const map=cross();map.roadTopology={version:1,blocked:[edgeKey(300,324)],oneWay:{299:-1}};const d=new TrafficSignalDisplay();d.reset(map);
 const heads=d.accept({topology:signalTopologyKey(map),phases:[{node:300,approach:276,state:'green'}]});assert.deepEqual(heads.map(h=>h.approach).sort((a,b)=>a-b),[276,301]);
 assert.throws(()=>d.accept({topology:signalTopologyKey(map),phases:[{node:300,approach:299,state:'green'}]}),/Invalid committed/);
});
test('missing and stale topology frames hide every lamp; reset and clear cannot retain green',()=>{
 const map=cross(),d=new TrafficSignalDisplay();d.reset(map);const old={topology:signalTopologyKey(map),phases:[{node:300,approach:299,state:'green' as const}]};d.accept(old);assert.equal(d.diagnostics.heads.length,4);
 map.cells[299].road=false;d.reset(map);assert.deepEqual(d.accept(old),[]);assert.deepEqual(d.accept(undefined),[]);d.clear();assert.equal(d.diagnostics.junctions,0);
});
test('symbols use distinguishable arrow and bar geometry with finite upward-facing triangles',()=>{
 for(const state of ['green','red'] as const){const g=signalSymbol(state);assert.ok(g.positions.every(Number.isFinite));for(let n=0;n<g.indices.length;n+=3){const p=g.indices.slice(n,n+3).map(i=>g.positions.slice(i*3,i*3+3));const ux=p[1][0]-p[0][0],uz=p[1][2]-p[0][2],vx=p[2][0]-p[0][0],vz=p[2][2]-p[0][2];assert.ok(uz*vx-ux*vz>0,'visible top winding');}}
 assert.notDeepEqual(signalSymbol('green'),signalSymbol('red'));
});
test('screen projection is opt-in and signal resources release once without double-destroying mesh refs',async()=>{
 const {SceneTrafficSignals}=await import('../src/scene-traffic-signals.ts');let projections=0,roots=0,buffers=0,materials=0,detach=0;
 // Renderer lifecycle adapter: real GPU/pixels are separately required in browser CI.
 const scene=Object.create(SceneTrafficSignals.prototype) as any;
 Object.assign(scene,{destroyed:false,count:1,heads:[{node:300,approach:299,x:0,z:0,headingX:1,headingZ:0,state:'green',allRed:false}],root:{enabled:true,destroy:()=>{roots++;}},batches:[{entity:{enabled:true},instance:{setInstancing:()=>{detach++;}},buffer:{destroy:()=>{buffers++;}},material:{destroy:()=>{materials++;}}}],app:{off:()=>{},graphicsDevice:{canvas:{getBoundingClientRect:()=>({left:2,top:3})}},root:{findByName:()=>({camera:{worldToScreen:(p:any)=>{projections++;return {x:p.x+10,y:p.z+20,z:1};}}})}}});
 const d=scene.diagnostics;JSON.stringify(d);assert.equal(projections,0);assert.equal(Object.keys(d).includes('screenAnchors'),false);assert.equal(d.screenAnchors[0].x,12);assert.equal(projections,2);
 scene.destroy();scene.destroy();assert.deepEqual({roots,buffers,materials,detach},{roots:1,buffers:1,materials:1,detach:1});assert.equal(scene.diagnostics.heads,0);assert.deepEqual(scene.diagnostics.screenAnchors,[]);
});
