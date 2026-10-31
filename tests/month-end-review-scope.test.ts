import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,step,reviewView,withGrowthReviewScope,buildRoad,zoneCell,GATEWAY,SIZE,type City} from '../src/sim.ts';
import {buildingIssues} from '../src/building-issues.ts';
const seeded=(day:number)=>{const c=createCity(42);while(c.tick<day)step(c);return c;};
function counted(c:City,read:()=>void){const original=JSON.stringify;let calls=0;JSON.stringify=((value:unknown,...args:any[])=>{if(value===c)calls++;return (original as any)(value,...args);}) as typeof JSON.stringify;try{read();return calls;}finally{JSON.stringify=original;}}
for(const day of [29,59])test(`one full-state review key per read-only building pass on day ${day}`,()=>{
 const c=seeded(day);for(const b of c.buildings)b.age=Math.max(30,b.age); // Mature fixture exercises first-month preview gates too.
 const before=JSON.stringify(c),reference=structuredClone(c);
 const calls=counted(c,()=>buildingIssues(c));assert.equal(calls,1,'all building explanations share one validated snapshot');
 assert.equal(JSON.stringify(c),before,'UI review cannot pay wages or mutate any state');
 step(c);step(reference);assert.deepEqual(c,reference,'following settlement remains exact');
});
test('nested scopes share reads; each later scope validates full same-day state',()=>{
 const c=seeded(59);let first:City|undefined;
 assert.equal(counted(c,()=>withGrowthReviewScope(c,()=>{first=reviewView(c);for(let i=0;i<20;i++)assert.equal(withGrowthReviewScope(c,()=>reviewView(c)),first);})),1);
 const changes=[()=>{c.accounts.treasury+=100;},()=>{c.buildings[0].age++;},()=>{c.utilities.outside.power++;},()=>{c.firms[0].monthlyRevenue++;},()=>{c.ledger.push({...c.ledger.at(-1)!,amount:17});}];
 for(const change of changes){change();const expected=reviewView(structuredClone(c));const actual=withGrowthReviewScope(c,()=>reviewView(c));assert.notEqual(actual,first);assert.deepEqual(actual,expected);first=actual;}
});
test('actual road and zoning commands invalidate between passes within same tick',()=>{
 const c=seeded(29);withGrowthReviewScope(c,()=>reviewView(c));const tick=c.tick;
 assert.equal(buildRoad(c,GATEWAY,GATEWAY+8).ok,true);
 assert.equal(zoneCell(c,GATEWAY+7-SIZE,'R').ok,true);
 assert.equal(c.tick,tick);assert.deepEqual(withGrowthReviewScope(c,()=>reviewView(c)),reviewView(structuredClone(c)));
});
test('throwing readers cannot leak stale scope; separate cities never share scope',()=>{
 const c=seeded(29),other=seeded(59);let old:City|undefined;
 assert.throws(()=>withGrowthReviewScope(c,()=>{old=reviewView(c);assert.equal(reviewView(other).tick,60);throw Error('reader failed');}),/reader failed/);
 c.accounts.treasury+=23;assert.notEqual(withGrowthReviewScope(c,()=>reviewView(c)),old);
 assert.deepEqual(reviewView(c),reviewView(structuredClone(c)));
});
test('ordinary-day explanations never create a month review or change city',()=>{
 const c=seeded(28),before=JSON.stringify(c);assert.equal(counted(c,()=>withGrowthReviewScope(c,()=>{assert.equal(reviewView(c),c);buildingIssues(c);})),0);assert.equal(JSON.stringify(c),before);
});
