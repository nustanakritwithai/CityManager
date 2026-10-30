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
   // Only previously validated, explicitly existing taxi depots are read here.
   // No railway is inferred: main currently has no accepted rail infrastructure.
   const taxis=message.sample.taxis??[];if(!Array.isArray(taxis))throw Error('Invalid taxi game input');
   if(taxis.length){const key=JSON.stringify([sample.map.cells.map(c=>c.road),sample.map.roadTopology??null,taxis]);
    if(!modalContext||key!==modalKey){modalContext=compileGameModal(sample.map,{taxis,rail:[]});modalKey=key;}
    const allocation=allocateGameModes(sample,modalContext);sample=allocation.sample;modal=allocation.stats;
   }
   if(!base){epoch=message.epoch;if(message.commitPrevious)throw Error('No traffic game candidate to commit');base=new TrafficGame(sample);}
   else if(message.epoch!==epoch)throw Error('Traffic game worker epoch mismatch');
   if(message.commitPrevious){if(!candidate)throw Error('Missing traffic game candidate');base=candidate;}
   candidate=base.clone();candidate.setSample(sample);
   // Bus (optional): absent input keeps the game byte-identical. Validated inside setBus.
   if(message.sample.bus!==undefined)candidate.setBus(message.sample.bus);
   const frame={...(message.advance?candidate.step(false):candidate.frame),modal};seq=message.seq;
   return {kind:'frame',epoch,seq,frame};
  }catch(error){faulted=true;return {kind:'error',epoch:epoch||message?.epoch||'',seq:message?.seq??0,message:error instanceof Error?error.message:String(error)};}
 };
}
