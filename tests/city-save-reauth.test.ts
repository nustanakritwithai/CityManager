import test from 'node:test';
import assert from 'node:assert/strict';
import {createCitySaveAuth} from '../src/city-save-auth.ts';
import {pagesSession,PAGES_ORIGIN,MARKET_ORIGIN} from '../src/pages-auth.ts';
const guest='00000000-0000-4000-8000-000000000003',token='t'.repeat(43),code='c'.repeat(43);
class Host extends EventTarget {
 location={origin:PAGES_ORIGIN};blocked=false;opens=0;url='';intents:any[]=[];
 popup={closed:false,close(){this.closed=true;},postMessage:(v:any)=>this.intents.push(v)};
 open(url:string){this.opens++;this.url=url;this.popup.closed=false;return this.blocked?null:this.popup;}
 send(type:string){const e=new Event('message');Object.defineProperties(e,{origin:{value:MARKET_ORIGIN},source:{value:this.popup},data:{value:{type,state:new URL(this.url).searchParams.get('state'),code}}});this.dispatchEvent(e);}
}
async function harness(run:(h:Host)=>Promise<void>){
 const names=['window','location','localStorage'] as const,old=names.map(n=>Object.getOwnPropertyDescriptor(globalThis,n));const fetch=globalThis.fetch,prepare=pagesSession.prepare;const h=new Host();
 Object.defineProperty(globalThis,'window',{configurable:true,value:h});Object.defineProperty(globalThis,'location',{configurable:true,value:h.location});Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('storage prohibited');}});
 pagesSession.clear();globalThis.fetch=async input=>new Response(JSON.stringify(String(input).endsWith('/v1/me')?{guest_id:guest}:{access_token:token,token_type:'Bearer',expires_in:900,guest_id:guest}),{status:200});
 try{await run(h);}finally{pagesSession.clear();pagesSession.prepare=prepare;globalThis.fetch=fetch;names.forEach((n,i)=>old[i]?Object.defineProperty(globalThis,n,old[i]!):Reflect.deleteProperty(globalThis,n));}
}
async function establish(h:Host){const auth=createCitySaveAuth();await auth.prepare();const login=auth.connect(guest);h.send('citymanager-auth-code');assert.equal(await login,guest);pagesSession.clear();return auth;}
for(const failure of ['blocked','closed','exchange'] as const)test(`${failure} login failure re-primes a second explicit same-Guest gesture`,()=>harness(async h=>{
 const auth=await establish(h),fetch=globalThis.fetch;const before=h.opens;
 if(failure==='blocked')h.blocked=true;
 if(failure==='exchange')globalThis.fetch=async()=>new Response('{}',{status:503});
 const failed=auth.connect();assert.equal(h.opens,before+1,'popup is synchronous');const firstState=new URL(h.url).searchParams.get('state');
 if(failure==='closed')h.popup.closed=true;
 if(failure==='exchange')h.send('citymanager-auth-code');
 await assert.rejects(failed,new RegExp(`pages-${failure==='blocked'?'popup-blocked':failure==='closed'?'popup-closed':'exchange-failed'}`));
 assert.equal(auth.owner,guest);assert.equal(pagesSession.bearer(),null);assert.equal(h.opens,before+1,'preparation never opens a popup');
 h.blocked=false;globalThis.fetch=fetch;
 const retry=auth.connect();assert.equal(h.opens,before+2);assert.notEqual(new URL(h.url).searchParams.get('state'),firstState);
 h.send('citymanager-auth-ready');assert.equal(h.intents.at(-1).expectedGuest,guest);h.send('citymanager-auth-code');assert.equal(await retry,guest);
}));
test('concurrent reconnect is rejected without consuming the active challenge',()=>harness(async h=>{
 const auth=await establish(h),before=h.opens;const active=auth.connect(),url=h.url;
 await assert.rejects(auth.connect(),/pages-login-busy/);assert.equal(h.opens,before+1);assert.equal(h.url,url);
 h.send('citymanager-auth-code');assert.equal(await active,guest);
}));
test('failed preparation preserves the original login error and owner',()=>harness(async h=>{
 const auth=await establish(h);h.blocked=true;pagesSession.prepare=async()=>{throw Error('digest unavailable');};
 await assert.rejects(auth.connect(),/pages-popup-blocked/);assert.equal(auth.owner,guest);assert.equal(pagesSession.bearer(),null);
}));
