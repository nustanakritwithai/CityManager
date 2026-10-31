import test from 'node:test';
import assert from 'node:assert/strict';
import { LANE_SLOTS, LANE_END, SLOT_PITCH, CAR_LENGTH, QUEUE_GAP } from '../src/citizen-road-queue.ts';
import { overlappingPairs } from '../src/citizen-road-queue.ts';
import { TRAFFIC_SPACING, bumperGap, desiredFollowingGap, updateVehicleFollowing, vehicleBox, type LaneVehicle } from '../src/traffic/spacing.ts';
import { TrafficGame, type TrafficGameSample } from '../src/traffic/game.ts';
import { gamePoses } from '../src/traffic/game-poses.ts';

const car = (pos: number, speed: number, max = TRAFFIC_SPACING.maxSpeedTiles * TRAFFIC_SPACING.worldPerTile): LaneVehicle =>
  ({ posOnLane: pos, speed, maxSpeed: max, length: TRAFFIC_SPACING.lengths.sedan });

test('three sedans fit on a lane and the standstill bumper gap is 0.09 world units', () => {
  assert.equal(TRAFFIC_SPACING.maxPerLanePerTile, 3);
  assert.equal(LANE_SLOTS, 3);
  assert.ok(Math.abs(QUEUE_GAP * TRAFFIC_SPACING.worldPerTile - TRAFFIC_SPACING.standstillGap) < 1e-9);
  assert.ok(Math.abs(SLOT_PITCH - (CAR_LENGTH + QUEUE_GAP)) < 1e-9);
  const centres = [LANE_END - 2 * SLOT_PITCH, LANE_END - SLOT_PITCH, LANE_END];
  for (let i = 1; i < centres.length; i++) {
    const gap = (centres[i] - centres[i - 1]) * TRAFFIC_SPACING.worldPerTile - TRAFFIC_SPACING.lengths.sedan;
    assert.ok(Math.abs(gap - 0.09) < 1e-9, String(gap));
  }
});

test('a stopped leader is queued at the standstill gap and never overlapped', () => {
  const leader = car(5, 0, 0), follower = car(5 - 3, 2);
  for (let i = 0; i < 80; i++) updateVehicleFollowing(follower, leader, 0.05);
  const gap = bumperGap(follower, leader);
  assert.ok(Math.abs(gap - TRAFFIC_SPACING.standstillGap) < 0.02, String(gap));
  assert.ok(gap >= TRAFFIC_SPACING.standstillGap - 1e-6);
  assert.ok(follower.speed < 0.05);
});

test('moving followers settle on standstillGap + speed * headwayFactor', () => {
  const max = TRAFFIC_SPACING.maxSpeedTiles * TRAFFIC_SPACING.worldPerTile;
  // Already at max speed, so the follower can only fall back — start inside the desired gap.
  const leader = car(0, max), follower = car(-(TRAFFIC_SPACING.lengths.sedan + 0.12), max);
  for (let i = 0; i < 400; i++) {
    leader.posOnLane += leader.speed * 0.05;
    updateVehicleFollowing(follower, leader, 0.05);
  }
  const gap = bumperGap(follower, leader);
  const expected = desiredFollowingGap(follower.speed);
  assert.ok(Math.abs(follower.speed - max) < 0.15, String(follower.speed));
  assert.ok(Math.abs(gap - expected) < 0.08, `gap ${gap} expected ${expected}`);
  assert.ok(gap > TRAFFIC_SPACING.standstillGap);
});

test('queued traffic keeps a bumper gap and at most 3 vehicles per lane, with no pose overlap', () => {
  const roads = new Set([25, 26, 27, 28, 50]);
  const sample: TrafficGameSample = { map: { cells: Array.from({ length: 576 }, (_, i) => ({ road: roads.has(i) })) }, demand: [{ from: 25, to: 28, rate: 4 }] };
  const game = new TrafficGame(sample);
  for (let i = 0; i < 40; i++) game.step();
  const frame = game.frame;
  assert.ok(Math.abs(frame.offered - frame.completed - frame.dropped - frame.cancelled - frame.waiting - frame.moving) < 1e-6);
  const approach = frame.cars.filter(c => c.from === 25 && c.to === 26);
  assert.ok(approach.length >= 2 && approach.length <= 3, JSON.stringify(approach.map(c => c.progress)));
  const ordered = [...approach].sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0));
  for (let i = 1; i < ordered.length; i++) {
    const gap = ((ordered[i].progress ?? 0) - (ordered[i - 1].progress ?? 0)) * TRAFFIC_SPACING.worldPerTile - TRAFFIC_SPACING.lengths.sedan;
    assert.ok(gap >= TRAFFIC_SPACING.standstillGap - 0.02, String(gap));
  }
  assert.deepEqual(overlappingPairs(gamePoses(frame.cars, frame.groups)), []);
  for (const group of frame.groups) if (!group.closed) assert.ok(group.amount <= group.storage);
});

test('a straight road platoons more than one car per tile without clipping', () => {
  const roads = new Set([25, 26, 27, 28]);
  const sample: TrafficGameSample = { map: { cells: Array.from({ length: 576 }, (_, i) => ({ road: roads.has(i) })) }, demand: [{ from: 25, to: 28, rate: 4 }] };
  const game = new TrafficGame(sample);
  for (let i = 0; i < 25; i++) game.step();
  const frame = game.frame;
  const counts = new Map<string, number>();
  for (const c of frame.cars) counts.set(`${c.from}>${c.to}`, (counts.get(`${c.from}>${c.to}`) ?? 0) + 1);
  assert.ok([...counts.values()].some(n => n >= 2), JSON.stringify([...counts]));
  assert.ok([...counts.values()].every(n => n <= 3));
  assert.deepEqual(overlappingPairs(gamePoses(frame.cars, frame.groups)), []);
});

test('mixed sedan/truck/bus lengths halt, remain paused and resume without closing bumper gap',()=>{
 for(const length of[TRAFFIC_SPACING.lengths.truck,.78,1.02,1.32]){
  const leader={...car(3,0),length},follower=car(0,2);
  for(let i=0;i<100;i++)updateVehicleFollowing(follower,leader,.05);
  assert.ok(bumperGap(follower,leader)>=TRAFFIC_SPACING.standstillGap-1e-9);
  const paused={...follower};updateVehicleFollowing(follower,leader,0);assert.deepEqual(follower,paused);
  leader.speed=1;for(let i=0;i<100;i++){leader.posOnLane+=.05;updateVehicleFollowing(follower,leader,.05);assert.ok(bumperGap(follower,leader)>=TRAFFIC_SPACING.standstillGap-1e-9);}
  assert.ok(follower.posOnLane>paused.posOnLane);assert.ok(follower.speed>0);
 }
});
test('actual substep bodies clear perpendicular junction queues without cosmetic collision filtering',()=>{
 const roads=new Set([49,50,51,26,74]);const game=new TrafficGame({map:{cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))},demand:[{from:49,to:51,rate:2},{from:26,to:74,rate:2},{from:51,to:26,rate:2},{from:74,to:49,rate:2}]});
 const internal=game as unknown as {substep:(dt:number,grant:Map<number,number>)=>void},original=internal.substep.bind(game);let samples=0;
 internal.substep=(dt,grant)=>{original(dt,grant);const f=game.frame,raw=f.cars.flatMap(c=>gamePoses([c],f.groups,24,2,128,true));assert.equal(raw.length,f.cars.length);assert.deepEqual(overlappingPairs(raw),[],`step ${f.step} sample ${samples}`);samples++;};
 for(let n=0;n<60;n++)game.step();assert.equal(samples,300);assert.ok(game.frame.completed>0);
});

test('two-arm bends and junction-source admission keep actual substep bodies apart',()=>{
 for(const [cells,ods]of [
  [[49,50,26],[[49,26],[26,49]]],
  [[25,26,27,51,75],[[25,75],[75,25]]],
  [[49,50,51,26,74],[[50,51],[26,74],[49,51],[74,49]]],
 ] as [number[],number[][]][]){
  const roads=new Set(cells),game=new TrafficGame({map:{cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))},demand:ods.map(([from,to])=>({from,to,rate:2}))});
  const internal=game as unknown as {substep:(dt:number,grant:Map<number,number>)=>void},original=internal.substep.bind(game);
  internal.substep=(dt,grant)=>{original(dt,grant);const f=game.frame,poses=f.cars.flatMap(c=>gamePoses([c],f.groups,24,2,128,true));assert.equal(poses.length,f.cars.length);assert.deepEqual(overlappingPairs(poses),[],`${cells} step${f.step}`);};
  for(let n=0;n<60;n++)game.step();assert.ok(game.frame.completed>0);
 }
});
test('ordinary acceleration and braking are bounded; emergency spacing still wins',()=>{
 const free=car(0,0);for(let i=0;i<15;i++){const prior=free.speed;updateVehicleFollowing(free,null,.05);assert.ok(free.speed-prior<=TRAFFIC_SPACING.accel*.05+1e-9);}
 free.maxSpeed=.6;for(let i=0;i<10;i++){const prior=free.speed;updateVehicleFollowing(free,null,.05);assert.ok(prior-free.speed<=TRAFFIC_SPACING.brake*.05+1e-9);}
 assert.ok(free.speed<=.6+1e-9);assert.ok(desiredFollowingGap(2)>desiredFollowingGap(.5));
 const leader=car(free.posOnLane+.42+.09,0);free.speed=2;updateVehicleFollowing(free,leader,.05);assert.ok(bumperGap(free,leader)>=.09-1e-9,'hard safety bound overrides smooth braking if an obstacle appears');
});
test('crossing ownership survives worker boundaries without backward position snaps',()=>{
 const roads=new Set([49,50,51,26,74]);const game=new TrafficGame({map:{cells:Array.from({length:576},(_,i)=>({road:roads.has(i)}))},demand:[{from:49,to:51,rate:2},{from:26,to:74,rate:2},{from:51,to:26,rate:2},{from:74,to:49,rate:2}]});
 const internal=game as unknown as {cars:{id:number;index:number;progress:number}[];substep:(dt:number,grant:Map<number,number>)=>void},original=internal.substep.bind(game),last=new Map<number,number>();
 internal.substep=(dt,grant)=>{original(dt,grant);for(const c of internal.cars){const position=c.index+c.progress;assert.ok(position>=(last.get(c.id)??position)-1e-9,`car${c.id} moved backward`);last.set(c.id,position);}};
 for(let n=0;n<80;n++)game.step();assert.ok(game.frame.completed>0);
});

test('rendered turn envelope includes both axes instead of pretending a diagonal car is grid aligned',()=>{
 const diagonal=vehicleBox({x:0,z:0,headingX:Math.SQRT1_2,headingZ:Math.SQRT1_2},.42,.3);
 assert.ok(Math.abs(diagonal.maxX-(.42+.3)/2*Math.SQRT1_2)<1e-12);assert.equal(diagonal.maxX,diagonal.maxZ);
 assert.deepEqual(vehicleBox({x:0,z:0,headingX:1,headingZ:0},.42,.3),{minX:-.21,maxX:.21,minZ:-.15,maxZ:.15});
});
