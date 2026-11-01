import test from 'node:test';import assert from 'node:assert/strict';import {deflateSync} from 'node:zlib';
import {inspectSignalEvidence,signalPixels} from './traffic-signal-browser-checks.mjs';
import {TrafficSignalDisplay} from '../src/traffic/signal-display.ts';import {signalTopologyKey} from '../src/traffic/adaptive-signals.ts';
function proof(){const city={cells:Array.from({length:576},(_,i)=>({road:[300,299,301,276,324].includes(i)}))},topology=signalTopologyKey(city),display=new TrafficSignalDisplay();display.reset(city);const records=[],rendered=[];
 for(const [step,approach]of[null,299,301].entries()){const signals={topology,phases:[{node:300,approach,state:approach===null?'all-red':'green'}]};records.push({epoch:'accepted',frame:{step,signals}});display.accept(signals);rendered.push({epoch:'accepted',step,signals:display.diagnostics,signalRendering:{heads:4,batches:3,materials:3}});}return{city,records,rendered};}
test('browser mapped heads must match actual accepted epoch, approach, all-red and changed phases',()=>{const p=proof(),e=inspectSignalEvidence(p.records,p.rendered,p.city);assert.equal(e.matched,3);assert.equal(e.phaseChanges,2);assert.ok(e.allRedSnapshots>0);
 for(const mutate of [r=>r[1].signals.heads[0].state='purple',r=>r[1].signals.topology='stale',r=>r[1].signals.heads.pop(),r=>r[1].signalRendering.batches=4,r=>r.forEach(x=>x.epoch='proposed')]){const rows=structuredClone(p.rendered);mutate(rows);assert.throws(()=>inspectSignalEvidence(p.records,rows,p.city));}
});
function png(){const width=32,height=16,ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;const raw=Buffer.alloc((width*3+1)*height);for(const [cx,color]of[[8,[255,80,70]],[24,[70,255,150]]])for(let y=6;y<10;y++)for(let x=cx-1;x<=cx+1;x++){const n=y*(width*3+1)+1+x*3;raw.set(color,n);}const chunk=(name,b)=>{const out=Buffer.alloc(b.length+12);out.writeUInt32BE(b.length);out.write(name,4);b.copy(out,8);return out;};return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
test('pixel proof reads actual bounded PNG color near projected heads, not a nonblank-only pass',()=>{const anchors=[{x:8,y:8,node:1,approach:0,state:'red',visible:true},{x:24,y:8,node:2,approach:1,state:'green',visible:true}],p=signalPixels(png(),anchors,{width:32,height:16});assert.ok(p[0].red>=2);assert.equal(p[0].green,0);assert.ok(p[1].green>=2);assert.equal(p[1].red,0);assert.deepEqual(signalPixels(png(),anchors.map(a=>({...a,visible:false})),{width:32,height:16}),[]);assert.throws(()=>signalPixels(Buffer.alloc(32),anchors,{width:32,height:16}));});

import {settleSignalProjection,assertStableSignalProjection} from './traffic-signal-browser-checks.mjs';
test('camera evidence waits for actual frame progress and rejects pre-capture cached projections',async()=>{
 const sample=(renderFrame,x)=>({renderFrame,step:4,viewport:{width:960,height:640},anchors:[{node:300,approach:299,x,y:20,state:'green'}]});
 const rows=[sample(10,100),sample(11,100),sample(12,140),sample(13,140)];let index=0,tasks=0;
 const result=await settleSignalProjection({read:async()=>rows[index++],afterRender:async()=>{tasks++;},until:async fn=>{for(let i=0;i<3;i++)if(await fn())return;throw Error('fence did not settle');}});
 assert.equal(result.renderFrame,13);assert.equal(tasks,3,'Changed post-render matrix must settle across another real frame');
 assert.throws(()=>assertStableSignalProjection(sample(10,100),sample(13,140)),/projection/);assert.doesNotThrow(()=>assertStableSignalProjection(sample(13,140),sample(14,140)));
 await assert.rejects(settleSignalProjection({read:async()=>sample(10,140),afterRender:async()=>{},until:async fn=>{for(let i=0;i<3;i++)if(await fn())return;throw Error('no actual render progress');}}),/no actual render progress/);
});
