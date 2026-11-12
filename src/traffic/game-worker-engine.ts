import {TrafficGame,trafficGameSampleFromInput,type TrafficGameInput,type TrafficGameFrame} from './game.ts';
import type {GameWorkerInput,GameWorkerOutput} from './game-worker-client.ts';
import {allocateGameModes,compileGameModal,type GameModalStats} from './game-modal.ts';

/** Runs on the worker only. Each result is a candidate. A later command commits
 * it only if the host accepted that result; a pause overtaking an in-flight
 * advance discards the candidate, preventing an apparent movement while paused. */
export function createTrafficGameWorkerEngine(){
 let epoch='',seq=0,base:TrafficGame|null=null,candidate:TrafficGame|null=null,faulted=false;
 let modalKey='',modalContext:ReturnType<typeof compileGameModal>|null=null;
 return (message:GameWorkerInput<TrafficGameInput>):GameWorkerOutput<TrafficGameFrame>=>{
  try{
   if(faulted)throw Error('Traffic game worker is faulted');
   if(!message||message.kind!=='compute'||!message.epoch||!Number.isSafeInteger(message.seq)||message.seq<=seq||typeof message.commitPrevious!=='boolean'||typeof message.advance!=='boolean'||typeof message.paused!=='boolean'||message.paused&&message.advance)throw Error('Invalid traffic game worker request');
   let sample=trafficGameSampleFromInput(message.sample);let modal:GameModalStats|null=null;
   // Preserve original OD ownership across the bounded road renderer's 64 bins.
   // A representative road row must never give an uncovered source rail benefit.
   const railRows:import('../rail/game-rail.ts').RailGameContributor[]=[];
   if(message.sample.rail!==undefined){
   const grouped=new Map<string,{from:number;to:number;rate:number}>();
   for(const d of sample.demand){if(d.from===d.to)continue;const key=`${d.from}:${d.to}`,old=grouped.get(key);if(old)old.rate+=d.rate;else grouped.set(key,{...d});}
   const raw=[...grouped.values()].sort((a,b)=>a.from-b.from||a.to-b.to),bins=Math.min(raw.length,64);
   for(let i=0;i<bins;i++){const part=raw.slice(Math.floor(i*raw.length/bins),Math.floor((i+1)*raw.length/bins)),road=part[Math.floor(part.length/2)],sum=part.reduce((n,d)=>n+d.rate,0);if(sum>0)for(const d of part)railRows.push({from:d.from,to:d.to,roadFrom:road.from,roadTo:road.to,weight:d.rate/sum});}
   }
   // Only previously validated, explicitly existing taxi depots are read here.
   // Rail reservations are handled separately after bus/taxi allocation.
   const taxis=message.sample.taxis??[];if(!Array.isArray(taxis))throw Error('Invalid taxi game input');
   if(taxis.length){const key=JSON.stringify([sample.map.cells.map(c=>c.road),sample.map.roadTopology??null,taxis]);
    if(!modalContext||key!==modalKey){modalContext=compileGameModal(sample.map,{taxis,rail:[]});modalKey=key;}
    const allocation=allocateGameModes(sample,modalContext);sample=allocation.sample;modal=allocation.stats;if(message.sample.rail!==undefined)railRows.splice(0,railRows.length,...allocation.privateContributors);
   }
   if(!base){epoch=message.epoch;if(message.commitPrevious)throw Error('No traffic game candidate to commit');base=new TrafficGame(sample);}
   else if(message.epoch!==epoch)throw Error('Traffic game worker epoch mismatch');
   if(message.commitPrevious){if(!candidate)throw Error('Missing traffic game candidate');base=candidate;}
   candidate=base.clone();candidate.setSample(sample);
   // Work trips use the supplied city clock; the worker never reads wall time.
   // Expiry receipts stay with the candidate until an accepted frame is acked.
   if(message.sample.work!==undefined)candidate.setWork(message.sample.work);
   // Bus (optional): absent input keeps the game byte-identical. Validated inside setBus.
   if(message.sample.bus!==undefined)candidate.setBus(message.sample.bus);
   if(message.sample.rail!==undefined)candidate.setRail(message.sample.rail,railRows);
   const frame={...(message.advance?candidate.step(false):candidate.frame),modal};seq=message.seq;
   return {kind:'frame',epoch,seq,frame};
  }catch(error){faulted=true;return {kind:'error',epoch:epoch||message?.epoch||'',seq:message?.seq??0,message:error instanceof Error?error.message:String(error)};}
 };
}
