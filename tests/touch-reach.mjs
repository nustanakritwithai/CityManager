// Synchronize actual stored-Load controls across every native-input smoke suite.
// This waits for a terminal UI result, not success: callers retain their exact
// loaded-state, unchanged-state, and expected-error assertions.
const storedLoadActions=new Set(['#load','#load-legacy','#load-v2','#load-v3','#load-v4','#load-v5','#load-v6','#load-backup','#load-autosave-copy','#load-save-conflict']);
const loading=new WeakSet();
export async function withStoredLoadCompletion(evaluate,activate,timeout=15000){
  try{
    await evaluate(`(()=>{window.__storedLoadObserver?.disconnect();window.__storedLoadResult=null;window.__storedLoadObserver=new MutationObserver(()=>{const text=document.querySelector('#status')?.textContent??'';if(/^(โหลดวันที่|นำเข้า v|โหลดไม่สำเร็จ:|ยังไม่มีเมืองที่บันทึกในช่องนี้|ยังไม่มีสำเนากู้คืนเซฟเดิม|Loaded day )/.test(text)){window.__storedLoadResult=text;window.__storedLoadObserver.disconnect()}});const status=document.querySelector('#status');if(!status)throw Error('Missing load status');window.__storedLoadObserver.observe(status,{childList:true,subtree:true,characterData:true})})()`);
    await activate();const started=Date.now();
    while(Date.now()-started<timeout){if(await evaluate('window.__storedLoadResult!==null&&window.__storedLoadResult!==undefined'))return;await new Promise(resolve=>setTimeout(resolve,50));}
    throw Error('Stored Load did not reach a terminal result: '+await evaluate("document.querySelector('#status')?.textContent"));
  }finally{await evaluate('window.__storedLoadObserver?.disconnect();delete window.__storedLoadObserver;delete window.__storedLoadResult');}
}

// Save may finish in primary storage, fail after an awaited emergency copy, or
// stop for explicit confirmation. Opening the dialog is NEVER auto-confirmed.
export async function withStoredSaveCompletion(evaluate,activate,timeout=15000){
  try{
    await evaluate(`(()=>{window.__storedSaveObserver?.disconnect();window.__storedSaveResult=null;const status=document.querySelector('#status');if(!status)throw Error('Missing save status');window.__storedSaveObserver=new MutationObserver(()=>{const text=status.textContent??'';if(!text.includes('กำลังพยายามสร้างสำเนากู้คืน')&&(/Saved day/.test(text)||/^บันทึกในเบราว์เซอร์นี้แล้ว/.test(text)||/^บันทึกไม่ได้:/.test(text)))window.__storedSaveResult=text;});window.__storedSaveObserver.observe(status,{childList:true,subtree:true,characterData:true})})()`);
    await activate();const started=Date.now();
    while(Date.now()-started<timeout){if(await evaluate("window.__storedSaveResult!==null&&window.__storedSaveResult!==undefined||!!document.querySelector('#save-promotion-confirm[open]')"))return;await new Promise(resolve=>setTimeout(resolve,50));}
    throw Error('Stored Save did not reach a terminal result or confirmation: '+await evaluate("document.querySelector('#status')?.textContent"));
  }finally{await evaluate('window.__storedSaveObserver?.disconnect();delete window.__storedSaveObserver;delete window.__storedSaveResult');}
}

// Touch layout (src/hud-row.ts): the page buttons live in the ☰ menu and the speeds behind
// one cycle button. Dock submenus are body-portaled on every viewport.
// Before a suite clicks a hidden control, reveal it using the actual user-facing buttons.
// Returns true when this helper completed the native Load/Save action, or when the
// target speed is already selected (nothing left for the caller to click).
export async function reachTouch(evaluate, button, selector) {
  if((storedLoadActions.has(selector)||selector==='#save')&&!loading.has(evaluate)){
    loading.add(evaluate);
    try{await (selector==='#save'?withStoredSaveCompletion:withStoredLoadCompletion)(evaluate,()=>button(selector));return true;}
    finally{loading.delete(evaluate);}
  }

  const target = JSON.stringify(selector);
  // Recovery controls are intentionally collapsed. Exercise the real summary first.
  for (const id of ['save-recovery-details','startup-recovery-details']) {
    if (selector !== `#${id} > summary` && await evaluate(`!!document.querySelector(${target})?.closest('#${id}:not([open])')`)) await button(`#${id} > summary`);
  }
  if (await evaluate(`!!document.querySelector(${target})?.closest('#select-submenu[hidden]')`)) {
    if (await evaluate(`!document.querySelector('[data-tool="select"]').getBoundingClientRect().width && document.querySelector('#inspector').dataset.open==='true'`)) await button('#close-inspector');
    await button('[data-tool="select"]');
  }
  const group = await evaluate(`document.querySelector(${target})?.closest('.grouped-tool-submenu[hidden]')?.id ?? ''`);
  if (group) {
    const anchor = `#${group.replace('-submenu', '-tool')}`;
    if (await evaluate(`!document.querySelector(${JSON.stringify(anchor)}).getBoundingClientRect().width && document.querySelector('#inspector').dataset.open==='true'`)) await button('#close-inspector');
    await button(anchor);
  }
  const where = await evaluate(`(()=>{const e=document.querySelector(${target});if(!e||e.getBoundingClientRect().width)return '';const shown=s=>!!document.querySelector(s)?.getBoundingClientRect().width;return e.closest('.page-buttons')&&shown('#hud-more')?'menu':e.matches('[data-speed]')&&shown('#speed-cycle')?'speed':''})()`);
  if (where === 'menu') await button('#hud-more');
  if (where !== 'speed') return false;
  for (let i = 0; i < 3 && await evaluate(`document.querySelector(${target}).getAttribute('aria-pressed')!=='true'`); i++) await button('#speed-cycle');
  return true;
}
