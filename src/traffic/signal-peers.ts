import {roamRng} from '../taxi/rrt-roam.ts';

/** Logical, synchronous in-worker communication, not vehicle routing or hop latency. */
export const SIGNAL_PEER_LIMIT=8,SIGNAL_PEER_EXTRAS=4,SIGNAL_PEER_HOPS=3,SIGNAL_PEER_TTL=2;
const TREE_NODES=48,TREE_ATTEMPTS=192;
export type SignalPeerGraph={revision:string;nodes:readonly number[];corridors:readonly {from:number;to:number;distance?:number;approach?:number}[]};
export type SignalPeerSnapshot={node:number;approach:number|null;state:'green'|'clearance';since:number;clearUntil:number;queue:number;space:number;byApproach?:Readonly<Record<number,number>>};
export type SignalPeerRoute={id:string;origin:number;destination:number;path:readonly number[];direct:boolean};
export type SignalPeerRequest={generation:number;routeId:string;topology:string;origin:number;destination:number;route:readonly number[];seq:number;observedStep:number};
export type SignalPeerMessage=SignalPeerRequest&{payload:Readonly<SignalPeerSnapshot>};
type Cache={seed:number;signatures:ReadonlyMap<number,string>;revision:string;routes:ReadonlyMap<number,readonly SignalPeerRoute[]>;byId:ReadonlyMap<string,SignalPeerRoute>;searches:number;expanded:number;attempts:number};
const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const same=(a:readonly number[],b:readonly number[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function freezeSnapshot(s:SignalPeerSnapshot):Readonly<SignalPeerSnapshot>{
 if(!integer(s.node)||!(s.approach===null||integer(s.approach))||!['green','clearance'].includes(s.state)||!Number.isFinite(s.since)||!Number.isFinite(s.clearUntil)||!Number.isFinite(s.queue)||s.queue<0||!Number.isFinite(s.space)||s.space<0||s.space>1)throw Error('Invalid signal peer snapshot');
 if(s.byApproach&&Object.values(s.byApproach).some(v=>!Number.isFinite(v)||v<0))throw Error('Invalid approach queue');
 return Object.freeze({...s,...(s.byApproach?{byApproach:Object.freeze({...s.byApproach})}:{})});
}
function build(graph:SignalPeerGraph,seed:number,prior?:Cache):Cache{
 const nodes=[...new Set(graph.nodes)].sort((a,b)=>a-b);if(!graph.revision||graph.nodes.length>576||graph.corridors.length>2304||nodes.length>576||nodes.some(n=>!integer(n)||n>=576)||!Number.isSafeInteger(seed))throw Error('Invalid signal peer graph');
 const known=new Set(nodes),adj=new Map(nodes.map(n=>[n,new Set<number>()])),direct=new Map(nodes.map(n=>[n,new Set<number>()]));
 for(const e of graph.corridors){if(!known.has(e.from)||!known.has(e.to)||e.from===e.to)throw Error('Invalid signal corridor');adj.get(e.from)!.add(e.to);adj.get(e.to)!.add(e.from);direct.get(e.from)!.add(e.to);}
 if([...direct.values()].some(s=>s.size>4)||[...adj.values()].some(s=>s.size>4))throw Error('Signal corridor degree exceeds road-grid bound');
 const routes=new Map<number,readonly SignalPeerRoute[]>(),byId=new Map<string,SignalPeerRoute>();const signatures=new Map<number,string>();let searches=prior?.searches??0,expanded=prior?.expanded??0,attempts=prior?.attempts??0;
 const distance=(a:number,b:number)=>Math.abs(a%24-b%24)+Math.abs(Math.floor(a/24)-Math.floor(b/24));
 for(const origin of nodes){
  // Only the radius-three communication neighborhood can affect this tree.
  const neighborhood=new Map([[origin,0]]),pending=[origin];for(let i=0;i<pending.length;i++){const n=pending[i],d=neighborhood.get(n)!;if(d>=SIGNAL_PEER_HOPS)continue;for(const to of adj.get(n)!)if(!neighborhood.has(to)){neighborhood.set(to,d+1);pending.push(to);}}
  const signature=JSON.stringify({direct:[...direct.get(origin)!].sort((a,b)=>a-b),edges:[...neighborhood].filter(([,d])=>d<SIGNAL_PEER_HOPS).sort((a,b)=>a[0]-b[0]).map(([n])=>[n,[...adj.get(n)!].sort((a,b)=>a-b)])});signatures.set(origin,signature);
  if(prior?.seed===seed&&prior.signatures.get(origin)===signature){const reused=prior.routes.get(origin)!.map(r=>Object.freeze({...r,id:`${graph.revision}|${origin}>${r.destination}`}));for(const r of reused)byId.set(r.id,r);routes.set(origin,Object.freeze(reused));continue;}
  const selected:SignalPeerRoute[]=[];const add=(path:number[],isDirect:boolean)=>{const destination=path.at(-1)!;const r=Object.freeze({id:`${graph.revision}|${origin}>${destination}`,origin,destination,path:Object.freeze(path),direct:isDirect});selected.push(r);byId.set(r.id,r);};
  for(const to of [...direct.get(origin)!].sort((a,b)=>a-b))add([origin,to],true);
  const samples=[...neighborhood.keys()].sort((a,b)=>a-b),parent=new Map<number,number>([[origin,-1]]),depth=new Map([[origin,0]]),tree=[origin],rng=roamRng(seed,'signal-peers',0,origin);let extras=0;searches++;
  for(let iteration=0;iteration<TREE_ATTEMPTS&&tree.length<TREE_NODES&&extras<SIGNAL_PEER_EXTRAS;iteration++){
   attempts++;const sample=samples[Math.floor(rng()*samples.length)];let near:number|undefined,nearest=Infinity;
   for(const n of tree){if(depth.get(n)!>=SIGNAL_PEER_HOPS||![...adj.get(n)!].some(to=>!parent.has(to)))continue;const d=distance(n,sample);if(d<nearest){near=n;nearest=d;}}
   if(near===undefined)break;
   const options=[...adj.get(near)!].filter(n=>!parent.has(n)).sort((a,b)=>distance(a,sample)-distance(b,sample)||a-b),best=distance(options[0],sample),tied=options.filter(n=>distance(n,sample)===best),to=tied[Math.floor(rng()*tied.length)];
   parent.set(to,near);depth.set(to,depth.get(near)!+1);tree.push(to);expanded++;
   if(!direct.get(origin)!.has(to)){const path=[to];while(path[0]!==origin)path.unshift(parent.get(path[0])!);add(path,false);extras++;}
  }
  routes.set(origin,Object.freeze(selected));
 }
 return {seed,signatures,revision:graph.revision,routes,byId,searches,expanded,attempts};
}
/** Cache is shared by clones; mailbox/request sequence state is detached. */
export class SignalPeers{
 private generation=0;private cache:Cache;private requests=new Map<string,SignalPeerRequest>();private messages=new Map<string,SignalPeerMessage>();private sequence=new Map<number,number>();private lastExchange=new Map<number,number>();
 private accepted=0;private rejected=0;private replies=0;
 constructor(graph:SignalPeerGraph,seed=0x5349474e){this.cache=build(graph,seed);}
 /** Rebind epoch, retain unchanged local trees, and discard all old-epoch packets. */
 withGraph(graph:SignalPeerGraph):SignalPeers{const next=Object.create(SignalPeers.prototype) as SignalPeers;next.generation=this.generation+1;next.cache=build(graph,this.cache.seed,this.cache);next.requests=new Map();next.messages=new Map();next.sequence=new Map();next.lastExchange=new Map();next.accepted=next.rejected=next.replies=0;return next;}
 clone():SignalPeers{const c=Object.create(SignalPeers.prototype) as SignalPeers;c.generation=this.generation;c.cache=this.cache;c.requests=new Map(this.requests);c.messages=new Map(this.messages);c.sequence=new Map(this.sequence);c.lastExchange=new Map(this.lastExchange);c.accepted=this.accepted;c.rejected=this.rejected;c.replies=this.replies;return c;}
 routes(node:number):readonly SignalPeerRoute[]{return this.cache.routes.get(node)??[];}
 stats(){return {searches:this.cache.searches,expanded:this.cache.expanded,attempts:this.cache.attempts,routes:this.cache.byId.size,accepted:this.accepted,rejected:this.rejected,replies:this.replies};}
 request(node:number,observedStep:number):readonly SignalPeerRequest[]{
  if(!integer(observedStep))throw Error('Invalid peer clock');if(!this.cache.routes.has(node))return [];if((this.lastExchange.get(node)??-1)>observedStep)throw Error('Signal peer clock reversed');
  if(this.lastExchange.get(node)===observedStep)return this.routes(node).map(r=>this.requests.get(r.id)!);
  const seq=(this.sequence.get(node)??0)+1;this.sequence.set(node,seq);this.lastExchange.set(node,observedStep);
  return this.routes(node).map(r=>{const request=Object.freeze({generation:this.generation,routeId:r.id,topology:this.cache.revision,origin:node,destination:r.destination,route:r.path,seq,observedStep});this.requests.set(r.id,request);return request;});
 }
 reply(request:SignalPeerRequest,snapshot:SignalPeerSnapshot):SignalPeerMessage|null{
  const r=this.cache.byId.get(request.routeId);if(!r||request.generation!==this.generation||request.topology!==this.cache.revision||request.origin!==r.origin||request.destination!==r.destination||snapshot.node!==r.destination||!same(request.route,r.path)||!integer(request.seq)||!integer(request.observedStep))return null;
  this.replies++;return Object.freeze({...request,origin:request.destination,destination:request.origin,route:Object.freeze([...request.route].reverse()),payload:freezeSnapshot(snapshot)});
 }
 accept(message:SignalPeerMessage,currentStep:number):boolean{
  const request=this.requests.get(message.routeId),prior=this.messages.get(message.routeId);
  if(!integer(currentStep)||!request||message.generation!==this.generation||message.generation!==request.generation||message.topology!==this.cache.revision||message.origin!==request.destination||message.destination!==request.origin||message.seq!==request.seq||message.observedStep!==request.observedStep||currentStep<message.observedStep||currentStep-message.observedStep>SIGNAL_PEER_TTL||!same(message.route,[...request.route].reverse())||message.payload.node!==message.origin||(prior&&prior.seq>=message.seq)){this.rejected++;return false;}
  this.messages.set(message.routeId,Object.freeze({...message,route:Object.freeze([...message.route]),payload:freezeSnapshot(message.payload)}));this.accepted++;return true;
 }
 /** Previous-substep immutable snapshots; route hops are logical, delivered synchronously. */
 exchange(previous:ReadonlyMap<number,SignalPeerSnapshot>|readonly SignalPeerSnapshot[],observedStep:number,activeReceivers?:readonly number[]):void{
  const snapshots=Array.isArray(previous)?new Map(previous.map(s=>[s.node,s])):previous as ReadonlyMap<number,SignalPeerSnapshot>;
  for(const node of activeReceivers??this.cache.routes.keys())for(const request of this.request(node,observedStep)){const snapshot=snapshots.get(request.destination);if(!snapshot)continue;const reply=this.reply(request,snapshot);if(reply)this.accept(reply,observedStep);}
 }
 read(node:number,currentStep:number):readonly SignalPeerMessage[]{
  if(!integer(currentStep))throw Error('Invalid peer clock');return this.routes(node).flatMap(r=>{const m=this.messages.get(r.id);return m&&currentStep>=m.observedStep&&currentStep-m.observedStep<=SIGNAL_PEER_TTL?[m]:[];});
 }
}
