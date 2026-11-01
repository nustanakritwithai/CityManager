// PR 182's changed panels, exercised in the authenticated built game. No city mutations.
import assert from 'node:assert/strict';

export async function pr182VisualChecks({send,evaluate,capture}) {
 const paints=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const settle=async()=>{await new Promise(r=>setTimeout(r,250));await paints();};
 let touch=false;
 const tap=async selector=>{
  await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`);await paints();
  const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),more=document.querySelector('#hud-more');if(!e)return {missing:true,viewport:[innerWidth,innerHeight],touchUi:document.documentElement.dataset.touchUi};const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,w:r.width,h:r.height,disabled:e.disabled,display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility,navDisplay:getComputedStyle(document.querySelector('.page-buttons')).display,moreExpanded:more?.getAttribute('aria-expanded'),viewport:[innerWidth,innerHeight],touchUi:document.documentElement.dataset.touchUi,hit:e.contains(hit),hitElement:hit?.id||hit?.tagName}})()`);
  assert.ok(p?.hit&&!p.disabled&&p.w>0&&p.h>0,`Reachable control ${selector}: ${JSON.stringify(p)}`);
  if(touch){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else {await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});}
  await paints();return p;
 };
 // In the touch HUD, page buttons are intentionally inside the collapsed More menu.
 // Open it through the real control; never invoke the hidden button programmatically.
 const tapPage=async selector=>{
  const collapsed=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),more=document.querySelector('#hud-more');return !!e&&!!e.closest('.page-buttons')&&!e.getClientRects().length&&!!more?.getClientRects().length})()`);
  if(collapsed){await tap('#hud-more');assert.equal(await evaluate("document.querySelector('#hud-more').getAttribute('aria-expanded')"),'true','Touch menu opens before its page control');}
  return tap(selector);
 };
 const viewport=async(width,height,mobile)=>{touch=mobile;await send('Emulation.setTouchEmulationEnabled',mobile?{enabled:true,maxTouchPoints:2}:{enabled:false});await send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile});await paints();};
 const bounded=async selector=>{const r=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth}})()`);assert.ok(r.x>=-1&&r.y>=-1&&r.right<=r.width+1&&r.bottom<=r.height+1&&r.scroll<=r.width+1,`Panel in viewport: ${selector} ${JSON.stringify(r)}`);return r;};
 const results=[];
 for(const [name,w,h,mobile] of [['desktop',1440,1000,false],['mobile',390,844,true]]){
  console.log('PR182 visual layout:',name);await viewport(w,h,mobile);
  if(await evaluate('document.querySelector(".guide-skip")?.getClientRects().length>0'))await tap('.guide-skip');
  await tapPage('#toggle-game-menu');assert.equal(await evaluate("document.querySelector('#inspector').dataset.page"),'game');
  assert.equal(await evaluate("document.querySelector('#inspector').dataset.open"),'true');
  assert.equal(await evaluate("!!document.querySelector('#game-content #save')"),true);
  assert.equal(await evaluate("document.querySelectorAll('#load,#load-backup,#load-legacy,#load-v2,#load-v3,#load-v4,#load-v5,#load-v6,#save-failure-export').length"),0);
  await bounded('#inspector');await settle();await capture(`pr182-${name}-menu`);
  const paused=await evaluate('window.cityManager.parks().paused');const clock=await tap('#panel-pause');if(mobile)assert.ok(clock.w>=44&&clock.h>=44,'Touch clock target is at least 44px');assert.equal(await evaluate('window.cityManager.parks().paused'),!paused,'Header clock is a working control');await tap('#panel-pause');assert.equal(await evaluate('window.cityManager.parks().paused'),paused,'Restore original clock state');
  await tap('#close-inspector');assert.equal(await evaluate("document.querySelector('#inspector').dataset.open"),'false');
  await tapPage('#toggle-stats');assert.equal(await evaluate("document.querySelector('#city-stats').hidden"),false);assert.equal(await evaluate("getComputedStyle(document.querySelector('.status-chip')).visibility"),'hidden');
  await bounded('#city-stats');await settle();await capture(`pr182-${name}-stats`);const statsClose=await tap('#close-city-stats');if(mobile)assert.ok(statsClose.w>=44&&statsClose.h>=44,'Touch stats close target is at least 44px');assert.equal(await evaluate("document.querySelector('#city-stats').hidden"),true);
  await tap('#rail-tool');await tap('[data-rail-action="manage"]');assert.equal(await evaluate("document.querySelector('#rail-management').open"),true);
  assert.equal(await evaluate("document.querySelectorAll('#rail-management .rail-management-metric').length"),6);await bounded('#rail-management');await settle();await capture(`pr182-${name}-rail`);
  const railClose=await tap('#rail-management [aria-label="ปิดหน้าจัดการรถไฟ"]');if(mobile)assert.ok(railClose.w>=44&&railClose.h>=44,'Touch rail close target is at least 44px');assert.equal(await evaluate("document.querySelector('#rail-management').open"),false);
  results.push({name,menu:true,stats:true,rail:true,nativeInput:mobile?'touch':'mouse'});
 }
 await viewport(1440,1000,false);
 return {status:'passed',results};
}
