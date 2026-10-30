import test from 'node:test';import assert from 'node:assert/strict';import {gamePoses,blendGamePoses} from '../src/traffic/game-poses.ts';
import {overlappingPairs} from '../src/citizen-road-queue.ts';
test('representative draw derives only from occupied game links and never changes mass',()=>{
 const cars=[{id:1,from:0,to:1,blocked:false},{id:2,from:0,to:1,blocked:true}],groups=[{key:'0>1',from:0,to:1,amount:2,queued:1,storage:4,closed:false}],before=structuredClone({cars,groups});
 const poses=gamePoses(cars,groups);assert.equal(poses.length,2);assert.deepEqual(overlappingPairs(poses),[]);assert.deepEqual({cars,groups},before);assert.deepEqual(gamePoses([],groups),[]);assert.deepEqual(gamePoses(cars,[{...groups[0],closed:true}]),[],'stranded traffic is not drawn on a removed road');
 const shifted=poses.map(p=>({...p,x:p.x+2})),half=blendGamePoses(poses,shifted,.5);assert.equal(half[0].x,poses[0].x+1);assert.deepEqual(blendGamePoses(poses,shifted,0),poses);
});

test('64-pose sample covers every occupied sector, including high-index regions, independent of input order',()=>{
 const cars: {id:number;from:number;to:number;blocked:boolean}[]=[],groups:{key:string;from:number;to:number;amount:number;queued:number;storage:number;closed:boolean}[]=[];
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){const from=(y*3)*24+x*3,to=from+1,id=y*8+x;cars.push({id:id*2+1,from,to,blocked:false},{id:id*2+2,from,to,blocked:false});groups.push({key:`${from}>${to}`,from,to,amount:2,queued:0,storage:4,closed:false});}
 const before=structuredClone({cars,groups}),sample=gamePoses(cars,groups),again=gamePoses([...cars].reverse(),[...groups].reverse());
 assert.equal(sample.length,64);assert.deepEqual(again,sample);assert.deepEqual({cars,groups},before);
 for(let id=0;id<64;id++)assert.ok(sample.some(p=>p.vehicleId===`game:${id*2+1}`),`occupied sector ${id} must remain represented`);
 assert.ok(sample.some(p=>p.vehicleId==='game:127'),'far high-index sector remains represented while panning');
 assert.equal(gamePoses(cars,groups,24,2,128).length,128);
});

test('when fewer than 64 links are occupied, extra actors on a busy link cannot hide a low-ranked link',()=>{
 const cars=Array.from({length:64},(_,i)=>({id:i+1,from:0,to:1,blocked:false}));cars.push({id:1000,from:552,to:553,blocked:false});
 const groups=[{key:'0>1',from:0,to:1,amount:64,queued:0,storage:8,closed:false},{key:'552>553',from:552,to:553,amount:1,queued:0,storage:4,closed:false}];
 const poses=gamePoses(cars,groups);assert.ok(poses.some(p=>p.vehicleId==='game:1000'));
});

test('up to 64 occupied links all receive a pose even when multiple cars share busier sectors',()=>{
 const cars:{id:number;from:number;to:number;blocked:boolean}[]=[],groups:{key:string;from:number;to:number;amount:number;queued:number;storage:number;closed:boolean}[]=[];
 for(let i=0;i<64;i++){const from=Math.floor(i/8)*24+(i%8)*2,to=from+1;cars.push({id:i*2+1,from,to,blocked:false},{id:i*2+2,from,to,blocked:false});groups.push({key:`${from}>${to}`,from,to,amount:2,queued:0,storage:4,closed:false});}
 const poses=gamePoses(cars,groups);assert.equal(poses.length,64);for(let i=0;i<64;i++)assert.ok(poses.some(p=>p.vehicleId===`game:${i*2+1}`),`occupied link ${i} must remain represented`);
});

test('below the visual cap, output is unchanged by the sampling budget',()=>{
 const cars=[{id:2,from:25,to:26,blocked:false},{id:1,from:0,to:1,blocked:true},{id:3,from:300,to:301,blocked:false}],groups=cars.map(c=>({key:`${c.from}>${c.to}`,from:c.from,to:c.to,amount:1,queued:Number(c.blocked),storage:4,closed:false}));
 assert.deepEqual(gamePoses(cars,groups),gamePoses(cars,groups,24,2,128));
});
