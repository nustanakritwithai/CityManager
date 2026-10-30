import test from 'node:test';
import assert from 'node:assert/strict';
import {TrafficFlow, FLOW_JUNCTION_CAPACITY} from '../src/traffic/flow.ts';
import {buildNetwork} from '../src/traffic/network.ts';
import {movementMask} from '../src/traffic/movements.ts';

const cross = () => buildNetwork({cells:Array.from({length:576}, (_, i) => ({road:[26,49,50,51,74].includes(i)}))}, {capacityPerLane:30});
function run(ods: {from:number;to:number;vehicles:number}[]) {
  const f = new TrafficFlow(), net = cross();
  f.advancePeriod(net, ods);
  return f.diagnostics(net);
}
test('opposite straight movements use disjoint space concurrently', () => {
  const sameAxis = run([{from:26,to:74,vehicles:100},{from:74,to:26,vehicles:100}]);
  const crossing = run([{from:26,to:74,vehicles:100},{from:49,to:51,vehicles:100}]);
  assert.ok(sameAxis.completed > crossing.completed * 1.8, JSON.stringify({sameAxis:sameAxis.completed,crossing:crossing.completed}));
  assert.ok(crossing.completed <= FLOW_JUNCTION_CAPACITY + 1e-6);
  assert.ok(Math.abs(sameAxis.conservationError)<1e-6);
  assert.ok(Math.abs(crossing.conservationError)<1e-6);
});
test('two approaches merging into the same exit share its receiving capacity', () => {
  const d = run([{from:26,to:74,vehicles:100},{from:49,to:74,vehicles:100}]);
  assert.ok(d.completed <= FLOW_JUNCTION_CAPACITY + 1e-6);
  assert.ok(d.waiting + d.onRoad > 170);
});

test('right-hand movement geometry permits opposite straight and separate right turns', () => {
  assert.equal(movementMask(26,50,74) & movementMask(74,50,26), 0);
  assert.equal(movementMask(26,50,49) & movementMask(49,50,74), 0);
  assert.notEqual(movementMask(26,50,74) & movementMask(49,50,51), 0);
  assert.notEqual(movementMask(26,50,74) & movementMask(49,50,74), 0);
});

test('full downstream storage spills back; widening only the approach leaves output bounded', () => {
  const simulate = (widen: boolean) => {
    const net = buildNetwork({cells:Array.from({length:576}, (_, i) => ({road:[25,26,27,28,50].includes(i)}))}, {capacityPerLane:30});
    net.links.get('26>27')!.capacityPerHour = 6;
    if (widen) { const approach = net.links.get('25>26')!; approach.lanes=2; approach.capacityPerHour=60; }
    const f = new TrafficFlow(); let full=false;
    for(let hour=0;hour<4;hour++) {
      f.advancePeriod(net,[{from:25,to:28,vehicles:100}]);
      const d=f.diagnostics(net); full ||= d.links.some(l=>l.key==='25>26'&&Math.abs(l.amount-l.storage)<1e-6);
      for(const l of d.links) assert.ok(l.amount<=l.storage+1e-6);
      assert.ok(Math.abs(d.conservationError)<1e-6);
    }
    assert.ok(full,'The congested approach must actually fill, not merely retain an origin queue');
    return f.diagnostics(net);
  };
  const base=simulate(false), wide=simulate(true);
  assert.ok(base.completed<=24&&wide.completed<=24);
  assert.ok(Math.abs(base.completed-wide.completed)<1e-6);
  assert.ok(wide.waiting<base.waiting,'Extra approach space can store traffic without inventing exit capacity');
});
