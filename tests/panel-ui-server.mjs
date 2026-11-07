// Authenticated synthetic server fixture for contextual UI acceptance.
import assert from 'node:assert/strict';
import { adoptSavedEducation, serialize } from '../src/sim.ts';
import { deserializeParkSession } from '../src/park-runtime.ts';
import { browserSnapshotState } from './browser-snapshot.ts';
import { completeTrafficManualSave, loadedTrafficSession } from './traffic-server-entry-fixture.mjs';

export function panelEntryCity(raw) {
 const city=loadedTrafficSession(raw).city;
 if(!city.education)adoptSavedEducation(city);
 return city;
}
/** Every observed mutation is an exact service ACK in one revision chain. */
export function assertPanelSaveChain(before,after,events,raw,prior=[]) {
 assert.ok(before&&after&&!before.deleted&&!after.deleted);assert.equal(after.cityId,before.cityId);
 let revision=before.revision,saves=0;const seen=new Map();
 for(const e of prior)if(e.requestKey&&e.status===200&&e.command?.cityId===before.cityId&&e.response?.revision<=revision)seen.set(e.requestKey,e);
 for(const e of events){
  assert.equal(e.status,200);assert.equal(e.command.action,'save');assert.equal(e.command.cityId,before.cityId);assert.equal(e.command.raw,raw);assert.equal(e.response.cityId,before.cityId);assert.equal(e.response.raw,raw);
  const old=e.requestKey&&seen.get(e.requestKey);
  if(old){assert.deepEqual(e.command,old.command);assert.deepEqual(e.response,old.response);assert.ok(e.response.revision<=revision);continue;}
  assert.equal(e.command.expectedRevision,revision);assert.equal(e.response.revision,++revision);saves++;if(e.requestKey)seen.set(e.requestKey,e);
 }
 assert.ok(saves>0,'Native Save produces a newly acknowledged revision');assert.equal(after.revision,revision);assert.equal(after.raw,raw);
 return {beforeRevision:before.revision,afterRevision:revision,saves};
}
export async function loadPanelCity(server,raw,{send,evaluate,button,until,url}) {
 if(await evaluate('!!window.cityManager'))await server.leave({send,evaluate,until});
 const ack=await server.seed(raw);server.allowNavigation();await send('Page.navigate',{url});await server.enter({send,evaluate,button,until});
 assert.equal(ack.raw,raw);assert.equal(server.active.raw,raw);assert.equal(server.active.revision,ack.revision);
 assert.deepEqual(browserSnapshotState(await evaluate('window.cityManager.snapshot()')),panelEntryCity(raw));
 assert.equal(await evaluate('window.cityManager.parks().paused'),true);await server.assertNoCityWrites(evaluate);
 return ack;
}
// Bounded synthetic metadata only: no city IDs, raw bytes, keys or response text.
export function panelSaveEvidence(server,before,cursor,raw) {
 const after=server.active,writes=server.writes;
 return {beforeRevision:before?.revision,afterRevision:after?.revision,sameCity:after?.cityId===before?.cityId,beforeRawMatches:before?.raw===raw,afterRawMatches:after?.raw===raw,cursor,totalWrites:writes.length,
  writes:writes.slice(-40).map((event,offset)=>{const index=Math.max(0,writes.length-40)+offset;return {index,status:event.status,expectedRevision:event.command?.expectedRevision,ackRevision:event.response?.revision,rawMatches:event.command?.raw===raw,ackRawMatches:event.response?.raw===raw,repeatedKey:!!event.requestKey&&writes.slice(0,index).some(previous=>previous.requestKey===event.requestKey)};})};
}
export async function saveAndReloadPanel(server,expected,{send,evaluate,button,until}) {
 assert.equal(await evaluate('window.cityManager.parks().paused'),true);
 const raw=await evaluate('window.cityManager.sessionSnapshot()'),actual=deserializeParkSession(raw).city;
 assert.equal(serialize(actual),serialize(expected),'Save captures the exact expected economic city');assert.deepEqual(actual,expected);
 const before=server.active,cursor=server.writes.length;
 try {
  // The shared badge can be completed by autosave. Require the real explicit
  // handler's fresh success too; neither signal substitutes for the ACK chain.
  await completeTrafficManualSave(evaluate,button,until);
  const end=Date.now()+30000;while(Date.now()<end&&!(server.active?.raw===raw&&server.active.revision>before.revision))await new Promise(r=>setTimeout(r,80));
  await server.settle();assertPanelSaveChain(before,server.active,server.writes.slice(cursor),raw,server.writes.slice(0,cursor));
  // A queued clean-state verification can replace the manual-write label after
  // its exact new-revision ACK above. Pending, failed or older bytes are not settled.
  await until("(()=>{const text=document.querySelector('#autosave-status')?.textContent;return ['บันทึกบนเซิร์ฟเวอร์แล้ว','ตรวจสอบแล้วว่าเซฟบนเซิร์ฟเวอร์ตรงกัน'].some(label=>text?.startsWith(label))&&!document.querySelector('#save-failure-banner:not([hidden])')})()");
 } catch(error) {
  const evidence=panelSaveEvidence(server,before,cursor,raw);
  try { evidence.ui=await evaluate("(()=>{const e=document.querySelector('#save'),badge=document.querySelector('#autosave-status'),r=e?.getBoundingClientRect();return {savePresent:!!e,disabled:e?.disabled??null,visible:!!(r?.width&&r?.height),hit:!!(r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#save')),pending:!!badge?.textContent?.startsWith('กำลังบันทึก'),failed:!!document.querySelector('#save-failure-banner:not([hidden])'),manualSuccess:document.querySelector('#inspector-status')?.textContent==='บันทึกเมืองบนเซิร์ฟเวอร์แล้ว · ตลาดยังปิดอยู่'}})()"); }
  catch { evidence.uiUnavailable=true; }
  // Appending to the existing stack preserves the primary failure in reports.
  error.panelSaveEvidence=evidence;error.stack+='\nPanel Save evidence: '+JSON.stringify(evidence);throw error;
 }
 await server.assertNoCityWrites(evaluate);const acknowledged=server.active;
 server.allowNavigation();await send('Page.reload',{ignoreCache:true});await server.enter({send,evaluate,button,until});
 assert.equal(server.active.raw,raw);assert.equal(server.active.cityId,acknowledged.cityId);
 assert.equal(server.navigationEvidence.at(-1).beforeRevision,acknowledged.revision);
 assert.deepEqual(browserSnapshotState(await evaluate('window.cityManager.snapshot()')),expected);
 assert.equal(await evaluate('window.cityManager.parks().paused'),true);await server.assertNoCityWrites(evaluate);
 return server.active;
}
