import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import test from 'node:test';import {gamePoses,gamePoseSets} from '../src/traffic/game-poses.ts';
import {TrafficPresentation} from '../src/traffic/presentation.ts';
import type {GameCar,GameRenderGroup} from '../src/traffic/game.ts';
function fixture(count:number,variant:number){
 const cars:(GameCar&{taxi?:boolean})[]=[],groups:GameRenderGroup[]=[];
 for(let n=0;n<count;n++){const slot=Math.floor(n/2),x=(slot%8)*3,y=Math.floor(slot/8)*3,from=y*24+x,to=from+1;
  cars.push({id:1000+n,from,to,blocked:n%5===0,...(variant%2?{progress:(n%10)/10,lane:n%2,nextCell:to+24,nextLane:(n+1)%2,junction:true,nextVisit:n%4,speed:.5,destination:n%7===0?to:to+24}:{}),taxi:variant===2&&n%7===0});
  if(n%2===0)groups.push({key:`${from}>${to}`,from,to,amount:2,queued:0,storage:6,closed:variant===3&&slot%11===0});
 }
 return {cars:variant===4?cars.reverse():cars,groups:variant===4?groups.reverse():groups};
}
test('dual geometry sampling preserves the original 30-case ordered projection and presenter golden',()=>{
 const hashes:string[]=[];
 for(const count of [0,1,24,64,127,128])for(let variant=0;variant<5;variant++){
  const {cars,groups}=fixture(count,variant),before=JSON.stringify({cars,groups}),full=gamePoses(cars,groups,24,2,128),preferred=gamePoses(cars,groups),set=gamePoseSets(cars,groups);
  assert.deepEqual(set.full,full);assert.deepEqual(set.preferred,preferred);assert.equal(JSON.stringify({cars,groups}),before);
  const ids=cars.filter(c=>!c.taxi).map(c=>`game:${c.id}`),a=new TrafficPresentation(),b=new TrafficPresentation();a.update(full,preferred,ids);b.update(set.full,set.preferred,ids);
  for(let i=0;i<3;i++)assert.deepEqual(a.frame(.016,false),b.frame(.016,false));assert.deepEqual(a.diagnostics,b.diagnostics);
  hashes.push(createHash('sha256').update(JSON.stringify([count,variant,full,preferred,a.diagnostics])).digest('hex'));
 }
 // Frozen from exact pre-change 57b5e94 `game-poses.ts` (blob 9c2be4c8...).
 assert.equal(createHash('sha256').update(hashes.join(',')).digest('hex'),'f71574595c132376c22a86eed5c16e02fd472bc391db1ae1f8a1e3be38102877');
});
