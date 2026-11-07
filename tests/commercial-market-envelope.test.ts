import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deserialize,serialize} from '../src/sim.ts';
import {embeddedMarketJournal,MarketClient,marketJournalForTest} from '../src/market-client.ts';
import {SAVE_KEY} from '../src/save-storage.ts';
import { useMarketStorage } from '../src/market-client.ts';
const guest='00000000-0000-4000-8000-000000000003',other='00000000-0000-4000-8000-000000000006';
function fixture(version:24|25){
  const c=deserialize(readFileSync(new URL('./fixtures/retail-v15.json',import.meta.url),'utf8'));
  const journal=marketJournalForTest(null);journal.guestId=guest;journal.seq='4';
  journal.operations.push({opId:'00000000-0000-4000-8000-000000000002',guestId:guest,cityId:journal.cityId,kind:'buy',payload:{listing_id:'test',quantity:1},state:'pending',createdAt:'2026-10-31T00:00:00.000Z'});
  const envelope=JSON.parse(serialize(c,journal));
  if(version===24){envelope.version=24;envelope.rulesVersion='chain-19';delete envelope.commercialBaseVersion; delete envelope.farmBaseVersion; delete envelope.farmSoilIndependentStartTick;delete envelope.commercialUnifiedStartTick;delete envelope.commercialUnifiedBaseline;}
  return{raw:JSON.stringify(envelope),journal};
}

test('shared extractor validates v24/v25 and preserves pending journal without a write or identity change',()=>{
  for(const version of[24,25]as const){const{raw,journal}=fixture(version);assert.deepEqual(embeddedMarketJournal(raw),journal);}
  assert.equal(embeddedMarketJournal(null),null);
  for(const mutate of[(e:any)=>{e.version=99;},(e:any)=>{e.rulesVersion='invalid';},(e:any)=>{e.market.operations=[{kind:'unknown'}];},(e:any)=>{e.market.guestId=null;},(e:any)=>{e.accounts.treasury++;}]){
    const e=JSON.parse(fixture(25).raw);mutate(e);assert.throws(()=>embeddedMarketJournal(JSON.stringify(e)));
  }
  assert.throws(()=>embeddedMarketJournal('{broken'));
  assert.throws(()=>embeddedMarketJournal(JSON.stringify({version:11})),/recovery/);
});

