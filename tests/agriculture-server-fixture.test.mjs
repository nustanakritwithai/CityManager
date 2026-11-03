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
import {adoptSavedEducation} from '../src/sim.ts';

// This is the real scenario preflight only: --preflight exits before the fixture
// server, output directories or browser process are created.
test('full agriculture scenario preflight retains native chain and direct legacy sale',()=>{
 const r=spawnSync(process.execPath,['--experimental-strip-types','tests/agriculture-smoke.mjs','--preflight'],{encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.stderr);const report=JSON.parse(r.stdout);
 for(const flag of ['harvest','farmToMarket','marketToFactory','process','factoryToShop','shopToHousehold','marketToHousehold'])assert.equal(report.seen[flag],true,flag);
 assert.equal(report.chainTick,30);assert.equal(report.ownerActionTick,35);assert.equal(report.growth.birthTick,390);
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
 assert.ok(s.indexOf("assert.equal(occupied, false")<s.indexOf('await startPersistenceFixture(upstreamUrl)'));
 for(const text of ['modelAudit.verify(modelBefore)','modelAudit.assertComplete()','await storage.settle()','expectedRevision=before.revision+(failOnce?2:1)','assert.equal(events.length,failOnce?2:1)','assert.equal(e.command.expectedRevision,before.revision+i)','assert.equal(e.response.revision,before.revision+i+1)','assert.equal(events[0].requestKey,rejected.requestKey)','assert.deepEqual(events[0].command,rejected.command)','assert.notEqual(events[0].requestKey,events[1].requestKey)','installTrafficNetworkFence','additionalBlocked:panelProviderDenials(allowed.origin)','assert.deepEqual(providerRequests,[])','isPanelProviderRequest(u)','await loadRaw(oldRaw)','await loadRaw(legacyV4Raw)','await loadRaw(oldGrowthRaw)','await oneTick(direct)','cropCash-cropCost-goodsPurchase+householdSales','await storage.assertNoCityWrites(evaluate)'])assert.ok(s.includes(text),text);
 assert.doesNotMatch(s,/localStorage\.setItem\(['"]citymanager\.save/);
});

test('agriculture fence denies provider and foreign origins while allowing the service',()=>{
 const origin='http://127.0.0.1:4173',rules=trafficNetworkRules(origin,false,panelProviderDenials(origin));
 const decision=url=>rules.find(rule=>new URLPattern(rule.urlPattern).test(url))?.block;
 for(const path of ['/api/city-advisor/report','/CityManager/api/city-advisor/report','/x/y/api/city-advisor/report?q=1','/api/city-advisor/other','/CityManager/api/city-advisor/other','/x/y/api/city-advisor/other?q=1','/chat/completions','/CityManager/chat/completions','/x/y/chat/completions?q=1'])assert.equal(decision(origin+path),true,path);
 assert.equal(decision(origin+'/citymanager-api/v1/city-save'),false);assert.equal(decision(origin+'/CityManager/assets/game.js'),false);assert.equal(decision('https://example.com/chat/completions'),true);
});
