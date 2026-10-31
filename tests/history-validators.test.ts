import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,step,type City} from '../src/sim.ts';
import {emptyCrops} from '../src/goods.ts';
import type {CityHistory} from '../src/city-history-types.ts';
import {captureAgricultureHistory,validateAgriculture} from '../src/agriculture-validation.ts';
import {captureTypedHistory,validateTypes} from '../src/goods-validation.ts';

function prefix(c:City, throughTick:number):City {
 const a=captureAgricultureHistory(c,throughTick),t=captureTypedHistory(c,throughTick);
 const history={...c.history,version:1,throughTick,cropOffset:(c.history?.cropOffset??0)+c.cropLedger.filter(e=>e.tick<=throughTick).length,goodsOffset:(c.history?.goodsOffset??0)+c.goodsLedger.filter(e=>e.tick<=throughTick).length,...a,...t,structuralProofs:[...(c.history?.structuralProofs??[]),...c.ledger.filter(e=>e.tick<=throughTick&&['Self-employed shop construction','Self-employed market construction','Market to shop conversion'].includes(e.reason))]} as CityHistory;
 return {...structuredClone(c),history,cropLedger:c.cropLedger.filter(e=>e.tick>throughTick),goodsLedger:c.goodsLedger.filter(e=>e.tick>throughTick),ledger:c.ledger.filter(e=>e.tick>throughTick)};
}
const original=createCity(61025);for(let i=0;i<180;i++)step(original);
test('prefix capture is read-only and exact suffix crop/value/types reconcile through repeated checkpoints',()=>{
 const before=JSON.stringify(original);const compact=prefix(original,150);
 validateAgriculture(compact,true,true);validateTypes(compact);
 const repeated=prefix(compact,150);validateAgriculture(repeated,true,true);validateTypes(repeated);
 assert.equal(JSON.stringify(original),before);assert.deepEqual(repeated.accounts,original.accounts);assert.deepEqual(repeated.firms,original.firms);assert.deepEqual(repeated.market,original.market);
});
test('checkpoint does not excuse corrupted suffix IDs, crop totals, holdings or typed stock',()=>{
 const compact=prefix(original,150);
 const totals=structuredClone(compact);totals.history!.cropTotals.harvested++;assert.throws(()=>validateAgriculture(totals,true,true));
 if(compact.cropLedger.length){const ids=structuredClone(compact);ids.cropLedger[0].id++;assert.throws(()=>validateAgriculture(ids,true,true));}
 const f=compact.firms.find(f=>f.zone==='F');if(f){const typed=structuredClone(compact);typed.history!.typedCrops[f.wallet]??=emptyCrops();const mix=typed.history!.typedCrops[f.wallet];const key=Object.keys(mix)[0] as keyof typeof mix;mix[key]++;assert.throws(()=>validateTypes(typed));}
});
test('one retained pre-checkpoint recipe selection remains valid without weakening uncheckpointed choice shape',()=>{
 const compact=prefix(original,150);const f=compact.firms.find(f=>f.zone==='I');assert.ok(f);
 f.recipeChoices=[{at:0,recipe:f.recipe!}];assert.doesNotThrow(()=>validateTypes(compact));
 const fresh=createCity(61025);const factory=fresh.firms.find(f=>f.zone==='I');if(factory){factory.recipeChoices=[{at:0,recipe:factory.recipe!}];assert.throws(()=>validateTypes(fresh));}
});
