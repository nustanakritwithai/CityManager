import test from 'node:test';
import assert from 'node:assert/strict';
import { TrafficGame } from '../src/traffic/game.ts';
import { gamePoseSets } from '../src/traffic/game-poses.ts';
import { TrafficPresentation } from '../src/traffic/presentation.ts';
import { TRAFFIC_SPACING, boxesOverlap, vehicleBox } from '../src/traffic/spacing.ts';

function junctionSample(compact:boolean) {
  const roads=new Set<number>();
  if(compact){
    for(let z=3;z<=5;z++)for(let x=3;x<=5;x++)roads.add(z*24+x);
  }else{
    for(let i=3;i<=13;i++){
      roads.add(8*24+i);
      roads.add(i*24+8);
    }
  }
  const ends=compact?[75,77,123,125]:[195,205,80,320];
  const demand=ends.flatMap((from,i)=>ends.flatMap((to,j)=>
    from===to?[]:[{from,to,rate:compact?1:.85*(1+((i*37+j*17+1)%5)/3)}]
  ));
  return {map:{cells:Array.from({length:576},(_,index)=>({road:roads.has(index)}))},demand};
}

for(const compact of [false,true]){
  const name=compact?'adjoining junctions with departures inside the grid':'a four-way junction under continuous demand';
  test(name+' serves visible cars without minute-long stops',t=>{
    const game=new TrafficGame(junctionSample(compact));
    const presenter=new TrafficPresentation();
    const stopped=new Map<string,{x:number;z:number;since:number}>();
    let longest=0, peakVisible=0, frame=game.frame;
    const duration=compact?250:200;
    for(let tick=1;tick<=duration*10;tick++){
      if(tick%10===0){
        frame=game.step();
        const poses=gamePoseSets(frame.cars,frame.groups);
        presenter.update(poses.full,poses.preferred,frame.cars.map(car=>'game:'+car.id),frame.cars);
      }
      const visible=presenter.frame(.1,false);
      peakVisible=Math.max(peakVisible,visible.length);
      const bodies=visible.map(pose=>vehicleBox(pose,TRAFFIC_SPACING.lengths.sedan,.3));
      for(const [i,pose] of visible.entries()){
        const prior=stopped.get(pose.vehicleId);
        if(!prior || Math.hypot(pose.x-prior.x,pose.z-prior.z)>.005){
          stopped.set(pose.vehicleId,{x:pose.x,z:pose.z,since:tick});
        }else longest=Math.max(longest,(tick-prior.since)/10);
        const box=bodies[i],gap=TRAFFIC_SPACING.standstillGap;
        const padded={minX:box.minX-gap,maxX:box.maxX+gap,minZ:box.minZ-gap,maxZ:box.maxZ+gap};
        for(let j=0;j<i;j++)assert.equal(boxesOverlap(padded,bodies[j],1e-7),false,'bumper clearance');
      }
    }
    t.diagnostic('Longest stop '+longest+' s, peak visible '+peakVisible+', completed trips '+frame.completed);
    assert.ok(peakVisible>=(compact?6:40),'representative traffic remains visible');
    assert.ok(frame.completed>(compact?150:100),'actual trips keep completing');
    assert.ok(longest<(compact?40:20),'longest visible stop was '+longest+' seconds');
  });
}