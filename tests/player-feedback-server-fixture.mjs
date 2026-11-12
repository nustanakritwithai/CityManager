import assert from 'node:assert/strict';
import {createTrafficServerFixture} from './traffic-server-entry-fixture.mjs';

/** Isolated UX adapter around the same real in-memory save service as traffic.
 * A synthetic 503 is returned before mutation; retries use the native client. */
export function createFeedbackServerFixture(url){
 const core=createTrafficServerFixture(url),attempts=[],reads=[];let fault=false,sequence=0;
 const intercept=async(params,send)=>{
  const citySave=new URL(params.request.url).pathname==='/citymanager-api/v1/city-save',post=citySave&&params.request.method==='POST',get=citySave&&params.request.method==='GET';
  if(!post&&!get)return core.intercept(params,send);
  const event={started:++sequence,completed:null,status:null,response:null,...(post?{key:Object.entries(params.request.headers??{}).find(([name])=>name.toLowerCase()==='idempotency-key')?.[1],command:JSON.parse(params.request.postData)}:{})};
  (post?attempts:reads).push(event);
  if(post&&fault){event.status=503;event.response={error:'synthetic-save-unavailable'};event.completed=++sequence;await send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(event.response)).toString('base64')});return true;}
  return core.intercept(params,async(method,payload)=>{event.status=payload.responseCode;event.response=JSON.parse(Buffer.from(payload.body,'base64').toString());event.completed=++sequence;return send(method,payload);});
 };
 const retryEvidence=(index,before)=>{
  const posts=attempts.slice(index),original=posts[0];assert.equal(original?.status,503,'A real native save received a synthetic server refusal');
  assert.ok(original.key,'The failed intent has an idempotency key');
  assert.equal(original.command.action,'save');assert.equal(original.command.cityId,before.cityId);assert.equal(original.command.expectedRevision,before.revision);
  const replays=posts.filter(p=>p.key===original.key);
  assert.ok(replays.some(p=>p.status===200),'The same intent receives an authoritative ACK');
  for(const replay of replays)assert.deepEqual(replay.command,original.command,'Every replay retains the exact request body');
  const replay=replays.findLast(p=>p.status===200),ack=replay.response;assert.equal(ack.revision,before.revision+1);assert.equal(ack.raw,original.command.raw);assert.equal(ack.cityId,before.cityId);assert.deepEqual(ack.metadata,original.command.metadata);
  return {posts,original,replays,replay,ack};
 };
 const assertRetry=(index,before)=>{
  const {posts,original,replays,replay,ack}=retryEvidence(index,before),next=posts.find(p=>p.key!==original.key);
  assert.ok(next&&next.status===200,'A distinct current-state save follows the retried ACK');assert.equal(next.command.expectedRevision,ack.revision);assert.equal(next.response.revision,ack.revision+1);
  assert.ok(next.started>replay.completed,'The fresh explicit save starts only after the retried ACK');
  assert.equal(core.active.revision,next.response.revision);assert.equal(core.active.raw,next.response.raw);
  return {failed:posts.filter(p=>p.status===503).length,replays:replays.length,finalRevision:core.active.revision};
 };
 const assertVerifiedRetry=(index,before,currentRaw)=>{
  const {posts,replays,replay,ack}=retryEvidence(index,before);
  assert.equal(ack.raw,currentRaw,'The retried ACK must contain the unchanged current session');
  assert.equal(posts.length,replays.length,'An unchanged automatic retry must not create a distinct write');
  const verification=reads.filter(read=>read.started>replay.completed).at(-1);
  assert.equal(verification?.status,200,'A fresh successful server read must start after the retried ACK');
  assert.deepEqual(verification.response,ack,'Read verification must match the exact retried ACK');
  assert.deepEqual(core.active,ack,'Read verification must leave the authoritative head unchanged');
  return {failed:posts.filter(p=>p.status===503).length,replays:replays.length,finalRevision:core.active.revision};
 };
 return {core,intercept,attempts,reads,assertRetry,assertVerifiedRetry,setFault(value){fault=!!value;},get active(){return core.active;}};
}
