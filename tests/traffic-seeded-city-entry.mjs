import assert from 'node:assert/strict';
// Observation only: delegate every native IDB operation and leave its handlers intact.
export const observeRecoveryIdb = `(()=>{window.__recoveryIdb=[];const native=IDBFactory.prototype.open;IDBFactory.prototype.open=function(...args){if(args[0]!=='citymanager.emergency-recovery-v1')return native.apply(this,args);const row={at:Date.now(),events:[]};window.__recoveryIdb.push(row);let req;try{req=native.apply(this,args)}catch(e){row.events.push({type:'throw',name:e.name,message:e.message});throw e}for(const type of ['upgradeneeded','blocked','error','success'])req.addEventListener(type,()=>row.events.push({type,at:Date.now(),error:type==='error'?req.error?.name??null:null,message:type==='error'?req.error?.message??null:null}));return req;}})();`;
/** Deterministic storage-denied fixture for the bounded core/full traffic fixtures.
 * It exercises the real protected chooser without unrelated 10 s browser IDB
 * startup stalls. Native IDB success/failure is covered by save-safety CI; this
 * profile does not claim normal-storage coverage or cure the observed stall;
 * extended traffic and separate save-safety/UX suites retain native IDB.
 */
export const denyRecoveryIdbForTraffic = `(()=>{window.__trafficRecoveryStorage={mode:'synthetic-recovery-idb-denied',denials:0};const native=IDBFactory.prototype.open;IDBFactory.prototype.open=function(...args){if(args[0]!=='citymanager.emergency-recovery-v1')return native.apply(this,args);window.__trafficRecoveryStorage.denials++;throw new DOMException('Synthetic traffic fixture: recovery IndexedDB denied','SecurityError');};})();`;
/** The fixture is a known primary, not a production default or newest-day guess.
 * Use the visible selector and Enter with real mouse/touch/keyboard input.
 */
export async function enterSeededCity({evaluate,button,send,until,raw}) {
  if(!await evaluate("!!document.querySelector('#startup-recovery-chooser[open]')"))return;
  const evidence=()=>evaluate("({notice:document.querySelector('#startup-recovery-notice')?.textContent,idb:window.__recoveryIdb,choices:[...(document.querySelector('#startup-city-choice')?.options??[])].map(o=>({id:o.value,label:o.textContent}))})");
  try{
    assert.equal(await evaluate("localStorage.getItem('citymanager.save.v7')"),raw,'Known fixture primary is unchanged before deliberate entry');
    await until("[...(document.querySelector('#startup-city-choice')?.options??[])].some(o=>o.value==='stored:current')");
    if(await evaluate("document.querySelector('#startup-city-choice').hidden"))await button('#startup-change-city');
    await button('#startup-city-choice');
    const index=await evaluate("[...document.querySelector('#startup-city-choice').options].findIndex(o=>o.value==='stored:current')");
    const key=async(key,code)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:code==='Home'?36:code==='ArrowDown'?40:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:code==='Home'?36:code==='ArrowDown'?40:13});};
    await key('Home','Home');for(let i=0;i<index;i++)await key('ArrowDown','ArrowDown');await key('Enter','Enter');
    assert.equal(await evaluate("document.querySelector('#startup-city-choice').value"),'stored:current','Fixture explicitly selects primary');
    console.log('Explicit seeded primary entry',JSON.stringify(await evidence()));
    await button('#startup-enter-city');await until("!document.querySelector('#startup-recovery-chooser[open]')");
    assert.equal(await evaluate('window.cityManager.sessionSnapshot()'),raw,'Entered session exactly matches the known fixture');
    assert.equal(await evaluate("localStorage.getItem('citymanager.save.v7')"),raw,'Entry never rewrites the fixture');
  }catch(error){console.error('Seeded entry diagnostics',JSON.stringify(await evidence()));throw error;}
}
