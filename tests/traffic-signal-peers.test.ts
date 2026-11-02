import test from 'node:test';import assert from 'node:assert/strict';
import {SignalPeers,SIGNAL_PEER_LIMIT,SIGNAL_PEER_HOPS,type SignalPeerGraph,type SignalPeerSnapshot} from '../src/traffic/signal-peers.ts';
const graph=(revision='a'):SignalPeerGraph=>{const nodes=Array.from({length:25},(_,i)=>Math.floor(i/5)*24+i%5),set=new Set(nodes);return {revision,nodes,corridors:nodes.flatMap(from=>[from+1,from+24].filter(to=>set.has(to)&& (to===from+24||Math.floor(to/24)===Math.floor(from/24))).map(to=>({from,to})))};};
const snapshot=(node:number):SignalPeerSnapshot=>({node,approach:node+1,state:'green',since:0,clearUntil:0,queue:node%7,space:.5,byApproach:{[node+1]:2}});
test('cached seeded RRT finds bounded extra peers while every direct downstream peer is guaranteed',()=>{
 const g=graph(),a=new SignalPeers(g),b=new SignalPeers(g);let extras=0,multihop=0;
 for(const node of g.nodes){const routes=a.routes(node);assert.deepEqual(routes,b.routes(node));assert.ok(routes.length<=SIGNAL_PEER_LIMIT);for(const edge of g.corridors.filter(e=>e.from===node))assert.ok(routes.some(r=>r.destination===edge.to&&r.direct));
 for(const r of routes){assert.equal(r.path[0],node);assert.equal(r.path.at(-1),r.destination);assert.ok(r.path.length-1<=SIGNAL_PEER_HOPS);assert.equal(new Set(r.path).size,r.path.length);if(!r.direct)extras++;if(r.path.length>2)multihop++;for(let i=1;i<r.path.length;i++)assert.ok(g.corridors.some(e=>e.from===r.path[i-1]&&e.to===r.path[i]||e.to===r.path[i-1]&&e.from===r.path[i]));}}
 assert.ok(extras>0&&multihop>0);assert.ok(a.stats().expanded<=25*47);assert.ok(a.stats().attempts<=25*192);
});
test('receiver replies exactly through cached reverse hops without another RRT search',()=>{
 const peers=new SignalPeers(graph()),request=peers.request(0,10).find(r=>r.route.length>2)!;assert.ok(request);const before=peers.stats();const reply=peers.reply(request,snapshot(request.destination))!;
 assert.deepEqual(reply.route,[...request.route].reverse());assert.equal(reply.origin,request.destination);assert.equal(reply.destination,request.origin);assert.ok(peers.accept(reply,11));assert.equal(peers.read(0,11).find(m=>m.routeId===request.routeId)!.payload.node,request.destination);assert.equal(peers.stats().searches,before.searches);assert.equal(peers.stats().expanded,before.expanded);
 assert.equal(peers.accept(reply,11),false);assert.equal(peers.stats().accepted,1);
});
test('logical communication reverses one-way roads and packet expiry does not expire its route',()=>{
 const peers=new SignalPeers({revision:'oneway',nodes:[0,1,2],corridors:[{from:0,to:1},{from:1,to:2}]}),routes=peers.routes(0),s=new Map([1,2].map(n=>[n,snapshot(n)]));peers.exchange(s,5,[0]);assert.ok(peers.read(0,6).length>0);assert.equal(peers.read(0,8).length,0);const before=peers.stats();peers.exchange(s,9,[0]);assert.ok(peers.read(0,10).length>0);assert.strictEqual(peers.routes(0),routes);assert.equal(peers.stats().searches,before.searches);
});
test('missing, stale, wrong-route and previous-topology replies cannot influence current state',()=>{
 const peers=new SignalPeers(graph()),request=peers.request(0,10)[0],reply=peers.reply(request,snapshot(request.destination))!;
 assert.equal(peers.accept(reply,13),false);assert.equal(peers.accept({...reply,route:[0,999]},11),false);assert.equal(peers.accept({...reply,origin:99},11),false);assert.equal(peers.accept({...reply,seq:reply.seq+1},11),false);
 const changed=graph('b');changed.corridors=changed.corridors.filter(e=>!(e.from===0&&e.to===1));const replacement=new SignalPeers(changed);replacement.request(0,10);assert.equal(replacement.accept(reply,11),false);assert.ok(!replacement.routes(0).some(r=>r.path[0]===0&&r.path[1]===1));
 peers.exchange(new Map(),11,[0]);assert.equal(peers.read(0,12).length,0);
});
test('exchange consumes immutable previous snapshots, clones detach mailbox state and reads do not consume messages',()=>{
 const peers=new SignalPeers(graph()),s=snapshot(1),map=new Map([[1,s]]);peers.exchange(map,1,[0]);const before=peers.read(0,2);s.queue=999;(s.byApproach as Record<number,number>)[2]=999;assert.notEqual(before[0].payload.queue,999);assert.equal(before[0].payload.byApproach![2],2);assert.deepEqual(peers.read(0,2),before);
 const clone=peers.clone();clone.exchange(new Map([[1,{...snapshot(1),queue:77}]]),2,[0]);assert.equal(clone.read(0,3)[0].payload.queue,77);assert.notEqual(peers.read(0,2)[0].payload.queue,77);assert.notEqual(clone.stats().accepted,peers.stats().accepted);
 assert.throws(()=>peers.request(0,0),/reversed/);assert.deepEqual(peers.request(999,2),[]);
});
test('unrelated topology edits retain valid cached paths without search; affected neighborhoods rebuild and epochs reject old packets',()=>{
 const g:SignalPeerGraph={revision:'a',nodes:[0,1,2,500,501],corridors:[{from:0,to:1},{from:1,to:2},{from:500,to:501}]},peers=new SignalPeers(g),path=peers.routes(0)[0].path,request=peers.request(0,1)[0],reply=peers.reply(request,snapshot(request.destination))!;
 const relabeled=peers.withGraph({...g,revision:'b'});assert.equal(relabeled.stats().searches,peers.stats().searches);assert.strictEqual(relabeled.routes(0)[0].path,path);assert.equal(relabeled.accept(reply,2),false);
 const edited=peers.withGraph({...g,revision:'c',corridors:g.corridors.filter(e=>e.from!==500)});assert.strictEqual(edited.routes(0)[0].path,path);assert.equal(edited.stats().searches-peers.stats().searches,2);assert.equal(edited.routes(500).length,0);
});
test('finite full-map cache bounds and unchanged topology reuse do not add per-message planning',()=>{
 const nodes=Array.from({length:576},(_,i)=>i),corridors=nodes.flatMap(from=>[...(from%24<23?[{from,to:from+1}]:[]),...(from<552?[{from,to:from+24}]:[])]),g={revision:'full',nodes,corridors},peers=new SignalPeers(g),before=peers.stats();
 assert.equal(before.searches,576);assert.ok(before.expanded<=576*47&&before.attempts<=576*192&&before.routes<=576*8);
 const unchanged=peers.withGraph({...g,revision:'full-new-epoch'});assert.equal(unchanged.stats().searches,before.searches);assert.strictEqual(unchanged.routes(0)[0].path,peers.routes(0)[0].path);
 assert.throws(()=>new SignalPeers({...g,nodes:[...nodes,672]}),/graph/);assert.throws(()=>new SignalPeers({...g,corridors:Array.from({length:2689},()=>({from:0,to:1}))}),/graph/);
});
test('same-topology reset rejects old reply even when sequence and clock restart, without replanning routes',()=>{
 const g=graph(),peers=new SignalPeers(g),oldRequest=peers.request(0,0)[0],oldReply=peers.reply(oldRequest,snapshot(oldRequest.destination))!;
 assert.ok(peers.accept(oldReply,1));const reset=peers.withGraph(g),request=reset.request(0,0)[0];assert.equal(request.seq,oldRequest.seq);assert.equal(request.observedStep,oldRequest.observedStep);assert.notEqual(request.generation,oldRequest.generation);assert.equal(reset.accept(oldReply,1),false);assert.equal(reset.reply(oldRequest,snapshot(oldRequest.destination)),null);
 assert.strictEqual(reset.routes(0)[0].path,peers.routes(0)[0].path);assert.equal(reset.stats().searches,peers.stats().searches);
 const reply=reset.reply(request,snapshot(request.destination))!;assert.ok(reset.accept(reply,1));const clone=reset.clone();assert.equal(clone.request(0,0)[0].generation,request.generation);assert.deepEqual(clone.read(0,1),reset.read(0,1));
});
test('mutable caller snapshots are refreshed across exchanges and public packets remain copied',()=>{
 const peers=new SignalPeers(graph()),s=snapshot(1),previous=new Map([[1,s]]);peers.exchange(previous,0,[0]);const old=peers.read(0,1)[0];s.queue=99;(s.byApproach as Record<number,number>)[2]=33;peers.exchange(previous,1,[0]);const next=peers.read(0,2)[0];assert.equal(old.payload.queue,1);assert.equal(next.payload.queue,99);assert.equal(next.payload.byApproach![2],33);
 const request=peers.request(0,2)[0],reply=peers.reply(request,snapshot(request.destination))!,external={...reply,route:[...reply.route],payload:{...reply.payload,byApproach:{...reply.payload.byApproach}}};assert.ok(peers.accept(external,2));external.payload.queue=999;external.route[0]=999;assert.notEqual(peers.read(0,2).find(m=>m.routeId===reply.routeId)!.payload.queue,999);assert.notEqual(peers.read(0,2).find(m=>m.routeId===reply.routeId)!.route[0],999);
});
