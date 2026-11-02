import assert from 'node:assert/strict';
import {createTrafficServerFixture} from './traffic-server-entry-fixture.mjs';

/** Isolated UX adapter around the same real in-memory save service as traffic.
 * A synthetic 503 is returned before mutation; retries use the native client. */
export function createFeedbackServerFixture(url){
 const core=createTrafficServerFixture(url),attempts=[];let fault=false;
 const intercept=async(params,send)=>{
  const post=new URL(params.request.url).pathname==='/citymanager-api/v1/city-save'&&params.request.method==='POST';
  if(!post)return core.intercept(params,send);
  const event={key:Object.entries(params.request.headers??{}).find(([name])=>name.toLowerCase()==='idempotency-key')?.[1],command:JSON.parse(params.request.postData),status:null,response:null};attempts.push(event);
  if(fault){event.status=503;event.response={error:'synthetic-save-unavailable'};await send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(event.response)).toString('base64')});return true;}
  return core.intercept(params,async(method,payload)=>{event.status=payload.responseCode;event.response=JSON.parse(Buffer.from(payload.body,'base64').toString());return send(method,payload);});
 };
 const assertRetry=(index,before)=>{
  const posts=attempts.slice(index),original=posts[0];assert.equal(original?.status,503,'A real native save received a synthetic server refusal');
  assert.ok(original.key,'The failed intent has an idempotency key');
  const replays=posts.filter(p=>p.key===original.key),next=posts.find(p=>p.key!==original.key);
  assert.ok(replays.some(p=>p.status===200),'The same intent receives an authoritative ACK');
  for(const replay of replays)assert.deepEqual(replay.command,original.command,'Every replay retains the exact request body');
  const ack=replays.find(p=>p.status===200).response;assert.equal(ack.revision,before.revision+1);assert.equal(ack.raw,original.command.raw);
  assert.ok(next&&next.status===200,'A distinct current-state save follows the retried ACK');assert.equal(next.command.expectedRevision,ack.revision);assert.equal(next.response.revision,ack.revision+1);
  assert.equal(core.active.revision,next.response.revision);assert.equal(core.active.raw,next.response.raw);
  return {failed:posts.filter(p=>p.status===503).length,replays:replays.length,finalRevision:core.active.revision};
 };
 return {core,intercept,attempts,assertRetry,setFault(value){fault=!!value;},get active(){return core.active;}};
}
