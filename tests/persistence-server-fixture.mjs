// Disposable loopback-only server for browser persistence acceptance. It uses
// the production city-save service and a separate HTTP transport, including
// page-exit requests; only an explicit synthetic failure is injected.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createTrafficServerFixture,trafficHttpHandler,recordFixtureHttpFailure} from './traffic-server-entry-fixture.mjs';
import {createSaveLifecycleAudit} from './save-lifecycle-audit.mjs';
export async function startPersistenceFixture(upstream,{traceSaves=false}={}){
 const base=new URL(upstream);assert.equal(base.protocol,'http:');assert.equal(base.hostname,'127.0.0.1');
 const errors=[],deliveries=[],rejected=[],failureDetails=[];let handler,failSaves=false;
 const server=createServer((req,res)=>handler(req,res));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(base.pathname,origin).href;
 const trace=traceSaves?createSaveLifecycleAudit(origin):null;
 const fixture=createTrafficServerFixture(url),normal=trafficHttpHandler({origin,upstream,fixture,errors,deliveries,failureDetails,trace});
 handler=async(req,res)=>{
  if(failSaves&&req.method==='POST'&&req.url==='/citymanager-api/v1/city-save'){
   let phase='validate',bodyBytes=0,bodyComplete=false,traceId=null;
   try{assert.equal(req.headers.host,new URL(origin).host);traceId=trace?.httpStart(req,res)??null;let body='';phase='read-body';for await(const chunk of req){body+=chunk;bodyBytes+=Buffer.byteLength(chunk);assert.ok(Buffer.byteLength(body)<=10*1024*1024);}bodyComplete=true;phase='synthetic-reject';rejected.push({method:req.method,path:req.url,requestKey:req.headers['idempotency-key'],command:JSON.parse(body)});trace?.httpResponse(traceId,503,null);res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'synthetic-save-unavailable'}));return;}catch(error){const detail=recordFixtureHttpFailure(error,{req,res,errors,failureDetails,kind:'city-save',phase,bodyBytes,bodyComplete});trace?.httpFailure(traceId,detail);if(!res.headersSent&&!res.destroyed)res.writeHead(500);if(!res.destroyed)res.end();return;}
  }
  void normal(req,res);
 };
 return {url,fixture,errors,deliveries,rejected,failureDetails,trace,setSaveFailure(value){failSaves=value;},async close(){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
