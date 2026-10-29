import assert from 'node:assert/strict';

// Shared mobile reading surfaces, using only native navigation and synthetic
// local save failures. Collect the whole matrix before reporting any failure.
export async function verifyReadingPanels({ send, evaluate, button, cell, game, until, shot, sleep, cardCases, layouts }) {
  const views = [
    { name:'phone', width:360, height:740, screenWidth:360, screenHeight:780 },
    { name:'short', width:360, height:420, screenWidth:360, screenHeight:780 },
    { name:'landscape', width:844, height:390, screenWidth:844, screenHeight:390 },
    { name:'wide', width:980, height:2120, screenWidth:390, screenHeight:844 },
  ];
  const pages = ['ledger','city','help','game','house','factory','household'], failures = [];
  const snapshot = await evaluate('cityManager.snapshot()');
  const close = async () => { if (await evaluate("document.querySelector('#inspector').dataset.open==='true'")) await button('#close-inspector'); };
  async function open(name) {
    await close();
    const entry = cardCases.find(c=>c.kind===name);
    if (entry) {
      await cell(entry.cell);
      if (entry.householdId) await button(`#entity-content [data-household-id="${entry.householdId}"]`);
      await until(`document.querySelector('#entity-content').dataset.cardKind===${JSON.stringify(name)}`);
    } else {
      await button(name==='help'?'#toggle-help':name==='game'?'#toggle-game-menu':'#toggle-inspector');
      await until(`document.querySelector('#inspector').dataset.page===${JSON.stringify(name==='ledger'?'city':name)}`);
      if (name==='ledger') {
        if (await evaluate("!!document.querySelector('#inspector').dataset.submenu")) await button('#submenu-back');
        await button('#money-section>summary');
        await until("document.querySelector('#inspector').dataset.submenu==='money-section'");
      }
    }
    await evaluate("document.querySelector('#inspector-body').scrollTop=0;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  }
  for (const viewport of views) {
    await close(); const { name:viewportName, ...dimensions } = viewport;
    await send('Emulation.setDeviceMetricsOverride',{...dimensions,deviceScaleFactor:1,mobile:true});
    await until(`innerWidth===${viewport.width}&&innerHeight===${viewport.height}&&screen.width===${viewport.screenWidth}`);
    for (const warning of [false,true]) {
      if (warning) {
        await game();
        await evaluate("Storage.prototype.setItem=function(k,v){if(k.startsWith('citymanager.'))throw new DOMException('Synthetic reading-panel quota','QuotaExceededError');return window.__uxWrite.call(this,k,v)}");
        await button('#save'); await until("!document.querySelector('#save-failure-banner').hidden");
      }
      for (const name of pages) {
        let measurement;
        const label = `${viewportName}-${name}-${warning?'warning':'clear'}`;
        try {
          await open(name);
          measurement = await evaluate(`(()=>{
            const panel=document.querySelector('#inspector'),body=document.querySelector('#inspector-body'),p=panel.getBoundingClientRect(),b=body.getBoundingClientRect(),banner=document.querySelector('#save-failure-banner'),w=banner.getBoundingClientRect(),ratio=Math.min(1,screen.width/innerWidth);
            const full=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=b.top&&r.bottom<=b.bottom&&r.left>=b.left&&r.right<=b.right};
            const keys=({house:['households','persons','vacant-households','vacant-persons'],factory:['crop-stock','recipe-input','recipe-output','stock'],household:['members','workforce','dependents','employed','unemployed']})[${JSON.stringify(name)}]||[];
            const primary=keys.map(k=>document.querySelector('#entity-content .bc-kpis [data-context-metric="'+k+'"]')).filter(Boolean);
            return{viewport:[innerWidth,innerHeight],ratio,panel:{top:p.top,bottom:p.bottom,left:p.left,right:p.right,height:p.height},body:{top:b.top,bottom:b.bottom,height:b.height,horizontalOverflow:body.scrollWidth>body.clientWidth+1},warningVisible:!banner.hidden,warningInline:banner.parentElement===panel,warningRect:{top:w.top,bottom:w.bottom},primaryTotal:primary.length,primaryFull:primary.filter(full).length,ledgerFull:[...document.querySelectorAll('#ledger .sm-flow-card')].filter(full).length,controls:['#submenu-back','#panel-pause','#close-inspector',...(${warning}?['#save-failure-export']:[])].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return{selector:s,width:r.width*ratio,height:r.height*ratio,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})};
          })()`);
          Object.assign(measurement,{viewportName,page:name,warning}); layouts.push(measurement);
          if (warning && (viewportName==='phone'||name==='ledger')) await shot('reading-'+label);
          const p=measurement.panel;
          assert.ok(p.top>=0&&p.bottom<=viewport.height+1&&p.left>=0&&p.right<=viewport.width+1,'Viewport-contained panel: '+label);
          assert.ok(p.height>=viewport.height*.9,'Tall reading surface >=90% viewport: '+label);
          assert.ok(measurement.body.height>0&&!measurement.body.horizontalOverflow,'Contained reading scroll body: '+label);
          assert.equal(measurement.warningVisible,warning,'Persistent warning state: '+label);
          if (warning) {
            assert.equal(measurement.warningInline,true,'Warning belongs to full-height panel: '+label);
            assert.ok(measurement.warningRect.bottom<=measurement.body.top+1,'Warning does not cover reading content: '+label);
          }
          assert.ok(measurement.controls.every(c=>c.width>=43.5&&c.height>=43.5&&c.hit),'Reachable physical 44px controls: '+label);
          if (viewportName==='phone'||viewportName==='wide') {
            if (measurement.primaryTotal) assert.equal(measurement.primaryFull,measurement.primaryTotal,'Complete type-specific primary values fit initially: '+label);
            if (name==='ledger') assert.ok(measurement.ledgerFull>0,'Actual complete ledger row visible: '+label);
          }
          assert.equal(await evaluate('cityManager.snapshot()'),snapshot,'Reading preserves actual simulation: '+label);
        } catch (error) {
          failures.push({label,error:String(error)});
          if (measurement) measurement.error=String(error); else layouts.push({viewportName,page:name,warning,error:String(error)});
        }
      }
      if (warning) {
        await evaluate('Storage.prototype.setItem=window.__uxWrite');
        await game(); await button('#save'); await until("document.querySelector('#save-failure-banner').hidden");
      }
    }
  }
  await close(); await sleep(100);
  assert.deepEqual(failures,[],'Complete tall-reading matrix: '+JSON.stringify(layouts));
}
