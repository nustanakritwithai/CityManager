import { railPath, safeCount, validId, type RailGraph } from './graph.ts';
import type { PassengerRailConfig, PassengerRailSnapshot } from './passenger.ts';

function keys(value: unknown, expected: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== expected.split(',').sort().join(',')) throw Error('Invalid rail snapshot fields');
}
/** Restore rejects the entire snapshot. It never repairs counts or discards passengers. */
export function validateRailSnapshot(config: PassengerRailConfig, graph: RailGraph, value: unknown): asserts value is PassengerRailSnapshot {
  keys(value,'version,minute,enabled,openStations,graphRevision,train,batches');
  const s=value as PassengerRailSnapshot;
  if(s.version!==1 || !safeCount(s.minute) || typeof s.enabled!=='boolean' || s.graphRevision!==graph.revision || !Array.isArray(s.batches) || s.batches.length>config.maxBatches)throw Error('Invalid rail snapshot');
  const stationIds=config.stations.map(station=>station.id);
  keys(s.openStations,stationIds.join(','));
  if(Object.values(s.openStations).some(open=>typeof open!=='boolean'))throw Error('Invalid station state');
  const t=s.train;
  keys(t,'station,destination,path,remainingMinutes,dwellUntil,lastDepartureMinute,blockOwner');
  if(!stationIds.includes(t.station) || !Array.isArray(t.path) || !safeCount(t.remainingMinutes) || !safeCount(t.dwellUntil) || t.dwellUntil>s.minute+config.minimumDwellMinutes
    || t.lastDepartureMinute!==null&&(!safeCount(t.lastDepartureMinute)||t.lastDepartureMinute>s.minute))throw Error('Invalid train state');
  if(t.destination!==null){
    if(!stationIds.includes(t.destination)||t.destination===t.station||t.blockOwner!==config.trainId||t.lastDepartureMinute===null)throw Error('Invalid moving train');
    const from=config.stations.find(station=>station.id===t.station)!,to=config.stations.find(station=>station.id===t.destination)!;
    const path=railPath(graph,from.cell,to.cell);
    if(!path || JSON.stringify(t.path)!==JSON.stringify(path.cells) || t.remainingMinutes<1 || t.remainingMinutes!==path.minutes-(s.minute-t.lastDepartureMinute) || t.dwellUntil>t.lastDepartureMinute)throw Error('Invalid train progress');
  }else if(t.path.length || t.remainingMinutes!==0 || t.blockOwner!==null)throw Error('Invalid docked train');
  const ids=new Set<string>(),leases=new Set<string>(),waiting=new Map(stationIds.map(id=>[id,0]));
  let offered=0,onboard=0;const onboardDestinations=new Set<string>();
  for(const b of s.batches){
    keys(b,'id,requestId,leaseId,from,to,fromStation,toStation,persons,readyAtMinute,egressMinutes,outside,waiting,onboard,completed,egress');
    if(![b.id,b.requestId,b.leaseId].every(validId)||ids.has(b.id)||leases.has(b.leaseId)||!stationIds.includes(b.fromStation)||!stationIds.includes(b.toStation)||b.fromStation===b.toStation
      ||![b.from,b.to,b.persons,b.readyAtMinute,b.egressMinutes,b.outside,b.waiting,b.onboard,b.completed].every(safeCount)||b.persons<1||!Array.isArray(b.egress))throw Error('Invalid passenger batch');
    ids.add(b.id);leases.add(b.leaseId);let egress=0;
    for(const e of b.egress){keys(e,'persons,readyAtMinute');if(!safeCount(e.persons)||e.persons<1||!safeCount(e.readyAtMinute)||e.readyAtMinute<=s.minute||e.readyAtMinute>s.minute+b.egressMinutes)throw Error('Invalid egress');egress+=e.persons;}
    if(b.persons!==b.outside+b.waiting+b.onboard+b.completed+egress || !safeCount(egress) || b.readyAtMinute>s.minute&&(b.waiting+b.onboard+b.completed+egress>0))throw Error('Passenger conservation failed');
    if(b.onboard){onboardDestinations.add(b.toStation);if(t.destination!==null&&b.toStation!==t.destination)throw Error('Passenger on wrong train');}
    waiting.set(b.fromStation,waiting.get(b.fromStation)!+b.waiting);offered+=b.persons;onboard+=b.onboard;
  }
  if(!safeCount(offered)||onboard>config.seats||onboardDestinations.size>1||config.stations.some(station=>waiting.get(station.id)!>station.queueCapacity))throw Error('Rail capacity exceeded');
  if(t.destination!==null&&!onboard&&!s.batches.some(b=>b.fromStation===t.destination&&b.outside+b.waiting>0))throw Error('Moving train has no service demand');
  for(let i=1;i<s.batches.length;i++){const a=s.batches[i-1],b=s.batches[i];if(a.readyAtMinute>b.readyAtMinute||a.readyAtMinute===b.readyAtMinute&&a.id.localeCompare(b.id)>0)throw Error('Invalid queue order');}
}
