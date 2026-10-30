import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficFlow} from '../src/traffic/flow.ts';
import {buildNetwork} from '../src/traffic/network.ts';

const road=()=>buildNetwork({cells:Array.from({length:576},(_,i)=>({road:[25,26,27,28,50].includes(i)}))},{capacityPerLane:30});
const offer={requestId:'private:one',from:25,to:28,vehicles:100};

test('request identity survives shared OD routing and receipts reflect actual capacity',()=>{
  const f=new TrafficFlow(),net=road();
  f.enqueue([offer,{...offer,requestId:'taxi:empty',vehicles:1}]);
  f.advanceMinutes(net,[],1);
  assert.equal(f.receipt('private:one')!.completed,0);
  assert.equal(f.receipt('taxi:empty')!.completed,0);
  f.advancePeriod(net,[]);
  const a=f.receipt('private:one')!,b=f.receipt('taxi:empty')!;
  assert.equal(a.offered,100);assert.equal(b.offered,1);
  assert.ok(a.completed+b.completed<=30.5);
  assert.equal(f.snapshot.requests.length,2);
});

test('duplicate offers are idempotent; changed payload or conflicting batch rejects atomically',()=>{
  const f=new TrafficFlow();f.enqueue([offer]);f.enqueue([offer]);assert.equal(f.snapshot.offered,100);
  const before=f.snapshot;
  assert.throws(()=>f.enqueue([{...offer,requestId:'new'}, {...offer,vehicles:101}]));
  assert.deepEqual(f.snapshot,before);
  assert.throws(()=>f.enqueue([{...offer,requestId:'new'},{...offer,requestId:'new',to:27}]));
  assert.deepEqual(f.snapshot,before);
});

test('only waiting traffic transfers ownership; admitted mass remains on the road',()=>{
  const f=new TrafficFlow();f.enqueue([offer]);f.advancePeriod(road(),[]);
  const before=f.receipt(offer.requestId)!;
  f.transferWaiting(offer.requestId,20);
  const after=f.receipt(offer.requestId)!;
  assert.equal(after.admitted,before.admitted);assert.equal(after.completed,before.completed);
  assert.equal(after.transferred,20);assert.equal(after.waiting,before.waiting-20);
  const snapshot=f.snapshot;assert.throws(()=>f.transferWaiting(offer.requestId,after.waiting+1));assert.deepEqual(f.snapshot,snapshot);
  assert.ok(Math.abs(f.diagnostics(road()).conservationError)<1e-7);
});

test('minute-level receipts and transferred ownership survive reload exactly',()=>{
  const a=new TrafficFlow(),net=road();a.enqueue([offer]);a.advanceMinutes(net,[],3);a.transferWaiting(offer.requestId,10);
  const b=TrafficFlow.restore(JSON.parse(JSON.stringify(a.snapshot)));
  a.advanceMinutes(net,[],7);b.advanceMinutes(net,[],7);
  assert.deepEqual(a.snapshot,b.snapshot);assert.deepEqual(a.receipt(offer.requestId),b.receipt(offer.requestId));
  b.enqueue([offer]);assert.deepEqual(a.snapshot,b.snapshot);
  const bad=a.snapshot;bad.requests[0].admitted+=1;assert.throws(()=>TrafficFlow.restore(bad));
  const lost=a.snapshot;lost.requests=[];assert.throws(()=>TrafficFlow.restore(lost));
});

test('legacy untracked flow retains its exact mass when restored into the receipt codec',()=>{
  const legacy={version:1,minute:0,offered:3,admitted:0,completed:0,peakQueued:3,waiting:[{from:25,to:28,amount:3}],batches:[]};
  const f=TrafficFlow.restore(legacy);assert.equal(f.snapshot.offered,3);assert.equal(f.snapshot.transferred,0);
  f.advancePeriod(road(),[]);assert.equal(f.snapshot.completed,3);
});
