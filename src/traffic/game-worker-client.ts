/** Bounded latest-sample scheduler for the optional ephemeral traffic minigame.
 * This is not the conserved traffic clock: obsolete observations may be coalesced,
 * no claim is made that each observation represents a real trip or elapsed hour. */
export type GameWorkerInput<S> = {kind:'compute';epoch:string;seq:number;sample:S;advance:boolean;paused:boolean;commitPrevious:boolean};
export type GameWorkerOutput<F> = {kind:'frame';epoch:string;seq:number;frame:F}|{kind:'error';epoch:string;seq:number;message:string};
type Port<S,F>={postMessage(message:GameWorkerInput<S>):void;terminate():void;
 addEventListener(type:'message',fn:(event:MessageEvent<GameWorkerOutput<F>>)=>void):void;
 addEventListener(type:'error'|'messageerror',fn:()=>void):void};
type Options<F>={onFrame:(frame:F,seq:number)=>void;onFailure:(message:string)=>void};
export function createTrafficGameClient<S,F>(port:Port<S,F>,epoch:string,options:Options<F>,timeoutMs=10_000){
 if(!epoch||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Invalid traffic game worker');
 let seq=0,inflight:GameWorkerInput<S>|null=null,pending:GameWorkerInput<S>|null=null;
 let disposed=false,failure:string|null=null,acceptPrevious=false,pauseFence=false,timer:ReturnType<typeof setTimeout>|null=null,coalesced=0,sent=0,received=0,applied=0,sentAt=0,lastRoundTripMs=0,maxRoundTripMs=0;
 const clear=()=>{if(timer){clearTimeout(timer);timer=null;}};
 const stop=(message:string)=>{if(disposed||failure)return;failure=message;clear();try{port.terminate();}catch{/* failure already latched */}try{options.onFailure(message);}catch{/* never affect the economy loop */}};
 const send=(job:GameWorkerInput<S>)=>{if(disposed||failure)return;job.commitPrevious=acceptPrevious;acceptPrevious=false;inflight=job;sent++;sentAt=performance.now();timer=setTimeout(()=>stop('Traffic game worker timed out'),timeoutMs);try{port.postMessage(job);}catch{stop('Traffic game worker could not start');}};
 port.addEventListener('message',(event:MessageEvent<GameWorkerOutput<F>>)=>{
  const m=event.data;if(disposed||failure||!m||m.epoch!==epoch)return;
  if(!inflight||m.seq!==inflight.seq){stop('Traffic game worker response mismatch');return;}
  clear();lastRoundTripMs=Math.max(0,performance.now()-sentAt);maxRoundTripMs=Math.max(maxRoundTripMs,lastRoundTripMs);inflight=null;if(m.kind==='error'){stop(m.message);return;}if(m.kind!=='frame'){stop('Traffic game worker returned invalid data');return;}
  received++;if(pending){const next=pending;pending=null;acceptPrevious=!next.paused&&!pauseFence;pauseFence=false;send(next);return;}
  applied++;acceptPrevious=true;try{options.onFrame(m.frame,m.seq);}catch{stop('Traffic game display failed');}
 });
 port.addEventListener('error',()=>stop('Traffic game worker failed'));
 port.addEventListener('messageerror',()=>stop('Traffic game worker message failed'));
 return {
  /** Host invokes at real-time cadence. Pause/road changes send advance=false.
   * At most the latest pending sample survives; game-step count may therefore
   * slow under load, but no queue grows and no missed real trips are asserted. */
  submit(sample:S,action:{advance:boolean;paused:boolean}){
   if(disposed||failure)return false;
   if(typeof action.advance!=='boolean'||typeof action.paused!=='boolean'||action.paused&&action.advance)throw Error('Invalid traffic game action');
   const job:GameWorkerInput<S>={kind:'compute',epoch,seq:++seq,sample:structuredClone(sample),advance:action.advance,paused:action.paused,commitPrevious:false};
   if(inflight){if(action.paused)pauseFence=true;if(pending)coalesced++;pending=job;}else send(job);return true;
  },
  /** City switch/load must dispose this client and use a fresh epoch and worker. */
  dispose(){if(disposed)return;disposed=true;clear();inflight=null;pending=null;try{port.terminate();}catch{/* old session remains fenced */}},
  get status(){return {epoch,disposed,failure,inflight:!!inflight,pending:!!pending,coalesced,sent,received,applied,lastRoundTripMs,maxRoundTripMs};},
 };
}
