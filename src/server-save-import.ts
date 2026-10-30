import { deserializeParkSession } from './park-runtime.ts';
import type { MarketJournal } from './market-client.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const financial=(j:MarketJournal|null|undefined)=>!!j&&(j.operations.length>0||j.escrow.length>0||Object.keys(j.receipts).length>0);
/** Prepare only after the user explicitly chooses an old save and an empty slot.
 * This function reads no storage and performs no upload or write. Unknown schemas
 * and ambiguous market state fail closed, leaving the selected bytes untouched. */
export function prepareLocalSaveImport(raw:string, owner:string, currentJournal:MarketJournal|null, validateJournal:(value:unknown)=>void, newId:()=>string = () => crypto.randomUUID()) {
  if(!UUID.test(owner))throw Error('import-guest-required');
  const {city}=deserializeParkSession(raw);
  const journal=city.market as MarketJournal|undefined;
  if(journal){
    validateJournal(journal);
    if(journal.guestId!==null && journal.guestId!==owner)throw Error('import-guest-mismatch');
    if(financial(journal)&&journal.guestId!==owner)throw Error('import-market-reconciliation-required');
  }
  if(currentJournal){
    validateJournal(currentJournal);
    if(currentJournal.guestId!==null&&currentJournal.guestId!==owner)throw Error('import-guest-mismatch');
    if(financial(currentJournal)&&(!journal||JSON.stringify(journal)!==JSON.stringify(currentJournal)))throw Error('import-market-reconciliation-required');
    if(financial(journal)&&JSON.stringify(journal)!==JSON.stringify(currentJournal))throw Error('import-market-reconciliation-required');
  } else if(financial(journal)) throw Error('import-market-reconciliation-required');
  const cityId=journal?.cityId??newId();
  if(!UUID.test(cityId))throw Error('import-invalid-city-id');
  const population=city.households.reduce((n,h)=>n+h.members,0);
  if(!Number.isSafeInteger(population)||population<0||!Number.isSafeInteger(city.tick)||city.tick<0)throw Error('import-invalid-metadata');
  return {cityId,raw,metadata:{name:'Imported city',population,tick:city.tick}};
}
