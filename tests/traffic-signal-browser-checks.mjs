import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {roadDriveAllowed,roadNeighbors} from '../src/road-topology.ts';

/** Validate actual accepted-worker snapshots, never proposed/uncommitted phases. */
export function inspectSignalEvidence(records,rendered,city){
 const frames=new Map(),steps=new Set();for(const r of records){const step=`${r.epoch}:${r.frame.step}`;steps.add(step);frames.set(step+':'+r.frame.signals?.topology,r.frame);}let matched=0,green=0,allRed=0,changes=0;const last=new Map();
 for(const row of rendered){const step=`${row.epoch}:${row.step}`;if(!steps.has(step))continue;const frame=frames.get(step+':'+row.signals?.topology);assert.ok(frame,'Rendered topology must bind to an accepted frame at that epoch and step');assert.ok(frame.signals&&row.signals&&row.signalRendering,'Committed signal and actual renderer diagnostics required');
  assert.equal(row.signals.topology,frame.signals.topology);const heads=row.signals.heads;assert.equal(row.signalRendering.heads,heads.length);assert.ok(row.signalRendering.batches>=0&&row.signalRendering.batches<=3);assert.equal(row.signalRendering.materials,3);
  const expected=[];for(const phase of frame.signals.phases){assert.ok(['green','all-red'].includes(phase.state));const arms=roadNeighbors(phase.node).filter(from=>roadDriveAllowed(city,from,phase.node));
   if(phase.state==='green'){assert.ok(arms.includes(phase.approach));green++;}else{assert.equal(phase.approach,null);allRed++;}
   const phaseId=row.epoch+':'+phase.node;const key=phase.state+':'+phase.approach;if(last.has(phaseId)&&last.get(phaseId)!==key)changes++;last.set(phaseId,key);
   for(const approach of arms){const found=heads.filter(h=>h.node===phase.node&&h.approach===approach);assert.equal(found.length,1,'Every legal inbound approach has exactly one physical head');const h=found[0];assert.equal(h.state,phase.state==='green'&&phase.approach===approach?'green':'red');assert.equal(h.allRed,phase.state==='all-red');assert.equal(h.headingX,Math.sign(phase.node%24-approach%24));assert.equal(h.headingZ,Math.sign(Math.floor(phase.node/24)-Math.floor(approach/24)));expected.push(h);}
  }
  assert.equal(heads.length,expected.length,'No stale or extra approach head');matched++;
 }
 assert.ok(matched>=2&&green>0&&allRed>0&&changes>0,'Actual accepted signals must show green, all-red and phase changes across multiple frames');
 return{matched,greenSnapshots:green,allRedSnapshots:allRed,phaseChanges:changes,sampling:'Accepted 1-second Worker snapshots; short 0.4-second clearance duration is verified by engine substep tests, not inferred from browser samples.'};
}
export function signalPixels(png,anchors,viewport){
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20),channels=png[25]===2?3:png[25]===6?4:0;
 assert.ok(width>0&&height>0&&width*height<=4_000_000&&png[24]===8&&channels&&png[28]===0,'Bounded RGB/RGBA signal evidence');
 const chunks=[];for(let i=8;i+12<=png.length;){const n=png.readUInt32BE(i);assert.ok(i+12+n<=png.length);if(png.toString('ascii',i+4,i+8)==='IDAT')chunks.push(png.subarray(i+8,i+8+n));i+=n+12;}
 const stride=width*channels,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height});assert.equal(raw.length,(stride+1)*height);const pixels=Buffer.alloc(stride*height);let previous=Buffer.alloc(stride);
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)],row=Buffer.from(raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)));assert.ok(filter<=4);for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0,p=a+b-c;const v=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):Math.abs(p-a)<=Math.abs(p-b)&&Math.abs(p-a)<=Math.abs(p-c)?a:Math.abs(p-b)<=Math.abs(p-c)?b:c;row[x]=(row[x]+v)&255;}row.copy(pixels,y*stride);previous=row;}
 return anchors.filter(a=>a.visible).map(a=>{const x=Math.round(a.x*width/viewport.width),y=Math.round(a.y*height/viewport.height);let red=0,green=0;for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const px=x+dx,py=y+dy;if(px<0||py<0||px>=width||py>=height)continue;const i=py*stride+px*channels,r=pixels[i],g=pixels[i+1],b=pixels[i+2];if(r>100&&r>g*1.35&&r>b*1.2)red++;if(g>100&&g>r*1.25&&g>b*1.05)green++;}return{node:a.node,approach:a.approach,state:a.state,x,y,red,green,forwardX:a.forwardX,forwardY:a.forwardY};});
}
const projectionState=p=>({viewport:p.viewport,step:p.step,anchors:p.anchors});
export function assertStableSignalProjection(before,after){assert.deepEqual(projectionState(after),projectionState(before),'Paused signal projection/phase must stay identical across the actual capture');}
export async function settleSignalProjection({read,afterRender,until}){
 const initial=await read();let previous=initial,settled;
 await until(async()=>{await afterRender();const next=await read();const ready=next.renderFrame>=initial.renderFrame+2&&next.renderFrame>previous.renderFrame&&JSON.stringify(projectionState(next))===JSON.stringify(projectionState(previous));previous=next;if(ready)settled=next;return ready;},'paused signal post-render projection fence');
 return settled;
}
export async function trafficSignalBrowserChecks({evaluate,capture,tap,toggle,until}){
 const snapshot=()=>evaluate('(()=>{const t=window.cityManager.traffic();return {step:t.step,signals:t.signals,renderer:t.signalRendering}})()');
 const before=await snapshot();assert.ok(before.signals.heads.some(h=>h.state==='green')&&before.signals.heads.some(h=>h.state==='red'),'Paused actual scene has permissive and stopped approaches');
 if(!await evaluate(`!!document.querySelector('[data-camera="zoom-in"]')?.getClientRects().length`))await tap('#toggle-camera');
 for(let i=0;i<10;i++)await tap('[data-camera="zoom-in"]');
 const anchors=()=>evaluate('(()=>{const t=window.cityManager.traffic(),a=t.signalRendering.screenAnchors;return {renderFrame:t.timing.frames,step:t.step,viewport:{width:innerWidth,height:innerHeight},anchors:a.map(p=>({...p,visible:p.depth>0&&p.x>12&&p.y>12&&p.x<innerWidth-12&&p.y<innerHeight-12&&document.elementFromPoint(p.x,p.y)?.tagName==="CANVAS"}))}})()');
 // Yield outside the rAF callback; observed app-frame progress plus stable pre/post-capture anchors fence the cached projection.
 const afterRender=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>setTimeout(()=>resolve(true),0)))');
 const zoom=await settleSignalProjection({read:anchors,afterRender,until}),shot=await capture('traffic-signals-zoom-green');
 const zoomAfter=await anchors();assertStableSignalProjection(zoom,zoomAfter);assert.ok(shot?.png,'Actual health-checked PNG required for signal pixels');const pixels=signalPixels(shot.png,zoom.anchors,zoom.viewport);
 assert.ok(pixels.some(p=>p.state==='green'&&p.green>=2),'Actual green signal pixels at a mapped visible approach; evidence='+JSON.stringify({viewport:zoom.viewport,pixels}));assert.ok(pixels.some(p=>p.state==='red'&&p.red>=2),'Actual red signal pixels at a mapped visible approach; evidence='+JSON.stringify({viewport:zoom.viewport,pixels}));
 assert.deepEqual(await snapshot(),before,'Native camera zoom and capture do not advance paused signal phase');
 await toggle(false);assert.equal(await evaluate('window.cityManager.traffic()'),null,'Native OFF disposes traffic and signal layer');await afterRender();await afterRender();const offShot=await capture('traffic-signals-off'),offPixels=signalPixels(offShot.png,zoom.anchors,zoom.viewport);for(const state of ['red','green'])assert.ok(pixels.some((p,i)=>p.state===state&&p[state]>=2&&offPixels[i][state]<p[state]),'Native OFF removes actual '+state+' glyph pixels at a previously visible head');
 await toggle(true);await until(()=>evaluate('!!window.cityManager.traffic()?.ready'),'signal native reset accepted frame');const reset=await snapshot();assert.ok(reset.signals.heads.length>0);assert.ok(reset.signals.heads.every(h=>h.state==='red'&&h.allRed),'Native reset shows actual all-red initial phase, not stale greens');
 const resetAnchors=await settleSignalProjection({read:anchors,afterRender,until}),redShot=await capture('traffic-signals-reset-all-red');const resetAfter=await anchors();assertStableSignalProjection(resetAnchors,resetAfter);const redPixels=signalPixels(redShot.png,resetAnchors.anchors,resetAnchors.viewport);assert.ok(redPixels.some(p=>p.red>=2),'Actual reset red signal pixels required; evidence='+JSON.stringify({viewport:resetAnchors.viewport,pixels:redPixels}));
 await tap('[data-camera="reset"]');
 return{status:'passed',projectionFrames:{zoom:zoom.renderFrame,zoomAfter:zoomAfter.renderFrame,reset:resetAnchors.renderFrame,resetAfter:resetAfter.renderFrame},normalView:'traffic-gap-dense-grid-paused.png',zoomPixels:pixels,offPixels,resetPixels:redPixels,batches:before.renderer.batches,materials:before.renderer.materials,pausedStep:before.step,resetStep:reset.step,scope:'Actual projected color pixels and accepted-phase approaches; arrow/bar shape readability additionally requires manual image review; normal-view and native zoom images retained. Idle/reset all-red is not claimed to measure occupied clearance duration.'};
}
