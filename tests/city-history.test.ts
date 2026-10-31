import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, serialize, deserialize, step } from '../src/sim.ts';
import { deserializeParkSession,serializeParkSession } from '../src/park-runtime.ts';
import { compactCityHistory } from '../src/city-history.ts';
import { SERVER_CITY_MAX_BYTES,serverCityBytes,assertServerCitySize } from '../src/server-save-size.ts';
import { oversizedLegacyCity } from './history-fixture.ts';
import { dailySeries } from '../src/city-series.ts';
import { cityRecord } from '../src/city-goals.ts';

test('oversized valid old save migrates below server cap without changing any property or market journal',()=>{
 const raw=oversizedLegacyCity(),original=JSON.parse(raw);assert.ok(serverCityBytes(raw)>SERVER_CITY_MAX_BYTES);
 const {city,runtime}=deserializeParkSession(raw),packed=serializeParkSession(city,runtime,city.market);
 assert.ok(serverCityBytes(packed)<100_000);assertServerCitySize(packed);
 for(const key of ['accounts','cells','buildings','households','firms','crops','goods','rng','tick','market'])assert.deepEqual((city as any)[key],original[key],key);
 assert.equal(city.history!.totals.moneyCount+city.ledger.length,original.ledger.length);
 assert.equal(city.history!.totals.moneyAmount+city.ledger.reduce((n,e)=>n+e.amount,0),original.ledger.reduce((n:number,e:any)=>n+e.amount,0));
 assert.equal(compactCityHistory(city),false);assert.equal(serializeParkSession(city,runtime,city.market),packed);
 assert.equal(serializeParkSession(deserializeParkSession(packed).city,runtime),packed);
 assert.equal(raw,JSON.stringify(original),'Source bytes untouched');
});
test('runtime remains bounded through repeated monthly checkpoints; reload and current stats remain valid',()=>{
 const city=createCity(123);for(let i=0;i<180;i++)step(city);
 assert.ok(city.history);const first=city.history.throughTick;
 for(let i=0;i<65;i++){step(city);if(i%15===0)assert.deepEqual(deserialize(serialize(city)).accounts,city.accounts);}
 assert.ok(city.history!.throughTick>first);assert.ok(city.ledger.every(e=>e.tick>city.history!.throughTick));
 assert.ok(city.history!.daily.length<=90);assert.ok(city.tick-city.history!.throughTick<=59);
 const restored=deserialize(serialize(city));assert.deepEqual(cityRecord(restored),cityRecord(city));assert.deepEqual(dailySeries(restored,90),dailySeries(city,90));
 assert.ok(dailySeries(city,Infinity).ticks.length<=90,'Do not fabricate missing lifetime days as zeros');
});
test('malformed checkpoints fail closed, including omitted daily totals and too-recent boundaries',()=>{
 const city=createCity(123,{starter:false});city.tick=120;compactCityHistory(city);
 const raw=JSON.parse(serialize(city));
 for(const mutate of [(c:any)=>{c.history.throughTick=120;},(c:any)=>{delete c.history.goodsTotals.produced;},(c:any)=>{c.history.daily=[{tick:1}];},(c:any)=>{delete c.typeBaseline;}]){
  const bad=structuredClone(raw);mutate(bad);assert.throws(()=>deserialize(JSON.stringify(bad)),/corrupt/);
 }
});
test('8 MiB means UTF-8 bytes and oversize preflight never truncates content',()=>{
 const raw='ก'.repeat(3_000_000);assert.equal(serverCityBytes(raw),9_000_000);assert.throws(()=>assertServerCitySize(raw),(e:any)=>e.status===413&&e.code==='save-too-large');assert.equal(raw.length,3_000_000);
});

test('oversize client request fails before pending intent or any mutation request',async()=>{
 const {ServerCitySaveClient}=await import('../src/server-city-save.ts');let requests=0;
 const client=new ServerCitySaveClient(async()=>{requests++;return null;},'00000000-0000-4000-8000-000000000001');await client.load();
 const raw=oversizedLegacyCity();await assert.rejects(client.create(raw,{name:'fixture',population:0,tick:120}),/8 MiB/);
 assert.equal(client.pending,false);assert.equal(requests,1);await assert.rejects(client.archive({source:'fixture',raw}),/8 MiB/);assert.equal(requests,1);
});

test('network and audio cursors remain monotonic when a monthly checkpoint removes old rows',async()=>{
 const {networkSnapshot,networkEvents}=await import('../src/city-network.ts');
 const {cueSnapshot,cityCues}=await import('../src/audio-cues.ts');
 const {buildRoad,GATEWAY}=await import('../src/sim.ts');
 const city=createCity(123);for(let i=0;i<59;i++)step(city);
 const network=networkSnapshot(city),audio=cueSnapshot(city);step(city);assert.ok(city.history);
 assert.ok(networkSnapshot(city).ledger>=network.ledger);assert.ok(cueSnapshot(city).ledger>=audio.ledger);
 assert.equal(buildRoad(city,GATEWAY+11,GATEWAY+11).ok,true);
 assert.ok(networkEvents(network,city).some(event=>event.node==='roads'));
 assert.ok(Array.isArray(cityCues(audio,city)));
});
