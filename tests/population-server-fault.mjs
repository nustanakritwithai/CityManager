// Test-only fault around the real isolated service: never report a fabricated ACK.
import assert from 'node:assert/strict';
export function installPopulationSaveFault(server){
 const dispatch=server.intercept;let armed=false;const failures=[];
 server.intercept=async(params,send)=>{
  const request=params.request, target=new URL(request.url);
  if(armed&&target.pathname==='/citymanager-api/v1/city-save'&&request.method==='POST'){
   armed=false;const command=JSON.parse(request.postData),key=Object.entries(request.headers??{}).find(([k])=>k.toLowerCase()==='idempotency-key')?.[1];
   assert.equal(command.action,'save');assert.ok(key);failures.push({command,key,status:503});
   await send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:'synthetic temporary outage'})).toString('base64')});return true;
  }
  return dispatch(params,send);
 };
 return {arm(){assert.equal(armed,false);armed=true;},get failures(){return structuredClone(failures);}};
}
