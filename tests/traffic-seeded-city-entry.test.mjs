import test from 'node:test';
import assert from 'node:assert/strict';
import {enterSeededCity} from './traffic-seeded-city-entry.mjs';
for(const legacy of [true,false])test(`known primary real UI entry: ${legacy?'legacy':'current'}`,async()=>{
 const clicks=[],keys=[],waits=[];let open=true;
 const evaluate=async expression=>{
  if(expression==='localStorage.getItem(\'citymanager.save.v7\')'||expression==='window.cityManager.sessionSnapshot()')return 'fixture';
  if(expression.includes("!!document.querySelector('#startup-recovery-chooser[open]')"))return open;
  if(expression.includes("!!document.querySelector('#startup-recover-current')"))return legacy;
  if(expression.includes(".hidden"))return false;
  if(expression.includes('findIndex'))return 1;
  if(expression.includes('notice:'))return {notice:'test'};
  if(expression.includes(".value"))return 'stored:current';
  throw Error(`Unexpected evaluate ${expression}`);
 };
 await enterSeededCity({raw:'fixture',evaluate,button:async s=>{clicks.push(s);if(s==='#startup-recover-current'||s==='#startup-enter-city')open=false;},send:async(m,p)=>keys.push([m,p]),until:async e=>{waits.push(e);}});
 assert.deepEqual(clicks,legacy?['#startup-recover-current']:['#startup-city-choice','#startup-enter-city']);
 assert.equal(keys.length,legacy?0:6);assert.ok(waits.some(x=>x.includes('!document.querySelector')));assert.equal(open,false);
});
test('legacy entry rejects changed original bytes before clicking',async()=>{
 let clicked=false;
 await assert.rejects(enterSeededCity({raw:'expected',evaluate:async e=>e.includes('localStorage')?'wrong':true,button:async()=>{clicked=true;},send:async()=>{},until:async()=>{}}),/Known fixture primary/);
 assert.equal(clicked,false);
});
