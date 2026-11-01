/** Save authentication is independent of the disabled trading feature. No city or token storage. */
import { pagesSession, PAGES_ORIGIN, PAGES_MARKET_BASE } from './pages-auth.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createCitySaveAuth(configured?:string) {
 const pages=location.origin===PAGES_ORIGIN;
 const endpoint=new URL(configured??'/citymanager-api',location.origin);
 if(!pages&&(endpoint.origin!==location.origin||endpoint.pathname!=='/citymanager-api'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash))throw Error('save-endpoint-not-allowed');
 const base=pages?PAGES_MARKET_BASE:'/citymanager-api';
 let owner:string|null=null;
 const request=async(path:string,init:RequestInit={}):Promise<any>=>{
  if(!path.startsWith('/v1/')||path.includes('://'))throw Error('invalid-save-path');
  const headers=new Headers(init.headers);headers.set('Accept','application/json');
  if(init.method&&init.method!=='GET')headers.set('Content-Type','application/json');
  if(pages){const token=pagesSession.bearer();if(!token)throw Object.assign(Error('เซสชันหมดอายุ กดบันทึกเพื่อเชื่อมต่อใหม่'),{status:401});headers.set('Authorization',`Bearer ${token}`);}
  else if(init.method&&init.method!=='GET')headers.set('x-csrf-token',document.cookie.split('; ').find(v=>v.startsWith('cm_csrf='))?.slice(8)??'');
  const response=await fetch(`${base}${path}`,{...init,headers,credentials:pages?'omit':'include',signal:AbortSignal.timeout(30_000)});
  let body:any=null;try{body=await response.json();}catch{}
  if(!response.ok){if(pages&&response.status===401){pagesSession.clear();void pagesSession.prepare().catch(()=>{});}throw Object.assign(Error(body?.error?.code??body?.error??`HTTP ${response.status}`),{status:response.status});}
  return body;
 };
 const prepare=()=>pages?pagesSession.prepare():Promise.resolve();
 const connect=async(expected:string|null=owner)=>{
  if(pages&&!pagesSession.bearer())await pagesSession.connect(expected);
  const me=await request('/v1/me');
  if(!UUID.test(String(me?.guest_id))||(expected&&me.guest_id!==expected)){if(pages){pagesSession.clear();void pagesSession.prepare().catch(()=>{});}throw Error('save-owner-mismatch');}
  if(pages)pagesSession.activate(me.guest_id);owner=me.guest_id;void prepare();return owner!;
 };
 return {request,prepare,connect,get owner(){return owner;}};
}
