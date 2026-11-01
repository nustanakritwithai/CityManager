import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrafficGameWorkerEngine} from '../src/traffic/game-worker-engine.ts';
import {createTrafficGameClient} from '../src/traffic/game-worker-client.ts';
import type {TrafficGameInput,TrafficGameFrame} from '../src/traffic/game.ts';

const input=(minute:number,ack=0):TrafficGameInput=>({
 map:{cells:Array.from({length:576},(_,i)=>({road:[25,26,27,28].includes(i)}))},
 homes:[{cell:25,amount:100}],destinations:[{cell:28,amount:100}],
 work:{day:3,minute,ack,candidates:[{citizenId:'h:1:m:0',home:25,work:28}]}
});

test('coalesced worker candidate replays work expiry until the accepted receipt is acknowledged',()=>{
 const engine=createTrafficGameWorkerEngine(),queue:any[]=[],listeners:Record<string,Function[]>={},frames:TrafficGameFrame[]=[];
 const port={postMessage:(m:any)=>queue.push(structuredClone(m)),terminate:()=>{},addEventListener:(type:string,fn:Function)=>(listeners[type]??=[]).push(fn)};
 const client=createTrafficGameClient<TrafficGameInput,TrafficGameFrame>(port as never,'expiry',{onFrame:f=>frames.push(f),onFailure:m=>assert.fail(m)},10000);
 const flush=()=>{const result=engine(queue.shift());for(const fn of listeners.message??[])fn({data:result});};
 client.submit(input(1019),{advance:false,paused:false});flush();
 client.submit(input(1019),{advance:true,paused:false});flush();
 const workId=frames.at(-1)!.workTrips?.[0].id;assert.ok(workId);
 const request=input(1020);request.work!.cancelIds=[workId];
 client.submit(request,{advance:false,paused:false});
 client.submit(request,{advance:false,paused:false});
 flush();assert.equal(frames.length,2,'the older response must not be displayed');
 flush();assert.equal(frames.length,3);
 const events=frames.at(-1)!.expiredWorkTrips??[];assert.equal(events.length,1);
 assert.ok(frames.at(-1)!.cars.every(c=>c.id!==events[0].id));
 client.submit(input(1020),{advance:false,paused:false});flush();
 assert.deepEqual(frames.at(-1)!.expiredWorkTrips,events,'a suppressed receipt cannot disappear');
 client.submit(input(1020,events[0].sequence),{advance:false,paused:false});flush();
 assert.deepEqual(frames.at(-1)!.expiredWorkTrips??[],[]);
 client.dispose();
});

test('pause fence discards an in-flight work departure when simulated time has not moved',()=>{
 const engine=createTrafficGameWorkerEngine(),queue:any[]=[],listeners:Record<string,Function[]>={},frames:TrafficGameFrame[]=[];
 const port={postMessage:(m:any)=>queue.push(structuredClone(m)),terminate:()=>{},addEventListener:(type:string,fn:Function)=>(listeners[type]??=[]).push(fn)};
 const client=createTrafficGameClient<TrafficGameInput,TrafficGameFrame>(port as never,'pause',{onFrame:f=>frames.push(f),onFailure:m=>assert.fail(m)},10000);
 const flush=()=>{const result=engine(queue.shift());for(const fn of listeners.message??[])fn({data:result});};
 client.submit(input(1019),{advance:false,paused:false});flush();
 client.submit(input(1019),{advance:true,paused:false});client.submit(input(1019),{advance:false,paused:true});
 flush();flush();assert.equal(frames.at(-1)!.step,0);assert.equal(frames.at(-1)!.cars.length,0);assert.deepEqual(frames.at(-1)!.expiredWorkTrips??[],[]);
 client.dispose();
});

test('a fresh worker loaded after the cutoff does not create work trips until the next game day',()=>{
 const engine=createTrafficGameWorkerEngine();let seq=0;
 const call=(sample:TrafficGameInput,advance:boolean)=>{
  const n=++seq;const reply=engine({kind:'compute',epoch:'reload',seq:n,commitPrevious:n>1,advance,paused:false,sample});
  assert.equal(reply.kind,'frame');if(reply.kind!=='frame')throw Error(reply.message);return reply.frame;
 };
 let frame=call(input(1020),false);
 for(let i=0;i<5;i++)frame=call(input(1020),true);
 assert.equal(frame.expiredWorkTrips,undefined);
 const nextDay=input(480);nextDay.work!.day=4;
 for(let i=0;i<4;i++)frame=call(nextDay,true);
 const endDay=input(1020);endDay.work!.day=4;frame=call(endDay,false);
 assert.equal(frame.expiredWorkTrips,undefined);const id=frame.workTrips?.[0].id;assert.ok(id);
 endDay.work!.cancelIds=[id];frame=call(endDay,false);assert.equal(frame.expiredWorkTrips?.length,1);
 assert.ok(frame.cars.every(c=>c.id!==frame.expiredWorkTrips![0].id));
});
