// Passive loopback-only diagnostics. No request mutation, await, suppression,
// payload logging or changes to navigation/acceptance decisions.
import assert from 'node:assert/strict';
export const SAVE_LIFECYCLE_MARKER='citymanager-test-lifecycle-v1';
export function installSaveLifecycleObserver(origin,marker){
 if(location.origin!==origin)return;
 const note=event=>console.debug(marker,JSON.stringify({event:event.type,at:Date.now(),document:performance.timeOrigin,hidden:document.hidden,...(typeof event.persisted==='boolean'?{persisted:event.persisted}:{})}));
 for(const event of ['beforeunload','pagehide','pageshow'])window.addEventListener(event,note);
 document.addEventListener('visibilitychange',note);
}
export function createSaveLifecycleAudit(origin,{now=Date.now}={}){
 assert.equal(new URL(origin).hostname,'127.0.0.1');assert.equal(new URL(origin).protocol,'http:');
 const timeline=[],requests=[],failures=[],byKey=new Map(),byNetwork=new Map(),documents=new Map(),frames=new Map(),loaders=new Map();
 let sequence=0,requestSequence=0,structuralSequence=0,scenario=0,navigation='initial',lastLifecycle=null,lastAck=null;
 const ordinal=(map,value)=>{if(value===undefined||value===null||value==='')return null;if(!map.has(value)){map.set(value,++structuralSequence);if(map.size>128)map.delete(map.keys().next().value);}return map.get(value);};
 const context=()=>({scenario,navigation,lastAck:lastAck&&{...lastAck},lastLifecycle:lastLifecycle&&{...lastLifecycle}});
 const record=data=>{
  const entry={sequence:++sequence,at:now(),...data};timeline.push(entry);if(timeline.length>240)timeline.shift();
  for(const failure of failures)if(data.request===failure.request||['navigation','lifecycle','server-ack'].includes(data.event)){if(failure.after.length<24)failure.after.push(entry);}
  return entry;
 };
 const keyFrom=headers=>{const value=Object.entries(headers??{}).find(([name])=>name.toLowerCase()==='idempotency-key')?.[1];return typeof value==='string'&&value.length<=128?value:null;};
 const pair=(key,source)=>{
  const bucket=key?byKey.get(key)??[]:[];
  let request=bucket.find(item=>!item[source]);
  if(!request){request={request:++requestSequence,pairing:key?'existing-key':'missing-key',http:false,network:false,...context()};requests.push(request);if(requests.length>64)requests.shift();bucket.push(request);if(bucket.length>64)bucket.shift();}
  request[source]=true;
  if(key){byKey.set(key,bucket);if(byKey.size>128)byKey.delete(byKey.keys().next().value);}
  // Multiple simultaneous attempts with one key can only be paired by order.
  if(bucket.filter(item=>item[source]&&!item[source==='http'?'network':'http']).length>1)for(const item of bucket)item.pairing='same-key-order-ambiguous';
  return request;
 };
 const find=id=>requests.find(item=>item.request===id);
 const api=url=>{try{const target=new URL(url);return target.origin===origin&&target.pathname==='/citymanager-api/v1/city-save';}catch{return false;}};
 return {
  navigation(stage){assert.ok(['scenario-leave','scenario-enter','manual-reload'].includes(stage));navigation=stage;record({event:'navigation',...context()});},
  seed(revision){scenario++;lastAck={scenario,revision,request:null};record({event:'server-seed',...context()});},
  observeBrowser(method,p){
   if(method==='Runtime.consoleAPICalled'&&p.type==='debug'&&p.args?.length===2&&p.args[0]?.value===SAVE_LIFECYCLE_MARKER){
    let value;try{value=JSON.parse(p.args[1]?.value);}catch{return;}
    if(!['beforeunload','pagehide','pageshow','visibilitychange'].includes(value?.event)||typeof value.document!=='number'||!Number.isFinite(value.document)||typeof value.hidden!=='boolean')return;
    const lifecycle={type:value.event,sourceAt:Number.isFinite(value.at)?value.at:null,document:ordinal(documents,value.document),hidden:value.hidden,...(typeof value.persisted==='boolean'?{persisted:value.persisted}:{})};
    const entry=record({event:'lifecycle',...context(),...lifecycle});lastLifecycle={sequence:entry.sequence,at:entry.at,...lifecycle};return;
   }
   if(method==='Network.requestWillBeSent'&&p.request?.method==='POST'&&api(p.request.url)){
    let request=byNetwork.get(p.requestId);if(!request){request=pair(keyFrom(p.request.headers),'network');byNetwork.set(p.requestId,request);if(byNetwork.size>128)byNetwork.delete(byNetwork.keys().next().value);}
    request.frame=ordinal(frames,p.frameId);request.loader=ordinal(loaders,p.loaderId);
    record({event:'browser-request',request:request.request,sourceAt:Number.isFinite(p.wallTime)?p.wallTime*1000:null,frame:request.frame,loader:request.loader,...context()});return;
   }
   if(method==='Network.loadingFinished'||method==='Network.loadingFailed'){
    const request=byNetwork.get(p.requestId);if(!request)return;
    record({event:method==='Network.loadingFinished'?'browser-finished':'browser-failed',request:request.request,canceled:p.canceled===true});return;
   }
   if(method==='Page.javascriptDialogOpening'&&p.type==='beforeunload')record({event:'beforeunload-dialog',...context()});
   if(method==='Page.frameNavigated'&&p.frame)record({event:'frame-navigation',frame:ordinal(frames,p.frame.id),loader:ordinal(loaders,p.frame.loaderId),...context()});
  },
  httpStart(req,res){
   if(req.method!=='POST'||!api(new URL(req.url,origin).href))return null;
   const request=pair(keyFrom(req.headers),'http');record({event:'http-start',request:request.request,...context()});
   res.once('finish',()=>record({event:'http-response-finished',request:request.request}));
   res.once('close',()=>record({event:'http-response-closed',request:request.request,finished:res.writableFinished===true}));
   return request.request;
  },
  httpResponse(id,status,body){
   if(id===null||id===undefined)return;
   let revision=null;try{const value=JSON.parse(Buffer.from(body??'','base64').toString());if(Number.isSafeInteger(value?.revision)&&value.revision>=1)revision=value.revision;}catch{}
   const request=find(id);if(request){request.status=status;request.ackRevision=revision;}
   if(status===200&&revision!==null){lastAck={scenario:request?.scenario??scenario,revision,request:id};record({event:'server-ack',request:id,status,revision,...context()});}
   else record({event:'server-response',request:id,status,revision});
  },
  httpFailure(id,detail){
   if(id===null||id===undefined)return;
   const fields={phase:detail.phase,bodyBytes:detail.bodyBytes,bodyComplete:detail.bodyComplete,requestComplete:detail.requestComplete,requestAborted:detail.requestAborted,errorName:detail.errorName,errorCode:detail.errorCode};
   const entry=record({event:'http-failure',request:id,...fields,...context()});
   failures.push({request:id,failure:entry,before:timeline.slice(-32),after:[]});if(failures.length>16)failures.shift();
  },
  get evidence(){return structuredClone({requests,timeline,failures});}
 };
}
