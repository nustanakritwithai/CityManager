import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkStallTracker,WORK_PROGRESS_DISTANCE,WORK_STALL_GRACE_SECONDS} from '../src/traffic/work-stall.ts';
import {crossedWorkWindowDay} from '../src/traffic/work-window.ts';

test('a single red phase and paused time never consume the sustained-stall grace',()=>{
 const tracker=new WorkStallTracker();
 for(let i=0;i<1000;i++)assert.equal(tracker.observe(1,0,true,0),false);
 for(let i=0;i<8;i++)assert.equal(tracker.observe(1,0,true,.25),false);
 assert.equal(tracker.observe(1,0,false,.25),false);
});

test('persistent blockage expires after a signal-cycle grace, but moving never expires',()=>{
 const tracker=new WorkStallTracker(),steps=Math.ceil(WORK_STALL_GRACE_SECONDS/.25);
 for(let i=0;i<steps-1;i++)assert.equal(tracker.observe(1,0,true,.25),false);
 assert.equal(tracker.observe(1,0,false,.25),false);
 assert.equal(tracker.observe(1,0,true,.25),true);
});

test('jitter does not reset a stall indefinitely, but one physical car length does',()=>{
 const tracker=new WorkStallTracker(),half=Math.floor(WORK_STALL_GRACE_SECONDS/.5);
 for(let i=0;i<half;i++)assert.equal(tracker.observe(1,WORK_PROGRESS_DISTANCE*.49*i/half,true,.25),false);
 for(let i=0;i<half;i++)tracker.observe(1,WORK_PROGRESS_DISTANCE*.49,true,.25);
 assert.equal(tracker.observe(1,WORK_PROGRESS_DISTANCE*.49,true,.25),true);
 assert.equal(tracker.observe(1,WORK_PROGRESS_DISTANCE,true,.25),false);
 tracker.retain(new Set());assert.equal(tracker.observe(1,0,true,.25),false);
});

test('continuous sub-car-length creep cannot indefinitely reset the progress timer',()=>{
 const tracker=new WorkStallTracker(),steps=Math.ceil(WORK_STALL_GRACE_SECONDS/.25)+1;
 for(let i=0;i<steps;i++)assert.equal(tracker.observe(1,WORK_PROGRESS_DISTANCE*.5*i/steps,false,.25),false,'a moving vehicle is never removed');
 assert.equal(tracker.observe(1,WORK_PROGRESS_DISTANCE*.5,true,.025),true,'after sustained inadequate progress an actual blockage may expire');
});

test('work-window crossings respect boundaries, pause and a bounded latest day',()=>{
 assert.equal(crossedWorkWindowDay(0,390),0);
 assert.equal(crossedWorkWindowDay(390,391),0);
 assert.equal(crossedWorkWindowDay(1019,1020),0);
 assert.equal(crossedWorkWindowDay(1020,1439),null);
 assert.equal(crossedWorkWindowDay(1439,1440),null);
 assert.equal(crossedWorkWindowDay(0,1440),0);
 assert.equal(crossedWorkWindowDay(0,14400),9);
 assert.equal(crossedWorkWindowDay(390,390),null);
 assert.throws(()=>crossedWorkWindowDay(500,499),/Invalid/);
});
