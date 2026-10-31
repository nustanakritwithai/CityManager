import { freshServerCityRaw } from './fresh-server-city.ts';
import { createCitySaveAuth, legacySaveOwner } from './city-save-auth.ts';
import { ServerCitySaveClient } from './server-city-save.ts';
import { deserializeParkSession } from './park-runtime.ts';
import { summary } from './sim.ts';
export function citySaveMetadata(raw:string){const {city}=deserializeParkSession(raw);return {name:'CityManager',population:summary(city).population,tick:city.tick};}
type EntryDependencies={auth:ReturnType<typeof createCitySaveAuth>;storage:Pick<Storage,'getItem'|'key'|'length'>;createClient:(request:ReturnType<typeof createCitySaveAuth>['request'],owner:string)=>ServerCitySaveClient};
/** Only the authenticated server head is playable. Browser city copies are never read as candidates. */
export async function requireServerCityEntry(_fresh:()=>string,configured?:string,dependencies:Partial<EntryDependencies>={}){
 const auth=dependencies.auth??createCitySaveAuth(configured),storage=dependencies.storage??localStorage;
 const createClient=dependencies.createClient??((request,owner)=>new ServerCitySaveClient(request,owner));
 const blocked=Array.from(document.body.children).filter((n):n is HTMLElement=>n instanceof HTMLElement).map(node=>({node,inert:node.inert}));blocked.forEach(({node})=>node.inert=true);
 const overlay=document.createElement('section');overlay.className='guest-entry-gate';
 const card=document.createElement('div');card.className='guest-entry-card';
 const title=document.createElement('h1');title.textContent='CityManager';
 const note=document.createElement('p');note.textContent='เล่นต่อจากเซฟที่เซิร์ฟเวอร์ยืนยันเท่านั้น · ไม่เปิดเซฟในเบราว์เซอร์ · ตลาดยังปิดอยู่ · เข้าสู่ระบบด้วยบัญชีเดิมหรือกู้คืนบัญชี หากเล่นครั้งแรก ให้เลือกสร้าง Guest ใหม่แล้วกด Continue';
 const button=document.createElement('button');button.textContent='เล่นต่อ';button.disabled=true;
 const status=document.createElement('p');status.setAttribute('role','status');card.append(title,note,button,status);overlay.append(card);document.body.append(overlay);
 let busy=false,client:ServerCitySaveClient|null=null,expectedOwner:string|null=null;
 let offeredEmpty:string|null=null;
 try{expectedOwner=legacySaveOwner(storage);}catch{status.textContent='ยังอ่านบัญชี Guest เดิมไม่ได้ ข้อมูลบัญชียังอยู่ กรุณาตรวจบัญชีก่อน';return new Promise<never>(()=>{});}
 await auth.prepare().then(()=>{button.disabled=false;},()=>{status.textContent='ยังเตรียมการเชื่อมต่อไม่ได้ โปรดโหลดหน้าใหม่';});
 return new Promise<{client:ServerCitySaveClient;auth:ReturnType<typeof createCitySaveAuth>;raw:string;migrationIssues:string[]}>(resolve=>{
  const finish=(raw:string)=>{deserializeParkSession(raw);overlay.remove();blocked.forEach(({node,inert})=>node.inert=inert);resolve({client:client!,auth,raw,migrationIssues:[]});};
  button.onclick=async()=>{
   if(busy)return;busy=true;button.disabled=true;
   try{
    status.textContent='กำลังเชื่อมต่อและตรวจเซฟ…';
    const owner=await auth.connect(expectedOwner);expectedOwner=owner;client??=createClient(auth.request,owner);
    // Rejected browser-only intent cannot replace the authoritative server head.
    if(client.conflict)client.discardConflictedAttempt();
    if(client.pending)await client.retry();
    const active=await client.load();
    if(active&&!('deleted' in active)){finish(active.raw);return;}
    const emptyKey=active?`${active.cityId}:${active.revision}`:'never-created';
    if(offeredEmpty!==emptyKey){
     offeredEmpty=emptyKey;button.textContent='เริ่มเมืองใหม่';
     status.textContent=active?'เมืองเดิมถูกลบจากเมืองที่ใช้งานแล้ว เก็บสำเนาสำรองบนเซิร์ฟเวอร์ กดเริ่มเมืองใหม่เพื่อสร้างรหัสเมืองใหม่ ไม่เปิดเซฟเก่าอัตโนมัติ':'บัญชีนี้ยังไม่มีเมืองที่เซิร์ฟเวอร์ยืนยัน กดเริ่มเมืองใหม่เพื่อสร้างเมืองบนเซิร์ฟเวอร์ ไม่ใช้เซฟเก่าในเบราว์เซอร์';return;
    }
    const raw=freshServerCityRaw(owner);await client.create(raw,citySaveMetadata(raw));
    const confirmed=await client.load();if(!confirmed||'deleted' in confirmed)throw Error('เมืองใหม่ยังไม่ใช่เมืองหลัก กรุณาตรวจสถานะอีกครั้ง');finish(confirmed.raw);
   }catch(error){status.textContent=`ยังเข้าเมืองไม่ได้: ${error instanceof Error?error.message:'เชื่อมต่อไม่ได้'} · กดเล่นต่อเพื่อลองใหม่`;}
   finally{busy=false;button.disabled=false;void auth.prepare();}
  };
 });
}
