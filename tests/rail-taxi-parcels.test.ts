import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCity,buildRoad,serialize,deserialize} from '../src/sim.ts';
import {createParkRuntime,serializeParkSession,deserializeParkSession} from '../src/park-runtime.ts';
import {RailNetworkRuntime} from '../src/rail/network-runtime.ts';
import {isRailReserved,RAIL_PARCEL_MESSAGE} from '../src/rail/reserved-parcels.ts';
import {buildTaxiDepot,taxiSiteReason} from '../src/taxi/placement.ts';
import {taxiAt} from '../src/taxi/buildings.ts';
import {createSaveGuard} from '../src/save-guard.ts';
import {restoreStartupCity} from '../src/startup-save.ts';
import {loadLocalCitySession} from '../src/local-city-save.ts';
import {SAVE_KEY} from '../src/save-storage.ts';
import {marketJournalForTest} from '../src/market-client.ts';

const occupied=/Rail needs an empty reserved parcel/;
const memory=()=>{const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};
function fixture(){
  const city=createCity(61025,{starter:false}),runtime=createParkRuntime(city);
  assert.ok(buildRoad(city,288,264).ok);assert.ok(buildRoad(city,264,281).ok);
  const rail=RailNetworkRuntime.create(city,'combined-parcels',0);runtime.rail=rail;return {city,runtime,rail};
}
function reserve(rail:RailNetworkRuntime){rail.addStation('a',245);rail.editTrack(245,246,false,2);}
const claims=(city:ReturnType<typeof createCity>)=>city.cells.map((_,i)=>isRailReserved(city,i));

test('taxi-first rejects station and either track endpoint without allocating IDs or reservations',()=>{
  const {city,runtime,rail}=fixture();assert.ok(buildTaxiDepot(city,245,true).ok);city.taxi!.depots[0].open=false;
  const before=serializeParkSession(city,runtime),network=rail.snapshot,nextId=city.nextId,reservations=claims(city);
  for(const command of [()=>rail.addStation('a',245),()=>rail.editTrack(244,245,false,2),()=>rail.editTrack(245,246,false,2)]){
    assert.throws(command,occupied);assert.equal(serializeParkSession(city,runtime),before);assert.equal(city.nextId,nextId);
    assert.deepEqual(rail.snapshot,network);assert.deepEqual(claims(city),reservations);
  }
});

for(const kind of ['station','track'] as const)test(`rail-first rejects taxi on ${kind} parcels without allocating state or IDs`,()=>{
  const {city,runtime,rail}=fixture();if(kind==='station')rail.addStation('a',245);else rail.editTrack(245,246,false,2);
  const before=serializeParkSession(city,runtime),nextId=city.nextId;
  for(const cell of kind==='station'?[245]:[245,246]){
    assert.equal(taxiSiteReason(city,cell,true),RAIL_PARCEL_MESSAGE);assert.equal(buildTaxiDepot(city,cell,true).ok,false);
    assert.equal(city.taxi,undefined);assert.equal(city.nextId,nextId);assert.equal(serializeParkSession(city,runtime),before);
  }
});

for(const order of ['taxi-first','rail-first'])test(`${order} permits distinct assets and restores both optional systems and Guest bytes`,()=>{
  const {city,runtime,rail}=fixture();if(order==='taxi-first')assert.ok(buildTaxiDepot(city,243,true).ok);reserve(rail);
  if(order==='rail-first')assert.ok(buildTaxiDepot(city,243,true).ok);
  rail.addStation('b',246);rail.configureService({seats:8,queueCapacity:12,boardingPerMinute:4,alightingPerMinute:4,minimumDwellMinutes:2,minimumDepartureIntervalMinutes:4,maxBatches:128});
  rail.acceptPreparedDemand({id:'trip',from:291,to:305,offeredPersons:16,roadAdmittedPersons:0,leases:[]},{id:'batch',requestId:'trip',leaseId:'lease',from:291,to:305,fromStation:'a',toStation:'b',persons:16,readyAtMinute:0,egressMinutes:5});
  city.market=marketJournalForTest(null);city.market.guestId='00000000-0000-4000-8000-000000000003';
  const raw=serializeParkSession(city,runtime),loaded=deserializeParkSession(raw),nextId=loaded.city.nextId;
  assert.equal(serializeParkSession(loaded.city,loaded.runtime),raw);assert.deepEqual(loaded.city.market,city.market);
  assert.deepEqual(taxiAt(loaded.city,243),taxiAt(city,243));assert.deepEqual(loaded.runtime.rail!.snapshot,rail.snapshot);
  assert.equal(buildTaxiDepot(loaded.city,245,true).ok,false);assert.equal(buildTaxiDepot(loaded.city,246,true).ok,false);
  assert.throws(()=>loaded.runtime.rail!.editTrack(243,244,false,2),occupied);assert.equal(loaded.city.nextId,nextId);
  assert.equal(serializeParkSession(loaded.city,loaded.runtime),raw);
});

test('absent optional systems stay absent through combined-base save/reload',()=>{
  for(const mode of ['neither','taxi','rail']){
    const {city,runtime,rail}=fixture();if(mode==='rail')reserve(rail);else delete runtime.rail;
    if(mode==='taxi')assert.ok(buildTaxiDepot(city,243,true).ok);
    const raw=serializeParkSession(city,runtime),parsed=JSON.parse(raw),loaded=deserializeParkSession(raw);
    assert.equal(Object.hasOwn(parsed,'taxi'),mode==='taxi');assert.equal(Object.hasOwn(parsed.parkRuntime,'rail'),mode==='rail');
    assert.equal(serializeParkSession(loaded.city,loaded.runtime),raw);
  }
});

for(const [kind,cell] of [['station',245],['track',246]] as const){
  test(`overlapping ${kind} capture rejects before touching stored originals or existing reservations`,()=>{
    const {city,runtime,rail}=fixture();reserve(rail);assert.ok(buildTaxiDepot(city,243,true).ok);
    const good=serializeParkSession(city,runtime),s=memory();s.setItem(SAVE_KEY,good);s.setItem('immutable-backup',good);
    const guard=createSaveGuard(s);guard.acceptLoaded(good);const stored=[...s.data],network=rail.snapshot,reservations=claims(city);
    city.taxi!.depots[0].cell=cell;const core=serialize(city);assert.doesNotThrow(()=>deserialize(core),'core taxi envelope remains valid');
    assert.throws(()=>rail.capture(city,core,0),occupied);
    assert.throws(()=>guard.write(serializeParkSession(city,runtime),null),occupied);
    assert.deepEqual([...s.data],stored);assert.deepEqual(rail.snapshot,network);assert.deepEqual(claims(city),reservations);
  });
  test(`valid-digest overlapping ${kind} restore preserves originals and never publishes candidate reservations`,async()=>{
    const {city,runtime,rail}=fixture();reserve(rail);assert.ok(buildTaxiDepot(city,243,true).ok);
    const good=serializeParkSession(city,runtime),parsed=JSON.parse(good);parsed.taxi.depots[0].cell=cell;
    const {parkRuntime,...core}=parsed,coreRaw=JSON.stringify(core),target=deserialize(coreRaw);
    parkRuntime.rail.binding.cityRevision=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(core).sort().map(key=>[key,core[key]])))).digest('hex');
    const bad=JSON.stringify({...core,parkRuntime}),coreBefore=serialize(target);
    for(const prior of [false,true]){
      if(prior)RailNetworkRuntime.create(target,'existing-reservations',0).addStation('existing',500);
      const reservations=claims(target);assert.throws(()=>RailNetworkRuntime.restore(target,parkRuntime.rail,coreRaw,0),occupied);
      assert.deepEqual(claims(target),reservations);assert.equal(serialize(target),coreBefore);
    }
    assert.throws(()=>deserializeParkSession(bad),occupied);
    const s=memory();s.setItem(SAVE_KEY,bad);s.setItem('immutable-backup',good);const stored=[...s.data];
    const loaded=restoreStartupCity(s,()=>createCity(9));assert.ok(loaded.error);assert.equal(loaded.guard.armed,false);assert.equal(loaded.runtime.rail,undefined);
    assert.ok(claims(loaded.city).every(value=>!value));let applied=false;
    await assert.rejects(loadLocalCitySession(bad,undefined,loaded.guard,()=>{applied=true;}));
    assert.equal(applied,false);assert.deepEqual([...s.data],stored);
  });
}
