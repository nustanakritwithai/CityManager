/** A remembered explicit choice is only a hint, never permission to overwrite. */
export const RESUME_CHOICE_KEY='citymanager.resume-choice.v1';
export type ResumeChoice={id:string;label:string;raw:string;advanced?:boolean};
export async function saveFingerprint(raw:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),v=>v.toString(16).padStart(2,'0')).join('');}
async function inventoryFingerprint(choices:ResumeChoice[]){return saveFingerprint(JSON.stringify(await Promise.all([...choices].sort((a,b)=>a.id.localeCompare(b.id)).map(async c=>[c.id,await saveFingerprint(c.raw)]))));}
export async function rememberResumeChoice(storage:Pick<Storage,'setItem'>&Partial<Pick<Storage,'getItem'>>,choice:ResumeChoice,inventory:ResumeChoice[],isCurrent:()=>boolean=()=>true):Promise<void>{
 try{if(storage.getItem&&JSON.parse(storage.getItem(RESUME_CHOICE_KEY)??'null')?.requireChoice===true)return;const fingerprint=await saveFingerprint(choice.raw),inventoryHash=await inventoryFingerprint(inventory);if(isCurrent()&&(!storage.getItem||JSON.parse(storage.getItem(RESUME_CHOICE_KEY)??'null')?.requireChoice!==true))storage.setItem(RESUME_CHOICE_KEY,JSON.stringify({version:1,id:choice.id,fingerprint,inventoryHash}));}catch{/* Preference failure never changes the completed save result. */}
}
export async function rememberedResumeChoice(storage:Pick<Storage,'getItem'>,choices:ResumeChoice[]):Promise<string|null>{
 try{const saved=JSON.parse(storage.getItem(RESUME_CHOICE_KEY)??'null');if(saved?.version!==1||typeof saved.id!=='string'||!/^[a-f0-9]{64}$/.test(saved.fingerprint))return null;const choice=choices.find(c=>c.id===saved.id);return choice&&await saveFingerprint(choice.raw)===saved.fingerprint&&await inventoryFingerprint(choices)===saved.inventoryHash?choice.id:null;}catch{return null;}
}
export function sameResumeInventory(a:ResumeChoice[],b:ResumeChoice[]):boolean{return a.length===b.length&&a.every(c=>b.some(d=>d.id===c.id&&d.raw===c.raw));}

export function suppressRememberedChoice(storage:Pick<Storage,'getItem'|'setItem'>):string{
 const raw=JSON.stringify({version:1,requireChoice:true,revision:crypto.randomUUID()});storage.setItem(RESUME_CHOICE_KEY,raw);if(storage.getItem(RESUME_CHOICE_KEY)!==raw)throw Error('choice-suppression-unverified');return raw;
}

/** Explicit unresolved choice overrides every older preference, regardless of storage. */
export function resolveResumePreference(remembered:string|null,active:{id:string;requireChoice?:true}|null):string|null{return active?.requireChoice?null:remembered??active?.id??null;}
