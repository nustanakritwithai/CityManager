import { freshServerCityRaw } from './fresh-server-city.ts';
import { createCitySaveAuth, legacySaveOwner } from './city-save-auth.ts';
import { ServerCitySaveClient } from './server-city-save.ts';
import { inventoryLegacyCities, type MigrationCandidate } from './city-migration-inventory.ts';
import { deserializeParkSession } from './park-runtime.ts';
import { summary } from './sim.ts';
export function citySaveMetadata(raw:string){const {city}=deserializeParkSession(raw);return {name:'CityManager',population:summary(city).population,tick:city.tick};}
type EntryDependencies={auth:ReturnType<typeof createCitySaveAuth>;storage:Pick<Storage,'getItem'|'key'|'length'>;inventory:typeof inventoryLegacyCities;createClient:(request:ReturnType<typeof createCitySaveAuth>['request'],owner:string)=>ServerCitySaveClient};
/** Only a confirmed server city can dismiss this gate. Local bytes are migration input, never a fallback. */
export async function requireServerCityEntry(fresh:()=>string,configured?:string,dependencies:Partial<EntryDependencies>={}){
 const auth=dependencies.auth??createCitySaveAuth(configured);
 const storage=dependencies.storage??localStorage;
 const inventoryReader=dependencies.inventory??inventoryLegacyCities;
 const createClient=dependencies.createClient??((request,owner)=>new ServerCitySaveClient(request,owner));
 const blocked=Array.from(document.body.children).filter((n):n is HTMLElement=>n instanceof HTMLElement).map(node=>({node,inert:node.inert}));
 blocked.forEach(({node})=>node.inert=true);
 const overlay=document.createElement('section');overlay.className='guest-entry-gate';
 const card=document.createElement('div');card.className='guest-entry-card';
 const title=document.createElement('h1');title.textContent='CityManager';
 const note=document.createElement('p');note.textContent='บันทึกเมืองบนเซิร์ฟเวอร์เท่านั้น · ตลาดยังปิดอยู่ · ในหน้าต่างเข้าสู่ระบบ ใช้บัญชีเดิมหรือกู้คืนบัญชี หากเล่นครั้งแรก ให้เลือกสร้าง Guest ใหม่แล้วกด Continue';
 const choices=document.createElement('select');choices.hidden=true;choices.setAttribute('aria-label','เลือกเมืองที่จะเล่นต่อ');
 const button=document.createElement('button');button.textContent='เล่นต่อ';button.disabled=true;
 const status=document.createElement('p');status.setAttribute('role','status');
 card.append(title,note,choices,button,status);overlay.append(card);document.body.append(overlay);
 let busy=false,client:ServerCitySaveClient|null=null,candidates:MigrationCandidate[]=[];
 let expectedOwner:string|null=null,migrationIssues:string[]=[],pendingCreateRaw:string|null=null;
 let offeredDeleted:{cityId:string;revision:number}|null=null;
 try{expectedOwner=legacySaveOwner(storage);}catch{status.textContent='ยังอ่านบัญชี Guest เดิมไม่ได้ ข้อมูลเดิมยังอยู่ กรุณาตรวจบัญชีก่อน';return new Promise<never>(()=>{});}
 await auth.prepare().then(()=>{button.disabled=false;},()=>{status.textContent='ยังเตรียมการเชื่อมต่อไม่ได้ โปรดโหลดหน้าใหม่';});
 return new Promise<{client:ServerCitySaveClient;auth:ReturnType<typeof createCitySaveAuth>;raw:string;migrationIssues:string[]}>(resolve=>{
  const finish=(raw:string)=>{deserializeParkSession(raw);overlay.remove();blocked.forEach(({node,inert})=>node.inert=inert);resolve({client:client!,auth,raw,migrationIssues});};
  button.onclick=async()=>{
   if(busy)return;busy=true;button.disabled=true;choices.disabled=true;
   try{
    status.textContent='กำลังเชื่อมต่อและตรวจเซฟ…';
    const owner=await auth.connect(expectedOwner);expectedOwner=owner;client??=createClient(auth.request,owner);
    // A racing create never overwrites the city created by another device.
    if(client.conflict){
     if(!window.confirm('พบเมืองหลักบนเซิร์ฟเวอร์จากอีกอุปกรณ์ เก็บเมืองที่เลือกเป็นสำเนาแล้วเปิดเมืองหลักหรือไม่?'))return;
     if(pendingCreateRaw)await client.archive({source:'migration-create-conflict',raw:pendingCreateRaw});
     client.discardConflictedAttempt();
    }
    // Retry an uncertain create verbatim before any reload or competing operation.
    if(client.pending){const retried=await client.retry();if(!('deleted' in retried)){finish(retried.raw);return;}}
    const active=await client.load();
    const inventory=await inventoryReader(storage);migrationIssues=inventory.issues;
    try{const journal=storage.getItem('citymanager.market.v10');if(journal!==null){const value=JSON.parse(journal);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-market-journal');await client.archive({source:'localStorage:citymanager.market.v10:nonplayable',raw:journal});}}catch(error){if(error instanceof SyntaxError)migrationIssues.push('standalone-market-journal-unreadable');else throw error;}
    for(const candidate of inventory.candidates)for(const source of candidate.sources)await client.archive({source,raw:candidate.raw});
    if(active&&'deleted' in active){
     // A durable deletion is authoritative over every retained browser copy.
     choices.hidden=true;choices.replaceChildren();
     if(!offeredDeleted||offeredDeleted.cityId!==active.cityId||offeredDeleted.revision!==active.revision){
      offeredDeleted={cityId:active.cityId,revision:active.revision};button.textContent='เริ่มเมืองใหม่';
      status.textContent='เมืองเดิมถูกลบจากเมืองที่ใช้งานแล้ว เก็บสำเนาสำรองบนเซิร์ฟเวอร์ กดเริ่มเมืองใหม่เพื่อสร้างรหัสเมืองใหม่ ไม่เปิดเซฟเก่าอัตโนมัติ';return;
     }
     pendingCreateRaw=freshServerCityRaw(owner);finish((await client.create(pendingCreateRaw,citySaveMetadata(pendingCreateRaw))).raw);return;
    }
    if(active){finish(active.raw);return;}
    // Unknown old storage is not evidence of an empty city. Preserve originals and retry.
    if(inventory.issues.length)throw Error(`ยังตรวจเซฟเดิมไม่ครบ (${inventory.issues.join(', ')}) · ข้อมูลเดิมยังอยู่`);
    const previous=choices.value;
    candidates=inventory.candidates;
    if(candidates.length>1){
     const selected=candidates.find(c=>c.raw===previous);
     if(!selected){choices.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='พบหลายเมือง กรุณาเลือกเมืองที่จะเล่นต่อ';choices.append(placeholder);
      candidates.forEach((c,i)=>{const option=document.createElement('option');option.value=c.raw;option.textContent=`เมือง ${i+1} · วันที่ ${c.tick} · ${c.sources.join(', ')}`;choices.append(option);});
      choices.hidden=false;status.textContent='เก็บสำเนาทั้งหมดบนเซิร์ฟเวอร์แล้ว เลือกเมืองหลักโดยไม่เดาจากวันที่';return;
     }
     pendingCreateRaw=selected.raw;finish((await client.create(selected.raw,citySaveMetadata(selected.raw))).raw);return;
    }
    const raw=candidates[0]?.raw??fresh();pendingCreateRaw=raw;finish((await client.create(raw,citySaveMetadata(raw))).raw);
   }catch(error){status.textContent=`ยังเข้าเมืองไม่ได้: ${error instanceof Error?error.message:'เชื่อมต่อไม่ได้'} · กดเล่นต่อเพื่อลองใหม่`;}
   finally{busy=false;button.disabled=false;choices.disabled=false;void auth.prepare();}
  };
 });
}
