import test from 'node:test';
import assert from 'node:assert/strict';
import {createCity,step} from '../src/sim.ts';
import {CROPS,PRODUCTS} from '../src/goods.ts';
import {firmGoodsLine,firmGoodsName} from '../src/goods-view.ts';
import {buildingCardData} from '../src/building-card-data.ts';
import {dailySeries,BUILDING_ORDER} from '../src/city-series.ts';
import {supplyChain} from '../src/overview-data.ts';
import {networkValues,networkSnapshot} from '../src/city-network.ts';
import {answerCityFactQuestion} from '../src/city-questions.ts';
test('display data includes both inventories, counts C once, and never groups by historical role',()=>{
 const c=createCity(61025);for(let i=0;i<90;i++)step(c);
 const firms=c.firms.filter(f=>f.zone==='C');assert.ok(firms.length);const f=firms[0],b=c.buildings.find(b=>b.id===f.building)!;
 // Synthetic display-only stock examples; no economic simulation or save validation is claimed.
 f.crops[CROPS[0]]=2;f.products[PRODUCTS[0]]=3;f.cropInventory=2;f.inventory=3;
 const chain=supplyChain(c),series=dailySeries(c),snapshot=networkSnapshot(c);
 assert.equal(series.buildings.shop.at(-1),c.buildings.filter(b=>b.zone==='C').length);
 assert.equal(series.buildings.market.at(-1),0);assert.equal(BUILDING_ORDER.filter(k=>k==='market').length,0);
 assert.equal(BUILDING_ORDER.reduce((n,k)=>n+series.buildings[k].at(-1)!,0),c.buildings.length);
 for(const historical of ['market','retail'] as const){
  f.commercialKind=historical;
  const line=firmGoodsLine(c,f);assert.match(line,/พืชผล:/);assert.match(line,/สินค้าสำเร็จรูป:/);assert.match(line,/2/);assert.match(line,/3/);
  assert.deepEqual(supplyChain(c),chain);assert.deepEqual(dailySeries(c),series);assert.deepEqual(networkSnapshot(c),snapshot);
  assert.equal(networkValues(c).markets,firms.length);assert.equal(networkValues(c).shops,firms.length);
  const answer=answerCityFactQuestion(c,{schemaVersion:1,intent:'business.detail',entityId:f.id});
  assert.equal(answer.facts.find(x=>x.id==='business.crop-inventory')?.value,2);
  assert.equal(answer.facts.find(x=>x.id==='business.inventory')?.value,3);
  for(const level of [1,3,4,6,7,9]){
   b.level=level;assert.equal(firmGoodsName(c,f),level<=3?'ตลาด':level<=6?'อาคารพาณิชย์':'Big Mall');
   const card=buildingCardData(c,b.id)!;assert.equal(card.kind,level<=3?'market':'shop');assert.equal(card.stocks.crops,2);assert.equal(card.stocks.goods,3);
  }
  b.level=1; // construction-history grouping is independent of the current architectural tier
 }
});
