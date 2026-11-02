import assert from 'node:assert/strict';
/** Uses only the isolated server fixture and real pointer/touch input on the built app. */
export async function landExpansionChecks({send,evaluate,capture,until,acknowledge,reload}) {
 const mouse=async(x,y)=>{for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',clickCount:1});};
 const touch=async(x,y)=>{await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
 const mapPoint=()=>evaluate(`(()=>{const r=document.querySelector('.city-map-canvas').getBoundingClientRect(),cell=r.width/28;return {x:r.left+7.5*cell,y:r.top+3.5*cell};})()`);
 const tapCell=async(id,isTouch=false)=>{const p=await evaluate(`window.cityManager.cellScreen(${id})`);assert.equal(await evaluate(`document.elementFromPoint(${p.x},${p.y})?.id`),'city-canvas');await (isTouch?touch:mouse)(p.x,p.y);};
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 const before=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));assert.equal(before.cells.length,672);assert.equal(before.version,26);assert.match(await evaluate("document.querySelector('.map-caption').textContent"),/24\s*×\s*28/);
 await evaluate("document.querySelector('.minimap-open').click()");await until(()=>evaluate("!document.querySelector('.city-map').hidden"),'land desktop map');
 await capture('land-desktop-map');const p=await mapPoint();await mouse(p.x,p.y);
 await until(()=>evaluate("document.querySelector('#inspector').dataset.open==='true'"),'land desktop selection');
 assert.match(await evaluate("document.querySelector('#selection-title').textContent"),/6,เหนือ 1/);
 await evaluate("document.querySelector('#close-inspector').click();document.querySelector('[data-tool=road]').click()");
 await tapCell(5);await tapCell(653);
 await until(async()=>{const c=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));return c.cells[5].road&&c.cells[653].road;},'land road across seam');
 await capture('land-desktop-road');const saved=await acknowledge();assert.equal(saved.version,26);assert.ok(saved.cells[5].road&&saved.cells[653].road);
 await reload();const loaded=JSON.parse(await evaluate('window.cityManager.sessionSnapshot()'));assert.deepEqual(loaded.cells,saved.cells);assert.deepEqual(loaded.resources,saved.resources);assert.deepEqual(loaded.market,saved.market);assert.deepEqual(loaded.accounts,saved.accounts);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 await evaluate("document.querySelector('#toggle-stats').click();document.querySelector('.st-map').click()");await until(()=>evaluate("!document.querySelector('.city-map').hidden"),'land phone map');
 await capture('land-mobile-map');const q=await mapPoint();await touch(q.x,q.y);await until(()=>evaluate("document.querySelector('#inspector').dataset.open==='true'"),'land phone map selection');
 assert.match(await evaluate("document.querySelector('#selection-title').textContent"),/6,เหนือ 1/);await evaluate("document.querySelector('#close-inspector').click();document.querySelector('[data-tool=select]').click()");
 await tapCell(653,true);await until(()=>evaluate("document.querySelector('#inspector').dataset.open==='true'"),'land phone canvas selection');await capture('land-mobile-selection');
 await evaluate("document.querySelector('#close-inspector').click()");await send('Emulation.setTouchEmulationEnabled',{enabled:false});await send('Emulation.clearDeviceMetricsOverride');
 return {status:'passed',desktop:'map selection, cross-seam construction, server ACK and reload',mobile:'touch map and canvas selection'};
}
