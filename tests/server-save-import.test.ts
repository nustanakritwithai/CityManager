import assert from 'node:assert/strict';
import test from 'node:test';
import {createCity,serialize} from '../src/sim.ts';
import {prepareLocalSaveImport} from '../src/server-save-import.ts';
import {MarketClient} from '../src/market-client.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('explicit import preserves original bytes and rejects invalid or unknown saves',()=>{
 const city=createCity(1,{starter:false}), raw=serialize(city), client=new MarketClient(()=>city);
 const formatted=' '+raw+' ';const result=prepareLocalSaveImport(formatted,id(1),null,v=>client.validateSave(v),()=>id(2));
 assert.equal(result.raw,formatted);assert.equal(result.cityId,id(2));
 assert.throws(()=>prepareLocalSaveImport('{"version":999}',id(1),null,()=>{},()=>id(2)));
 assert.throws(()=>prepareLocalSaveImport('{bad',id(1),null,()=>{},()=>id(2)));
});
test('financial imports refuse another Guest or ambiguous journal',()=>{
 const city=createCity(1,{starter:false}), client=new MarketClient(()=>city), journal=client.exportSave();
 journal.guestId=id(1);journal.cityId=id(2);journal.receipts[id(3)]={claimId:id(4),state:'claimed'};
 const raw=serialize(city,journal), validate=(v:unknown)=>client.validateSave(v);
 assert.throws(()=>prepareLocalSaveImport(raw,id(5),journal,validate),/guest-mismatch/);
 assert.throws(()=>prepareLocalSaveImport(raw,id(1),null,validate),/reconciliation-required/);
 const different=structuredClone(journal);different.seq='8';
 assert.throws(()=>prepareLocalSaveImport(raw,id(1),different,validate),/reconciliation-required/);
 assert.equal(prepareLocalSaveImport(raw,id(1),journal,validate).cityId,id(2));
 assert.throws(()=>prepareLocalSaveImport(serialize(city),id(1),journal,validate),/reconciliation-required/);
});
