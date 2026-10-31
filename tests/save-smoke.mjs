// Fast headless save smoke on a BUILT bundle (vite preview or the live Pages URL).
// Dependency-free CDP against Chrome/Edge. Each scenario uses a fresh throwaway profile, so it
// never touches a real player's saves. Exit code != 0 means saving is broken: do not deploy.
//   CITYMANAGER_URL      target (default http://127.0.0.1:4191/CityManager/)
//   CITYMANAGER_BROWSER  browser binary (default: Edge on Windows, google-chrome elsewhere)
//   SAVE_SMOKE_LIVE=1    live mode: same checks, labelled as post-deploy
import {spawn} from 'node:child_process';import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {resolve} from 'node:path';import assert from 'node:assert/strict';
const url=process.env.CITYMANAGER_URL||'http://127.0.0.1:4191/CityManager/',origin=new URL(url).origin;
const browser=process.env.CITYMANAGER_BROWSER||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'google-chrome');
const output=resolve('.test-output/save-smoke');await mkdir(output,{recursive:true});
const fixture=n=>readFile(new URL(`./fixtures/save-smoke/${n}`,import.meta.url),'utf8');
const SAVE_KEY='citymanager.save.v7';
// Size budget: the large fixture's serialized city may not grow more than 10% after load+save,
// and no save may approach the ~5M-char localStorage origin quota.
const GROWTH_LIMIT=1.10,ABSOLUTE_CAP=4_700_000;
// Near-quota: storage is filled until only HEADROOM chars remain free. The current build's first save
// (primary rewrite in place + compressed checkpoint/backup ~20k each) fits; an extra uncompressed copy
// of the city (e.g. a migration backup key) does not, and must not make saving fail.
const HEADROOM=150_000;
// Any CityManager key other than the primary slot (and explicit v1-v6 import backups) must be small or
// LZ-compressed. Catches new uncompressed backup/extra copies such as #153's raw before-taxi key.
const EXTRA_KEY_RAW_LIMIT=64_000;
// Keys a sibling app (Strategy-Game) keeps on the same github.io origin. Must stay byte-identical.
const STRATEGY={'strategy-game.save':JSON.stringify({turn:42,units:[1,2,3]}),'StrategyGame:settings':'{"music":false}','sg_profile':'player-1'};
const SAVE_FAILED=/เซฟหลักบันทึกไม่สำเร็จ|บันทึกอัตโนมัติไม่สำเร็จ|เซฟหลักไม่สำเร็จ|บันทึกไม่ได้/;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const checks=[],started=Date.now();let port=9460;

async function session(name,{seed={},filler=false,headroom=HEADROOM}={}){
  const profile=await mkdtemp(resolve(output,`profile-${name}-`)),dport=port++;
  const child=spawn(browser,['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader',`--remote-debugging-port=${dport}`,`--user-data-dir=${profile}`,'--window-size=1280,900','about:blank'],{stdio:'ignore',windowsHide:true});
  let ws,id=0;const pending=new Map(),errors=[],consoleErrors=[];
  const send=(method,params={})=>{const n=++id;return new Promise((res,rej)=>{const t=setTimeout(()=>{pending.delete(n);rej(Error(`CDP timeout ${method}`))},60000);pending.set(n,{res:v=>{clearTimeout(t);res(v)},rej:e=>{clearTimeout(t);rej(e)}});ws.send(JSON.stringify({id:n,method,params}));});};
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(`${name}: ${JSON.stringify(r.exceptionDetails).slice(0,500)}`);return r.result.value;};
  const until=async(expression,timeout=60000,label=expression)=>{const s=Date.now();while(Date.now()-s<timeout){let ok=false;try{ok=await evaluate(expression);}catch(e){if(!/navigated or closed|Cannot find context|context was destroyed/.test(String(e?.message)))throw e;}if(ok)return;await sleep(150);}throw Error(`${name}: timeout waiting for ${label}`);};
  let page;for(let i=0;i<150&&!page;i++){try{page=(await(await fetch(`http://127.0.0.1:${dport}/json/list`)).json()).find(t=>t.type==='page');}catch{}if(!page)await sleep(100);}
  assert.ok(page,`${name}: browser did not start (${browser})`);
  ws=new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.rej(Error(JSON.stringify(m.error))):p?.res(m.result);}
    else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
    else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')consoleErrors.push(m.params.args.map(a=>a.value??a.description??'').join(' '));};
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  // Seed storage once per profile before the game boots, record every CityManager write, and
  // shrink only the 60 s autosave interval so several autosaves happen inside the smoke budget.
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{if(location.origin!==${JSON.stringify(origin)})return;
    if(!localStorage.getItem('__saveSmokeSeeded')){const seed=${JSON.stringify({...STRATEGY,'citymanager.auto-wipe.v1':'1',...seed})};for(const k in seed)localStorage.setItem(k,seed[k]);
      ${filler?`localStorage.setItem('zz-save-smoke-reserve','r'.repeat(${headroom}));let chunk='x'.repeat(1<<20),i=0;while(chunk.length>=1024){try{localStorage.setItem('zz-save-smoke-filler-'+(i++),chunk);}catch{chunk=chunk.slice(0,chunk.length>>1);}}localStorage.removeItem('zz-save-smoke-reserve');`:''}
      try{localStorage.setItem('__saveSmokeSeeded','1');}catch{sessionStorage.setItem('__saveSmokeSeededS','1');}}
    window.__cmWrites=[];const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===localStorage&&String(k).startsWith('citymanager.'))window.__cmWrites.push({k:String(k),n:String(v).length,t:Date.now(),tick:window.cityManager?.parks?JSON.parse(window.cityManager.snapshot()).tick:null});return set.call(this,k,v);};
    const si=window.setInterval;window.setInterval=function(fn,ms,...a){return si.call(this,fn,ms===60000?1500:ms,...a);};})();`});
  const enter=async()=>{await until("!!document.querySelector('.guest-entry-card')||!!window.cityManager",90000,'entry gate or game');
    if(await evaluate("!!document.querySelector('.guest-entry-card')")){await until("[...document.querySelectorAll('.guest-entry-card button')].some(b=>b.textContent.trim()==='เล่นออฟไลน์'&&!b.disabled)",30000,'เล่นออฟไลน์ button');
      await evaluate("[...document.querySelectorAll('.guest-entry-card button')].find(b=>b.textContent.trim()==='เล่นออฟไลน์').click()");}
    await until('!!window.cityManager&&window.cityManager.visuals().ready',90000,'game ready');await sleep(500);};
  const reload=async()=>{await evaluate('window.__boot=1');await send('Page.reload',{ignoreCache:true});await until('window.__boot!==1',30000,'reload');await enter();};
  const click=sel=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('missing '+${JSON.stringify(sel)});e.click();return true})()`);
  const state=()=>evaluate(`(()=>{const c=JSON.parse(window.cityManager.sessionSnapshot());const acc=c.accounts?.treasury??c.accounts;return{tick:c.tick,money:JSON.stringify(acc),buildings:c.buildings?.length??0,cells:c.cells.filter(t=>t.building!==null&&t.building!==undefined).length,size:window.cityManager.sessionSnapshot().length}})()`);
  const failureText=()=>evaluate(`(()=>{const b=document.querySelector('#save-failure-banner');return [b&&!b.hidden?b.textContent:'',document.querySelector('#autosave-status')?.textContent??''].join(' | ')})()`);
  const assertNoSaveFailure=async label=>{const t=await failureText();assert.doesNotMatch(t,SAVE_FAILED,`${name}/${label}: save-failed UI: ${t}`);assert.equal(await evaluate("!document.querySelector('#save-failure-banner')||document.querySelector('#save-failure-banner').hidden"),true,`${name}/${label}: save failure banner visible: ${t}`);
    const bad=consoleErrors.filter(e=>/save|เซฟ|บันทึก|quota|storage|serializ/i.test(e));assert.deepEqual(errors,[],`${name}/${label}: uncaught page errors`);assert.deepEqual(bad,[],`${name}/${label}: save console errors`);};
  const manualSave=async label=>{await evaluate('window.__cmWrites.length=0');await click('#toggle-game-menu');await click('#save');
    await until(`window.__cmWrites.some(w=>w.k===${JSON.stringify(SAVE_KEY)}||/active|checkpoint/.test(w.k))&&/บันทึก/.test(document.querySelector('#autosave-status')?.textContent??'')`,30000,`${label} save write`);await sleep(400);
    await assertNoSaveFailure(label);await click('#toggle-game-menu').catch(()=>{});};
  const strategyIntact=async label=>{for(const [k,v] of Object.entries(STRATEGY))assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(k)})`),v,`${name}/${label}: Strategy-Game key ${k} changed`);};
  const keyBudget=async label=>{const keys=await evaluate('Object.keys(localStorage).filter(k=>k.startsWith("citymanager.")).map(k=>{const v=localStorage.getItem(k);return [k,v.length,v.startsWith("cm-copy-lz1:")]})');
    for(const [k,n,packed] of keys)if(k!==SAVE_KEY&&!/^citymanager\.backup\.v[0-9]/.test(k)&&n>=EXTRA_KEY_RAW_LIMIT&&!packed)assert.fail(`${name}/${label}: localStorage key ${k} holds ${n} uncompressed chars (limit ${EXTRA_KEY_RAW_LIMIT}): new uncompressed backup/extra copy over size budget`);return keys;};
  const shot=async label=>{try{const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(output,`${name}-${label}.png`),Buffer.from(r.data,'base64'));}catch{}};
  const clickXY=async(x,y)=>{for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});};
  const close=async()=>{try{ws.close();}catch{}child.kill();await sleep(300);await rm(profile,{recursive:true,force:true}).catch(()=>{});};
  await send('Page.navigate',{url});await enter();
  return {keyBudget,clickXY,evaluate,until,enter,reload,click,state,manualSave,assertNoSaveFailure,strategyIntact,shot,close,failureText,errors,consoleErrors};
}
async function scenario(name,opts,body){if(process.env.SAVE_SMOKE_ONLY&&!name.includes(process.env.SAVE_SMOKE_ONLY))return;const s=await session(name,opts);const t=Date.now();try{await body(s);}catch(e){await s.shot('failure');const t2=await s.failureText().catch(()=>'');await writeFile(resolve(output,`${name}-failure.json`),JSON.stringify({error:String(e?.stack??e),ui:t2,errors:s.errors,consoleErrors:s.consoleErrors},null,2));throw e;}finally{await s.close();}console.log(`ok ${name} (${((Date.now()-t)/1000).toFixed(1)}s)`);}

// 1-3, 6: fresh city: manual save, autosave over several in-game days, reload restores exactly.
await scenario('fresh',{},async s=>{
  await s.manualSave('manual save');await s.keyBudget('fresh save');if(process.env.SAVE_SMOKE_EXPECT_NO_MARKET){assert.equal(await s.evaluate("!!document.querySelector('.market-launch,.guest-entry-card')"),false,'market UI hidden');assert.doesNotMatch(await s.evaluate('document.body.innerText'),/พักการทำรายการตลาด/);checks.push('Market UI hidden, no market-pause message');}checks.push('Manual save succeeds with no save-failed UI or console error');
  const t0=(await s.state()).tick;await s.evaluate('window.__cmWrites.length=0');
  await s.click('[data-speed="10"]');if(await s.evaluate('window.cityManager.parks().paused'))await s.click('#pause');
  await s.until(`(()=>{const w=window.__cmWrites.filter(w=>w.tick!==null);const ticks=new Set(w.map(w=>w.tick));return ticks.size>=3&&Math.max(...ticks)-${t0}>=3})()`,90000,'3 autosaves across >=3 in-game days');
  await s.assertNoSaveFailure('autosave');if(!(await s.evaluate('window.cityManager.parks().paused')))await s.click('#pause');
  const autos=await s.evaluate('[...new Set(window.__cmWrites.map(w=>w.tick))]');checks.push(`Autosave fired on in-game days ${autos.join(', ')}`);
  await s.manualSave('save before reload');const before=await s.state();await s.reload();const after=await s.state();
  assert.deepEqual({...after,size:0},{...before,size:0},'Reload restores the same day/money/buildings');await s.assertNoSaveFailure('after reload');
  checks.push(`Reload restores day ${after.tick}, money and ${after.cells} buildings`);await s.strategyIntact('fresh');
});
// 4: saves written by previous builds load and save again (+ size budget on the large city).
for(const file of ['small-day65.json','bus-optional-day60.json','large-day800.json']){
  const raw=await fixture(file),fx=JSON.parse(raw);
  await scenario(file.replace('.json',''),{seed:{[SAVE_KEY]:raw}},async s=>{
    if(process.env.SAVE_SMOKE_DEBUG)console.log('DBG',JSON.stringify(await s.evaluate(`({keys:Object.keys(localStorage).map(k=>[k,localStorage.getItem(k).length]),status:document.querySelector('#status')?.textContent,banner:document.querySelector('#save-failure-banner')?.textContent,origin:location.origin})`)));const loaded=await s.state();assert.equal(loaded.tick,fx.tick,`${file}: fixture city loaded (day ${fx.tick}), not a fresh city`);
    if(fx.bus)assert.ok(JSON.parse(await s.evaluate('window.cityManager.sessionSnapshot()')).bus,`${file}: optional bus data kept`);
    await s.manualSave('re-save fixture');await s.keyBudget('after first save');if(process.env.SAVE_SMOKE_DEBUG)console.log('KEYS',JSON.stringify(await s.evaluate('Object.keys(localStorage).map(k=>[k,localStorage.getItem(k).length])')));
    if(!file.startsWith('large')){await s.evaluate('window.__cmWrites.length=0');await s.click('[data-speed="10"]');if(await s.evaluate('window.cityManager.parks().paused'))await s.click('#pause');
      await s.until(`new Set(window.__cmWrites.filter(w=>w.tick!==null).map(w=>w.tick)).size>=2`,90000,'2 autosaves on a populated city');await s.assertNoSaveFailure('fixture autosave');
      if(!(await s.evaluate('window.cityManager.parks().paused')))await s.click('#pause');await s.manualSave('save after play');}
    const before=await s.state();await s.reload();const again=await s.state();assert.deepEqual({...again,size:0},{...before,size:0},`${file}: re-saved city reloads with same day/money/buildings`);await s.assertNoSaveFailure('fixture reload');
    assert.ok(again.size<=ABSOLUTE_CAP,`${file}: serialized save ${again.size} chars exceeds cap ${ABSOLUTE_CAP}`);
    if(file.startsWith('large'))assert.ok(again.size<=raw.length*GROWTH_LIMIT,`${file}: save grew from ${raw.length} to ${again.size} chars (> +10% budget)`);
    await s.strategyIntact(file);checks.push(`Previous-build save ${file} (day ${fx.tick}, ${raw.length} chars) loads, ${file.startsWith('large')?'':'autosaves while playing, '}saves, reloads at day ${again.tick} with ${again.cells} buildings; now ${again.size} chars`);
  });
}
// Taxi + traffic running (the #153 area: taxi depot, fares credited every frame): play with the
// clock running, autosave several days and save while the economy is running, then reload.
{const raw=await fixture('small-day65.json');
await scenario('taxi-running',{seed:{[SAVE_KEY]:raw}},async s=>{
  if(!(await s.evaluate("!!document.querySelector('[data-tool=\"taxi\"]')"))){checks.push('Taxi tool not present in this build: taxi-running scenario skipped');return;}
  await s.click('[data-tool="taxi"]');
  const cells=await s.evaluate(`(()=>{const c=JSON.parse(window.cityManager.snapshot()),N=24,out=[];for(let i=0;i<c.cells.length;i++){const t=c.cells[i];if(t.road||t.building!==null||t.zone!==null)continue;const x=i%N,y=Math.floor(i/N);if(![[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>c.cells[(y+dy)*N+x+dx]?.road&&x+dx>=0&&x+dx<N))continue;const p=window.cityManager.cellScreen(i);if(p.x>40&&p.x<innerWidth-40&&p.y>120&&p.y<innerHeight-160&&document.elementFromPoint(p.x,p.y)?.id==='city-canvas')out.push({x:p.x,y:p.y});}return out.slice(0,25)})()`);
  let placed=false;for(const p of cells){await s.clickXY(p.x,p.y);await new Promise(r=>setTimeout(r,250));if(/สร้างอู่แท็กซี่ #/.test(await s.evaluate("document.querySelector('#status')?.textContent??''"))){placed=true;break;}}
  assert.ok(placed,'taxi-running: could not place a taxi depot');
  await s.evaluate('window.__cmWrites.length=0');await s.click('[data-speed="10"]');if(await s.evaluate('window.cityManager.parks().paused'))await s.click('#pause');
  await s.until('window.cityManager.traffic().step>=12',60000,'traffic game running 12 steps with taxis');await s.until(`new Set(window.__cmWrites.filter(w=>w.tick!==null).map(w=>w.tick)).size>=3`,90000,'3 autosaves with taxis running');await s.assertNoSaveFailure('taxi autosave');if(process.env.SAVE_SMOKE_DEBUG)console.log('RUNNING',JSON.stringify(await s.evaluate('({t:window.cityManager.traffic(),p:window.cityManager.parks()})')).slice(0,2500));
  await s.manualSave('save while running');await s.keyBudget('taxi save');await new Promise(r=>setTimeout(r,2000));await s.assertNoSaveFailure('after running save');
  if(!(await s.evaluate('window.cityManager.parks().paused')))await s.click('#pause');await s.manualSave('save after taxi play');
  const before=await s.state();await s.reload();const after=await s.state();assert.deepEqual({...after,size:0},{...before,size:0},'taxi-running: reload restores same day/money/buildings');await s.assertNoSaveFailure('taxi reload');
  await s.strategyIntact('taxi-running');if(process.env.SAVE_SMOKE_DEBUG)console.log(JSON.stringify(await s.evaluate('window.cityManager.traffic()')).slice(0,1500));const depots=await s.evaluate('JSON.parse(window.cityManager.snapshot()).taxi?.depots?.length??0');if(process.env.SAVE_SMOKE_EXPECT_TAXI_SAVE)assert.ok(depots>0,'taxi depot survives reload');checks.push(`Taxi depots after reload: ${depots}`);const fares=await s.evaluate(`JSON.parse(window.cityManager.snapshot()).ledger.filter(l=>/axi/.test(JSON.stringify(l))).length`);checks.push(`Taxi depot + traffic running at 10x: autosaves, save while running and reload OK (day ${after.tick}, taxi fare ledger rows ${fares})`);
});}
// 5: localStorage pre-filled to near quota (only HEADROOM free), then the FIRST save of this build,
// including any startup migration/backup writes, must succeed, for a small and a bus city.
for(const file of ['small-day65.json','bus-optional-day60.json']){const raw=await fixture(file);
await scenario('near-full-'+file.replace('.json',''),{seed:{[SAVE_KEY]:raw},filler:true},async s=>{
  assert.equal((await s.state()).tick,JSON.parse(raw).tick,'near-full: fixture city loaded');
  await s.manualSave('first save near quota');await s.keyBudget('near quota');
  await s.reload();assert.equal((await s.state()).tick,JSON.parse(raw).tick);await s.manualSave('second save near quota');
  assert.ok(await s.evaluate(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`),'near-full: save slot present');
  await s.strategyIntact('near-full');checks.push(`Storage filled to ${HEADROOM} chars free: first save (incl. migrations/backups) of ${file} succeeds, reload + second save OK`);
});}
// Orphan raw taxi backup written by #153 (live 13:01-13:49) + storage otherwise completely full:
// the build must clean CityManager-only orphans itself; the player never deletes anything.
for(const file of ['small-day65.json','large-day800.json']){const raw=await fixture(file);const orphan=JSON.stringify({version:9,orphan:'x'.repeat(385_000)});
await scenario('orphan-taxi-'+file.replace('.json',''),{seed:{[SAVE_KEY]:raw,'citymanager.backup.before-taxi':orphan},filler:true,headroom:1000},async s=>{
  assert.equal((await s.state()).tick,JSON.parse(raw).tick,'orphan: fixture city loaded');
  await s.manualSave('first save with orphan + full storage');await s.reload();assert.equal((await s.state()).tick,JSON.parse(raw).tick);await s.manualSave('second save');
  await s.strategyIntact('orphan');checks.push(`Full storage + 385k raw #153 orphan before-taxi key: ${file} saves and reloads without player action`);
});}
checks.push('Strategy-Game keys on the same origin untouched in every scenario');
const report={url,checks,seconds:Math.round((Date.now()-started)/1000)};await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
