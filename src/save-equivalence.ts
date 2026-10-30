import {deserializeParkSession} from './park-runtime.ts';
/** Formatting-only compatibility, NOT migration or a newer-save selection policy.
 * Nested property order can affect ledger iteration, so only root key order is ignored.
 * Compare original parsed fields, never reconciled/migrated deserializer output.
 */
export function equivalentStoredSessions(left:string,right:string):boolean {
 try {
  deserializeParkSession(left);deserializeParkSession(right);
  const same=(a:unknown,b:unknown,root=false):boolean=>{
   if(Object.is(a,b))return true;
   if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
   const ak=Object.keys(a),bk=Object.keys(b);if(root){ak.sort();bk.sort();}
   return ak.length===bk.length&&ak.every((key,index)=>key===bk[index]&&same((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]));
  };
  return same(JSON.parse(left),JSON.parse(right),true);
 }catch{return false;}
}
