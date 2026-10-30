import test from 'node:test';import assert from 'node:assert/strict';import {gamePoses,blendGamePoses} from '../src/traffic/game-poses.ts';
import {overlappingPairs} from '../src/citizen-road-queue.ts';
test('representative draw derives only from occupied game links and never changes mass',()=>{
 const cars=[{id:1,from:0,to:1,blocked:false},{id:2,from:0,to:1,blocked:true}],groups=[{key:'0>1',from:0,to:1,amount:2,queued:1,storage:4,closed:false}],before=structuredClone({cars,groups});
 const poses=gamePoses(cars,groups);assert.equal(poses.length,2);assert.deepEqual(overlappingPairs(poses),[]);assert.deepEqual({cars,groups},before);assert.deepEqual(gamePoses([],groups),[]);assert.deepEqual(gamePoses(cars,[{...groups[0],closed:true}]),[],'stranded traffic is not drawn on a removed road');
 const shifted=poses.map(p=>({...p,x:p.x+2})),half=blendGamePoses(poses,shifted,.5);assert.equal(half[0].x,poses[0].x+1);assert.deepEqual(blendGamePoses(poses,shifted,0),poses);
});
