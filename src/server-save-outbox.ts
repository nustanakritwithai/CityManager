/** Durable, explicit per-city uploads. The caller supplies a cross-tab lock and
 * must validate/import a snapshot before enqueueing it. No startup fallback is
 * ever automatically enqueued. */
type Metadata = {name:string; population:number; tick:number};
type Command = {action:'create'; cityId:string; slot:number; raw:string; metadata:Metadata} | {action:'save'; cityId:string; expectedRevision:number; raw:string; metadata:Metadata};
type Ack = {cityId:string; revision:number; deleted:boolean; slot:number};
type Pending = {requestId:string; command:Command; conflict:boolean};
type Archive = {localRaw:string; remoteRaw:string; pending:Pending};
type RecordV1 = {version:1; owner:string; cityId:string; raw:string; confirmedRaw:string|null; revision:number|null; synced:boolean; pending:Pending|null; conflicts:Archive[]};
type StorageLike = Pick<Storage,'getItem'|'setItem'>;
type Locks = { request<T>(name:string, options:{mode:'exclusive'}, work:()=>Promise<T>):Promise<T> };
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createCityOutbox(storage:StorageLike, locks:Locks, owner:string, cityId:string, newId:()=>string = () => crypto.randomUUID()) {
  if(!UUID.test(owner)||!UUID.test(cityId)||!locks) throw Error('outbox-unavailable');
  const key=`citymanager.server-city.v1.${owner}.${cityId}`;
  const lock=<T>(work:()=>Promise<T>)=>locks.request(key,{mode:'exclusive'},work);
  function read() { return storage.getItem(key); }
  function parse(value:string|null):RecordV1|null {
    if(value===null)return null;
    let v:RecordV1; try {v=JSON.parse(value);} catch {throw Error('outbox-corrupt');}
    if(!v||v.version!==1||v.owner!==owner||v.cityId!==cityId||typeof v.raw!=='string'||!(v.confirmedRaw===null||typeof v.confirmedRaw==='string')||!(v.revision===null||Number.isSafeInteger(v.revision)&&v.revision>0)||(v.revision===null)!==(v.confirmedRaw===null)||typeof v.synced!=='boolean'||(v.synced&&v.raw!==v.confirmedRaw)||!Array.isArray(v.conflicts)||v.conflicts.some(a=>!a||typeof a.localRaw!=='string'||typeof a.remoteRaw!=='string'||!a.pending)||!(v.pending===null||v.pending&&UUID.test(v.pending.requestId)&&v.pending.command?.cityId===cityId&&typeof v.pending.conflict==='boolean')) throw Error('outbox-corrupt');
    if(v.pending) {
      const p=v.pending, c=p.command;
      if(!c || typeof c.raw!=='string' || !c.raw || !c.metadata || typeof c.metadata.name!=='string' || c.metadata.name.length>120 || !Number.isSafeInteger(c.metadata.population) || c.metadata.population<0 || !Number.isSafeInteger(c.metadata.tick) || c.metadata.tick<0 || (c.action==='create' ? v.revision!==null || !Number.isInteger(c.slot) || c.slot<1 || c.slot>3 : c.action!=='save' || v.revision===null || c.expectedRevision!==v.revision)) throw Error('outbox-corrupt');
    }
    return v;
  }
  const exact=(expected:string|null)=>{const current=read();if(current!==expected)throw Error('outbox-changed-reload');return parse(current);};
  return {
    read,
    inspect(value:string|null){return parse(value);},
    // Never expose a pending upload as the acknowledged durable revision.
    readConfirmed(){return parse(read())?.confirmedRaw ?? null;},
    // Local autosave can advance while a previous upload awaits its response.
    // The pending command and its idempotency key remain byte-for-byte stable.
    async saveLocal(expected:string, raw:string) {
      return lock(async()=>{
        const v=exact(expected);if(!v||typeof raw!=='string'||!raw)throw Error('outbox-invalid-local-save');
        const next:RecordV1={...v,raw,synced:v.pending===null&&v.confirmedRaw===raw};
        const encoded=JSON.stringify(next);parse(encoded);storage.setItem(key,encoded);return encoded;
      });
    },
    async enqueue(expected:string|null, command:Command) {
      return lock(async()=>{
        const previous=exact(expected);
        if(previous?.pending)throw Error('outbox-pending');
        if(command.cityId!==cityId||typeof command.raw!=='string'||!command.raw)throw Error('outbox-invalid-command');
        if(command.action==='create' ? previous!==null || !Number.isInteger(command.slot)||command.slot<1||command.slot>3 : !previous || previous.revision===null || command.expectedRevision!==previous.revision) throw Error('outbox-conflict');
        const requestId=newId(); if(!UUID.test(requestId))throw Error('outbox-invalid-request-id');
        const value:RecordV1={version:1,owner,cityId,raw:command.raw,confirmedRaw:previous?.confirmedRaw??null,revision:previous?.revision??null,synced:false,pending:{requestId,command,conflict:false},conflicts:previous?.conflicts??[]};
        const encoded=JSON.stringify(value);parse(encoded);storage.setItem(key,encoded);return encoded;
      });
    },
    async resolveConflict(expected:string, remote:{cityId:string; revision:number; raw:string; deleted:boolean}, choice:'use-server'|'keep-local') {
      return lock(async()=>{
        const v=exact(expected);
        if(!v?.pending?.conflict)throw Error('outbox-not-conflicted');
        if(remote.cityId!==cityId||remote.deleted!==false||!Number.isSafeInteger(remote.revision)||remote.revision<1||typeof remote.raw!=='string'||!remote.raw||(choice!=='use-server'&&choice!=='keep-local'))throw Error('outbox-invalid-remote');
        const conflicts=[...v.conflicts,{localRaw:v.raw,remoteRaw:remote.raw,pending:v.pending}];
        const next:RecordV1={...v,raw:choice==='use-server'?remote.raw:v.raw,confirmedRaw:remote.raw,revision:remote.revision,synced:choice==='use-server',pending:null,conflicts};
        const encoded=JSON.stringify(next);parse(encoded);storage.setItem(key,encoded);return encoded;
      });
    },
    async flush(expected:string, send:(requestId:string,command:Command)=>Promise<Ack>) {
      return lock(async()=>{
        const v=exact(expected); if(!v?.pending)throw Error('outbox-not-pending'); if(v.pending.conflict)throw Error('outbox-conflict-resolution-required');
        let ack:Ack;
        try {ack=await send(v.pending.requestId,v.pending.command);} catch(error) {
          if(Number((error as {status?:unknown})?.status)===409){v.pending.conflict=true;storage.setItem(key,JSON.stringify(v));}
          throw error;
        }
        const command=v.pending.command, revision=command.action==='create'?1:command.expectedRevision+1;
        if(ack.cityId!==cityId||ack.revision!==revision||ack.deleted!==false||!Number.isInteger(ack.slot)||ack.slot<1||ack.slot>3||(command.action==='create'&&ack.slot!==command.slot))throw Error('outbox-invalid-ack');
        // Publication happens only after ACK validation and a successful local write.
        const next:RecordV1={...v,confirmedRaw:command.raw,revision,synced:v.raw===command.raw,pending:null};const encoded=JSON.stringify(next);storage.setItem(key,encoded);return encoded;
      });
    }
  };
}
