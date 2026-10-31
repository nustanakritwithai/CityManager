import { createCity } from '../src/sim.ts';
import { createParkRuntime, serializeParkSession } from '../src/park-runtime.ts';
/** Generated valid legacy history, never a copied player payload. */
export function oversizedLegacyCity() {
 const city=createCity(123,{starter:false});city.tick=120;
 city.market={version:10,rulesVersion:'chain-5',cityId:'22222222-2222-4222-8222-222222222222',guestId:'00000000-0000-4000-8000-000000000001',operations:[{opId:'pending-fixture',state:'pending'}],escrow:[{state:'unknown',quantity:3}],receipts:{fixture:{state:'undelivered'}},seq:'7'};
 const reason='Historical simulation transfer '+'.'.repeat(1000);
 for(let i=0;i<4200;i++)city.ledger.push({tick:1,from:'outside',to:'treasury',amount:1,reason},{tick:1,from:'treasury',to:'outside',amount:1,reason});
 return serializeParkSession(city,createParkRuntime(city));
}
