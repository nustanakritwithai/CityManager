/** Synthetic preview envelope only. This never reads/writes production save slots.
 * Exact city bytes and explicit session identity/revision travel in one atomic payload. */
import {deserializeParkSession} from '../park-runtime.ts';
import {PassengerRail,type PassengerRailConfig,type PassengerRailSnapshot} from './passenger.ts';
import {createRailGraph,safeCount,validId,type RailGraph} from './graph.ts';
import {modalDemandSummary,type ModalDemand} from './demand-contract.ts';
export type RailPreviewRecord={sessionId:string;revision:number;cityRaw:string;config:PassengerRailConfig;graph:RailGraph;rail:PassengerRailSnapshot;demands:ModalDemand[]};
export type RailPreviewBinding=Pick<RailPreviewRecord,'sessionId'|'revision'|'cityRaw'>;
export function restoreRailPreview(raw:string,expected:RailPreviewBinding){
  if(raw.length>14_000_000)throw Error('Rail preview exceeds limit');
  const record=JSON.parse(raw) as RailPreviewRecord&{version:number};
  if(!record||Object.keys(record).sort().join(',')!=='cityRaw,config,demands,graph,rail,revision,sessionId,version'||record.version!==1||!validId(record.sessionId)||!safeCount(record.revision)
    ||record.sessionId!==expected.sessionId||record.revision!==expected.revision||record.cityRaw!==expected.cityRaw)throw Error('Rail preview city binding mismatch');
  const {city,runtime}=deserializeParkSession(record.cityRaw),graph=createRailGraph(record.graph.revision,record.graph.links);
  const rail=PassengerRail.restore(record.config,graph,record.rail);
  if(rail.snapshot.minute!==city.tick*1440+runtime.activity.minute)throw Error('Rail and city clocks differ');
  if(!Array.isArray(record.demands)||record.demands.length>record.config.maxBatches)throw Error('Invalid preview demand');
  const ids=new Set<string>(),leases=new Set<string>();let leased=0;
  for(const demand of record.demands){
    modalDemandSummary(demand);if(ids.has(demand.id))throw Error('Duplicate demand');ids.add(demand.id);
    for(const lease of demand.leases){
      if(leases.has(lease.id))throw Error('Duplicate modal lease');leases.add(lease.id);leased++;
      const batch=record.rail.batches.find(b=>b.leaseId===lease.id);
      if(!batch||batch.requestId!==demand.id||batch.from!==demand.from||batch.to!==demand.to||batch.persons!==lease.persons||batch.completed!==lease.completedPersons)throw Error('Rail lease mismatch');
    }
  }
  if(leased!==record.rail.batches.length)throw Error('Unowned rail passengers');
  return {record,city,parks:runtime,rail,graph};
}
export function serializeRailPreview(record:RailPreviewRecord):string{
  const raw=JSON.stringify({version:1,...record});restoreRailPreview(raw,record);return raw;
}
