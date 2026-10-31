/** The only active-city persistence transport. No local/session storage or IndexedDB. */
export type ServerCityMetadata = {name:string;population:number;tick:number};
export type ServerCity = {owner:string;cityId:string;revision:number;raw:string;rawHash:string;metadata:ServerCityMetadata};
export type ServerArchiveInfo = {hash:string;sources:string[];createdAt?:string};
export type ServerCityRequest = (path:string,init?:RequestInit)=>Promise<unknown>;
type Command = {action:'create';cityId:string;raw:string;metadata:ServerCityMetadata}|{action:'save';cityId:string;expectedRevision:number;raw:string;metadata:ServerCityMetadata};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
export async function serverSaveHash(raw:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),b=>b.toString(16).padStart(2,'0')).join('');}
const clone=<T>(value:T):T=>structuredClone(value);
export class ServerCitySaveClient {
 private request:ServerCityRequest;
 readonly owner:string;
 private value:ServerCity|null=null;
 private intent:{id:string;command:Command}|null=null;
 private busy=false;
 private loaded=false;
 private conflicted=false;
 constructor(request:ServerCityRequest,owner:string){if(!UUID.test(owner))throw Error('guest-required');this.request=request;this.owner=owner;}
 get confirmed(){return clone(this.value);}
 get pending(){return this.intent!==null;}
 get conflict(){return this.conflicted;}
 private async validate(v:unknown):Promise<ServerCity>{
  const c=v as ServerCity;if(!c||c.owner!==this.owner||!UUID.test(c.cityId)||!Number.isSafeInteger(c.revision)||c.revision<1||typeof c.raw!=='string'||!c.raw.length||!HASH.test(c.rawHash)||await serverSaveHash(c.raw)!==c.rawHash||!c.metadata||typeof c.metadata.name!=='string'||!Number.isSafeInteger(c.metadata.population)||c.metadata.population<0||!Number.isSafeInteger(c.metadata.tick)||c.metadata.tick<0)throw Error('invalid-server-save');
  const parsed=JSON.parse(c.raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.market&&(parsed.market.cityId!==c.cityId||parsed.market.guestId!==null&&parsed.market.guestId!==this.owner))throw Error('invalid-server-save-identity');return clone(c);
 }
 async load():Promise<ServerCity|null>{
  if(this.busy||this.intent)throw Error('server-save-pending');this.busy=true;
  try{const v=await this.request('/v1/city-save');this.value=v===null?null:await this.validate(v);this.loaded=true;this.conflicted=false;return this.confirmed;}finally{this.busy=false;}
 }
 async create(raw:string,metadata:ServerCityMetadata):Promise<ServerCity>{
  if(!this.loaded)throw Error('server-load-required');if(this.value)throw Error('server-city-exists');
  const parsed=JSON.parse(raw);return this.begin({action:'create',cityId:parsed.market?.cityId??crypto.randomUUID(),raw,metadata});
 }
 async save(raw:string,metadata:ServerCityMetadata):Promise<ServerCity>{
  if(!this.loaded||!this.value)throw Error('server-load-required');return this.begin({action:'save',cityId:this.value.cityId,expectedRevision:this.value.revision,raw,metadata});
 }
 private async begin(command:Command):Promise<ServerCity>{
  if(this.busy||this.intent)throw Error('server-save-pending');if(this.conflicted)throw Error('server-save-conflict');
  this.intent={id:crypto.randomUUID(),command:clone(command)};return this.retry();
 }
 /** Retains exactly the same command/key on timeout or invalid ACK. Never silently overwrites a 409. */
 async retry():Promise<ServerCity>{
  if(this.busy||!this.intent)throw Error('server-save-not-retryable');if(this.conflicted)throw Error('server-save-conflict');this.busy=true;
  const pending=this.intent;
  try{
   const v=await this.request('/v1/city-save',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':pending.id},body:JSON.stringify(pending.command)});
   const ack=await this.validate(v),command=pending.command;
   if(ack.cityId!==command.cityId||ack.revision!==(command.action==='create'?1:command.expectedRevision+1)||ack.raw!==command.raw||ack.metadata.name!==command.metadata.name||ack.metadata.population!==command.metadata.population||ack.metadata.tick!==command.metadata.tick)throw Error('invalid-server-ack');
   this.value=ack;this.intent=null;return clone(ack);
  }catch(error){if((error as {status?:number})?.status===409)this.conflicted=true;throw error;}finally{this.busy=false;}
 }
 /** Explicit conflict resolution discards only this in-memory attempt; caller must preserve/archive it first. */
 discardConflictedAttempt(){if(this.busy||!this.conflicted)throw Error('server-save-not-conflicted');this.intent=null;this.value=null;this.loaded=false;}
 async archive(input:{source:string;raw:string}):Promise<{hash:string;rawHash:string}>{
  const expected=await serverSaveHash(input.raw);const v=await this.request('/v1/city-save/archives',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}) as {hash:string;rawHash:string};
  if(!v||v.hash!==expected||v.rawHash!==expected)throw Error('invalid-archive-ack');
  const read=await this.readArchive(expected);if(read.raw!==input.raw||!read.sources.includes(input.source))throw Error('archive-verification-failed');return {hash:expected,rawHash:expected};
 }
 async listArchives():Promise<ServerArchiveInfo[]>{const v=await this.request('/v1/city-save/archives');if(!Array.isArray(v)||v.some(a=>!a||!HASH.test(a.hash)||!Array.isArray(a.sources)||a.sources.some((s:unknown)=>typeof s!=='string')))throw Error('invalid-archive-list');return clone(v);}
 async readArchive(id:string):Promise<ServerArchiveInfo&{raw:string}>{if(!HASH.test(id))throw Error('invalid-archive-id');const v=await this.request(`/v1/city-save/archives/${id}`) as ServerArchiveInfo&{raw:string};if(!v||v.hash!==id||typeof v.raw!=='string'||await serverSaveHash(v.raw)!==id||!Array.isArray(v.sources)||v.sources.some(s=>typeof s!=='string'))throw Error('invalid-archive');return clone(v);}
}
