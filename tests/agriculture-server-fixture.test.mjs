import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {startPersistenceFixture} from './persistence-server-fixture.mjs';
import {createPanelModelAudit} from './panel-model-audit.mjs';
import {panelProviderDenials} from './panel-network-denies.mjs';
import {trafficNetworkRules} from './traffic-server-entry-fixture.mjs';
import {createCity as oldCity4,step as oldStep4,serialize as oldSerialize4} from '../src/legacy-v4.ts';
import {createCity as oldCity5,step as oldStep5,serialize as oldSerialize5} from '../src/legacy-v5.ts';
import {deserializeParkSession,expandValidatedParkSession,serializeParkSession} from '../src/park-runtime.ts';
import {adoptSavedEducation,createCity,step,serialize,deserialize,zoneCell,access,isRetail,firmCapacity,ownerFinance} from '../src/sim.ts';
import {commercialPresentation} from '../src/commercial-visuals.ts';
import {buildingCardData} from '../src/building-card-data.ts';

// This is the real scenario preflight only: --preflight exits before the fixture
// server, output directories or browser process are created.
test('full agriculture scenario preflight retains native chain and direct legacy sale',()=>{
 const r=spawnSync(process.execPath,['--experimental-strip-types','tests/agriculture-smoke.mjs','--preflight'],{encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.stderr);const report=JSON.parse(r.stdout);
 for(const flag of ['harvest','farmToMarket','marketToFactory','process','factoryToShop','shopToHousehold','marketToHousehold'])assert.equal(report.seen[flag],true,flag);
 assert.equal(report.chainTick,30);assert.equal(report.ownerActionTick,35);assert.equal(report.growth.birthTick,390);
 assert.equal(report.visualExpected.marketStalls,2);assert.notEqual(report.visualExpected.marketStalls,1);
 assert.deepEqual(report.visualExpected.commercialTiers,{market:2,building:0,mall:0});
 assert.equal(report.visualBoundary.farmPlots,1);assert.equal(report.visualBoundary.marketStalls,3);
 assert.deepEqual(report.visualBoundary.commercialTiers,{market:3,building:2,mall:2});
});

test('v3, v4 and v5 real service heads retain original bytes before expanded-session ACK and reload',async()=>{
 const v3=await readFile(new URL('./fixtures/legacy-v3-day180.json',import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(v3).digest('hex'),'59518ff5b7d2a7c7de52ef8cb8362ed387f91df67ffc09934c93e97f3a556693');
 const old4=oldCity4(61025);for(let n=0;n<29;n++)oldStep4(old4);
 const old5=oldCity5(61025);for(let n=0;n<388;n++)oldStep5(old5);
 const upstream=createServer((req,res)=>res.end('fixture'));await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const f=await startPersistenceFixture(`http://127.0.0.1:${upstream.address().port}/CityManager/`);
 try{
  for(const raw of [v3,oldSerialize4(old4),oldSerialize5(old5)]){
   const source=deserializeParkSession(raw),before=await f.fixture.seed(raw);
   assert.equal(before.revision,1);assert.equal(before.raw,raw);assert.equal(f.fixture.active.raw,raw);
   const live=expandValidatedParkSession(source);assert.equal(source.city.cells.length,576);assert.equal(live.city.cells.length,672);
   assert.deepEqual(live.city.cells.slice(0,576),source.city.cells);assert.deepEqual(live.city.accounts,source.city.accounts);assert.deepEqual(live.city.households,source.city.households);
   if(!live.city.education)adoptSavedEducation(live.city);
   const expandedRaw=serializeParkSession(live.city,live.runtime,live.city.market);assert.notEqual(expandedRaw,raw);
   const key=randomUUID(),command={action:'save',cityId:before.cityId,expectedRevision:1,raw:expandedRaw,metadata:before.metadata};
   const response=await fetch(new URL('/citymanager-api/v1/city-save',f.url),{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(command)});
   assert.equal(response.status,200);const ack=await response.json();assert.equal(ack.raw,expandedRaw);assert.equal(ack.revision,2);assert.equal(ack.cityId,before.cityId);
   const get=await fetch(new URL('/citymanager-api/v1/city-save',f.url));assert.equal(get.status,200);assert.deepEqual(await get.json(),ack);
  }
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();await new Promise(r=>upstream.close(r));}
});

test('bounded per-document model audit waits for late console delivery and rejects an extra error',async()=>{
 const errors=[],sleep=async()=>{if(errors.length<41)errors.push('expected')};
 const audit=createPanelModelAudit({blocked:true,expectedErrors:errors,evaluate:async()=>({failed:Array(41).fill(0)}),sleep});
 const start=audit.begin();await audit.verify(start);audit.assertComplete();errors.push('unexpected');assert.throws(()=>audit.assertComplete());
});

test('browser harness requires loopback service, acknowledged saves and full scenario checks',async()=>{
 const s=await readFile(new URL('./agriculture-smoke.mjs',import.meta.url),'utf8');
 assert.ok(s.indexOf("assert.equal(occupied, false")<s.indexOf('await startPersistenceFixture(upstreamUrl,{traceSaves:true})'));
 for(const text of ['modelAudit.verify(modelBefore)','modelAudit.assertComplete()','await storage.settle()','expectedRevision=before.revision+(failOnce?2:1)','assert.equal(events.length,failOnce?2:1)','assert.equal(e.command.expectedRevision,before.revision+i)','assert.equal(e.response.revision,before.revision+i+1)','assert.equal(events[0].requestKey,rejected.requestKey)','assert.deepEqual(events[0].command,rejected.command)','assert.notEqual(events[0].requestKey,events[1].requestKey)','installTrafficNetworkFence','additionalBlocked:panelProviderDenials(allowed.origin)','assert.deepEqual(providerRequests,[])','isPanelProviderRequest(u)','await loadRaw(oldRaw)','await loadRaw(legacyV4Raw)','await loadRaw(oldGrowthRaw)','await oneTick(direct)','cropCash-cropCost-goodsPurchase+householdSales','await storage.assertNoCityWrites(evaluate)'])assert.ok(s.includes(text),text);
 assert.doesNotMatch(s,/localStorage\.setItem\(['"]citymanager\.save/);
});

test('agriculture fence denies provider and foreign origins while allowing the service',()=>{
 const origin='http://127.0.0.1:4173',rules=trafficNetworkRules(origin,false,panelProviderDenials(origin));
 const decision=url=>rules.find(rule=>new URLPattern(rule.urlPattern).test(url))?.block;
 for(const path of ['/api/city-advisor/report','/CityManager/api/city-advisor/report','/x/y/api/city-advisor/report?q=1','/api/city-advisor/other','/CityManager/api/city-advisor/other','/x/y/api/city-advisor/other?q=1','/chat/completions','/CityManager/chat/completions','/x/y/chat/completions?q=1'])assert.equal(decision(origin+path),true,path);
 assert.equal(decision(origin+'/citymanager-api/v1/city-save'),false);assert.equal(decision(origin+'/CityManager/assets/game.js'),false);assert.equal(decision('https://example.com/chat/completions'),true);
});


test('fresh commercial replay selects the real level-one building and its current exact tier label',async()=>{
 const start=createCity(61025),candidates=start.cells.map((cell,index)=>({cell,index})).filter(({cell,index})=>!cell.road&&cell.building===null&&access(start,index)).sort((a,b)=>Math.abs(a.index%24-6)+Math.abs(Math.floor(a.index/24)-12)-Math.abs(b.index%24-6)-Math.abs(Math.floor(b.index/24)-12));
 const farmCell=candidates.find(({index})=>start.resources.fertility[index]>=50).index,marketCell=candidates.find(({index})=>index!==farmCell).index;
 const city=deserialize(serialize(start));assert.equal(zoneCell(city,farmCell,'F').ok,true);assert.equal(zoneCell(city,marketCell,'C').ok,true);let firm;
 for(let day=0;day<180;day++){const before=deserialize(serialize(city));step(city);deserialize(serialize(city));firm=city.firms.find(f=>isRetail(f)&&!before.firms.some(old=>old.id===f.id));if(firm)break;}
 assert.ok(firm,'A genuine fresh commercial firm is created');const building=city.buildings.find(b=>b.id===firm.building);assert.ok(building);
 assert.equal(firm.zone,'C');assert.equal(building.zone,'C');assert.equal(building.level,1);assert.equal(firmCapacity(building),1);assert.ok(firm.owner);assert.equal(ownerFinance(city,firm.id)?.ownerHouseholdId,firm.owner.householdId);assert.ok(city.ledger.some(e=>e.from==='household:'+firm.owner.householdId&&e.to===firm.wallet&&e.amount===60000));
 const card=buildingCardData(city,building.id);assert.ok(card);assert.equal(card.identity.buildingId,building.id);assert.equal(card.identity.firmId,firm.id);assert.equal(commercialPresentation(building.level).label,'ตลาด · ระดับ 1/9');
 const panel=await readFile(new URL('../src/context-panels.ts',import.meta.url),'utf8'),runner=await readFile(new URL('./agriculture-smoke.mjs',import.meta.url),'utf8');
 assert.match(panel,/labels\[data.kind\] = commercialPresentation\(selectedBuilding.level\)\.label/);assert.ok(runner.includes("'ตลาด · ระดับ 1/9'"));assert.ok(runner.includes('await inspectBusiness(commercialAfter,newCommercial)'));assert.ok(runner.includes("await metrics({'owner-household':newCommercial.owner.householdId})"));assert.ok(runner.includes('await oneTick(commercialAfter)'));
});


test('legacy chain counts rendered commercial tiers by building level, not firm role',async()=>{
 const old=oldCity4(61025);for(let i=0;i<29;i++)oldStep4(old);
 const city=deserialize(oldSerialize4(old));adoptSavedEducation(city);step(city);assert.equal(city.tick,30);
 const rows=city.buildings.filter(b=>b.zone==='C').map(b=>({id:b.id,level:b.level,kind:city.firms.find(f=>f.building===b.id)?.commercialKind}));
 assert.deepEqual(rows,[{id:11,level:1,kind:'market'},{id:15,level:2,kind:'retail'}]);
 assert.equal(city.firms.filter(f=>f.commercialKind==='market').length,1);
 assert.deepEqual([1,2,3,4,6,7,9].map(level=>commercialPresentation(level).tier),['market','market','market','building','building','mall','mall']);
 const renderer=await readFile(new URL('../src/renderer.ts',import.meta.url),'utf8'),smoke=await readFile(new URL('./agriculture-smoke.mjs',import.meta.url),'utf8');
 assert.ok(renderer.includes("if (b.zone === 'C') { this.commercial(tile, b.level, commercialLit); continue; }"));
 assert.ok(renderer.includes("new Entity(`Commercial ${plan.tier}`)"));assert.ok(renderer.includes("findByName('Commercial market')"));
 assert.ok(smoke.includes('assert.equal(rendered.farmPlots,expectedVisuals.farmPlots)'));
 assert.ok(smoke.includes('assert.equal(rendered.marketStalls,expectedVisuals.marketStalls)'));
 assert.ok(smoke.includes('assert.deepEqual(rendered.commercialTiers,expectedVisuals.commercialTiers)'));
 assert.ok(smoke.includes('assert.deepEqual(await state(),live(chainAfter))'));
});
