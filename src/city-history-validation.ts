import { FARM_MAX_LEVEL } from './agriculture.ts';
import type { City } from './sim.ts';
import { CROPS, PRODUCTS, validMix } from './goods.ts';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
/** Strict, bounded checkpoint boundary; retained transactions are independently replayed afterwards. */
export function validateCityHistory(c:City):void {
 const fail=():never=>{throw Error('Unsupported or corrupt city history checkpoint');};
 if(!object(c.typeBaseline)||!object(c.accounts)||!Array.isArray(c.plants)||!Array.isArray(c.parks))return fail();
 const h=c.history;if(!h||!object(h)||h.version!==1||!integer(h.throughTick)||h.throughTick%30!==0||h.throughTick>Math.floor(c.tick/30)*30-30||h.throughTick<c.typeBaseline.tick)return fail();
 const expected=['version','throughTick','cropOffset','goodsOffset','moneyCount','accounts','goodsBalances','goodsTotals','cropTotals','cropHoldings','typedCrops','typedProducts','latestPurchase','latestBasket','lastIncome','roles','farmMinimumLevels','ownerFinance','ownerProfit','structuralProofs','firstProduction','arrivalCount','taxTotal','treasuryMonthEnds','daily','totals'];
 if(Object.keys(h).sort().join()!==expected.sort().join())fail();
 for(const key of ['cropOffset','goodsOffset','moneyCount','arrivalCount','taxTotal'] as const)if(!integer(h[key]))fail();
 const map=(value:unknown,validate:(key:string,value:any)=>boolean)=>{if(!object(value)||Object.keys(value).length>Object.keys(c.accounts).length+2)return fail();for(const [k,v] of Object.entries(value))if(!validate(k,v))fail();};
 const wallet=(key:string)=>Object.hasOwn(c.accounts,key);
 map(h.accounts,(k,v)=>wallet(k)&&integer(v,k==='outside'?Number.MIN_SAFE_INTEGER:0));
 if(Object.values(h.accounts).reduce((a,b)=>a+b,0)!==0)fail();
 map(h.goodsBalances,(k,v)=>(wallet(k)||k==='production')&&integer(v,Number.MIN_SAFE_INTEGER));
 for(const [value,keys] of [[h.goodsTotals,'produced,imported,consumed,exported'],[h.cropTotals,'harvested,processed,consumed,writtenOff,exported'],[h.totals,'moneyCount,moneyAmount,cropCount,cropQuantity,goodsCount,goodsQuantity']] as const)if(!object(value)||Object.keys(value).sort().join()!==keys.split(',').sort().join())fail();
 for(const totals of [h.goodsTotals,h.cropTotals,h.totals])if(!object(totals)||Object.values(totals).some(v=>!integer(v)))fail();
 if(h.totals.moneyCount!==h.moneyCount||h.totals.cropCount!==h.cropOffset||h.totals.goodsCount!==h.goodsOffset)fail();
 map(h.cropHoldings,(k,v)=>(wallet(k)||k==='market-server')&&object(v)&&Object.keys(v).sort().join()==='quantity,value'&&integer(v.quantity)&&integer(v.value));
 map(h.typedCrops,(k,v)=>(wallet(k)||k==='market-server')&&validMix(v,CROPS));
 map(h.typedProducts,(k,v)=>wallet(k)&&validMix(v,PRODUCTS));
 for(const value of [h.latestPurchase,h.lastIncome,h.firstProduction])map(value,(k,v)=>wallet(k)&&integer(v)&&v<=h.throughTick);
 map(h.latestBasket,(k,v)=>wallet(k)&&object(v)&&Object.keys(v).sort().join()==='commodity,quantity,tick'&&['goods','crops'].includes(String(v.commodity))&&integer(v.tick)&&v.tick<=h.throughTick&&integer(v.quantity,1));
 map(h.roles,(k,v)=>wallet(k)&&['F','T','I'].includes(v));
 map(h.farmMinimumLevels,(k,v)=>wallet(k)&&integer(v,1)&&v<=FARM_MAX_LEVEL);
 for(const [values,keys,signed] of [[h.ownerFinance,['contributed','withdrawn','taxPaid','cash','profit'],['profit']],[h.ownerProfit,['profit','tax','invested','retained'],['profit']]] as const)
  map(values,(k,v)=>wallet(k)&&object(v)&&Object.keys(v).sort().join()===[...keys].sort().join()&&Object.entries(v).every(([key,n])=>integer(n,(signed as readonly string[]).includes(key)?Number.MIN_SAFE_INTEGER:0)));
 for(const [wallet,seed] of Object.entries(h.ownerFinance))if(seed.cash!==(h.accounts[wallet]??0))fail();
 if(!Array.isArray(h.structuralProofs)||h.structuralProofs.length>Object.keys(c.accounts).length*12+c.plants.length+c.parks.length+10)fail();
 for(const e of h.structuralProofs)if(!object(e)||Object.keys(e).sort().join()!=='amount,from,reason,tick,to'||!integer(e.tick)||e.tick>h.throughTick||!integer(e.amount,1)||typeof e.reason!=='string'||typeof e.from!=='string'||typeof e.to!=='string'||!wallet(e.from)||!wallet(e.to)||e.from===e.to)fail();
 if(!Array.isArray(h.treasuryMonthEnds)||h.treasuryMonthEnds.length>4||h.treasuryMonthEnds.some((p,i)=>!object(p)||Object.keys(p).sort().join()!=='balance,tick'||!integer(p.tick)||p.tick%30!==0||p.tick>h.throughTick||!integer(p.balance)||i>0&&p.tick<=h.treasuryMonthEnds[i-1].tick))fail();
 if(!Array.isArray(h.daily)||h.daily.length>90)fail();let previous=-1;
 for(const d of h.daily){if(!object(d)||Object.keys(d).sort().join()!=='tick,moneyCount,moneyAmount,cropCount,goodsCount,income,expense,cropsHarvested,cropsProcessed,cropsConsumed,cropsWrittenOff,cropsExported,goodsProduced,goodsConsumed,goodsExported,goodsImported'.split(',').sort().join()||!integer(d.tick)||d.tick<=previous||d.tick>h.throughTick||Object.values(d).some(v=>!integer(v)))fail();previous=d.tick;}
 if(!Array.isArray(c.ledger)||!Array.isArray(c.cropLedger)||!Array.isArray(c.goodsLedger))fail();
 for(const entries of [c.ledger,c.cropLedger,c.goodsLedger])if(entries.some(e=>!e||!integer(e.tick)||e.tick<=h.throughTick))fail();
}
