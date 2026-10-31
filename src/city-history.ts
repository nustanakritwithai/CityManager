import type { City, Entry } from './sim.ts';
import type { CityHistory, HistoryDay } from './city-history-types.ts';
import { captureAgricultureHistory } from './agriculture-validation.ts';
import { captureTypedHistory } from './goods-validation.ts';
import { captureOwnerProfit } from './owner-profit.ts';

export const HISTORY_DAYS = 90;
export const cropJournalLength = (c: City) => (c.history?.cropOffset ?? 0) + c.cropLedger.length;
export const goodsJournalLength = (c: City) => (c.history?.goodsOffset ?? 0) + c.goodsLedger.length;
export const moneyJournalLength = (c: City) => (c.history?.moneyCount ?? 0) + c.ledger.length;
export const auditMoney = (c: City): Entry[] => c.history ? [...c.history.structuralProofs,...c.ledger].sort((a,b)=>a.tick-b.tick) : c.ledger;
const add = (a:number,b:number) => {const v=a+b;if(!Number.isSafeInteger(v))throw Error('history-total-overflow');return v;};
const copy = <T>(value:T):T => structuredClone(value);
const blankDay = (tick:number):HistoryDay => ({tick,moneyCount:0,moneyAmount:0,cropCount:0,goodsCount:0,income:0,expense:0,cropsHarvested:0,cropsProcessed:0,cropsConsumed:0,cropsWrittenOff:0,cropsExported:0,goodsProduced:0,goodsConsumed:0,goodsExported:0,goodsImported:0});

/** Retain exact current+previous month (30–59 days), compact only completed whole months. */
export function compactCityHistory(c: City): boolean {
 const throughTick=Math.floor(c.tick/30)*30-30;
 if(throughTick<=0||throughTick<=(c.history?.throughTick??-1)||throughTick<c.typeBaseline.tick)return false;
 const money=c.ledger.filter(e=>e.tick<=throughTick), crops=c.cropLedger.filter(e=>e.tick<=throughTick), goods=c.goodsLedger.filter(e=>e.tick<=throughTick);
 const tailMoney=c.ledger.filter(e=>e.tick>throughTick),tailCrops=c.cropLedger.filter(e=>e.tick>throughTick),tailGoods=c.goodsLedger.filter(e=>e.tick>throughTick);
 const prior=c.history;
 // All captures must succeed before the live city is changed.
 const agriculture=captureAgricultureHistory(c,throughTick),typed=captureTypedHistory(c,throughTick);
 const accounts={...prior?.accounts},goodsBalances={...prior?.goodsBalances};
 const goodsTotals=copy(prior?.goodsTotals??{produced:0,imported:0,consumed:0,exported:0});
 const totals=copy(prior?.totals??{moneyCount:0,moneyAmount:0,cropCount:0,cropQuantity:0,goodsCount:0,goodsQuantity:0});
 const lastIncome={...prior?.lastIncome},firstProduction={...prior?.firstProduction};
 let arrivalCount=prior?.arrivalCount??0,taxTotal=prior?.taxTotal??0;
 const daily=new Map((prior?.daily??[]).map(d=>[d.tick,copy(d)]));
 const day=(tick:number)=>{let d=daily.get(tick);if(!d)daily.set(tick,d=blankDay(tick));return d;};
 for(const e of money){
  accounts[e.from]=add(accounts[e.from]??0,-e.amount);accounts[e.to]=add(accounts[e.to]??0,e.amount);
  totals.moneyCount=add(totals.moneyCount,1);totals.moneyAmount=add(totals.moneyAmount,e.amount);
  const d=day(e.tick);d.moneyCount++;d.moneyAmount=add(d.moneyAmount,e.amount);
  if(e.to==='treasury')d.income=add(d.income,e.amount);if(e.from==='treasury')d.expense=add(d.expense,e.amount);
  if(e.reason==='New household arrival savings'){arrivalCount++;lastIncome[e.to]=e.tick;}
  if(/wages/i.test(e.reason))lastIncome[e.to]=e.tick;
  if(e.to==='treasury'&&/tax/i.test(e.reason))taxTotal=add(taxTotal,e.amount);
 }
 for(const e of goods){
  goodsBalances[e.from]=add(goodsBalances[e.from]??0,-e.quantity);goodsBalances[e.to]=add(goodsBalances[e.to]??0,e.quantity);
  totals.goodsCount++;totals.goodsQuantity=add(totals.goodsQuantity,e.quantity);const d=day(e.tick);d.goodsCount++;
  if(e.from==='production'){goodsTotals.produced=add(goodsTotals.produced,e.quantity);if(e.reason==='Daily worker production'||/^Crop recipe #\d+$/.test(e.reason))d.goodsProduced=add(d.goodsProduced,e.quantity);firstProduction[e.to]??=e.tick;}
  if(e.from==='outside'){goodsTotals.imported=add(goodsTotals.imported,e.quantity);if(e.reason==='Imported shop stock')d.goodsImported=add(d.goodsImported,e.quantity);}
  if(e.to==='outside'){goodsTotals.exported=add(goodsTotals.exported,e.quantity);if(e.reason==='Exported goods')d.goodsExported=add(d.goodsExported,e.quantity);}
  if(e.to.startsWith('household:')){goodsTotals.consumed=add(goodsTotals.consumed,e.quantity);if(e.reason==='Household final consumption')d.goodsConsumed=add(d.goodsConsumed,e.quantity);}
 }
 for(const e of crops){totals.cropCount++;totals.cropQuantity=add(totals.cropQuantity,e.quantity);const d=day(e.tick);d.cropCount++;const k=({harvest:'cropsHarvested',process:'cropsProcessed',consumption:'cropsConsumed',writeoff:'cropsWrittenOff',export:'cropsExported'} as const)[e.kind as 'harvest'];if(k)d[k]=add(d[k],e.quantity);}
 // Keep exact sparse structural evidence only while its asset/account is relevant.
 const wallets=new Set([...c.firms.map(f=>f.wallet),...c.households.map(h=>h.wallet),...tailMoney.flatMap(e=>[e.from,e.to]),...tailGoods.flatMap(e=>[e.from,e.to]),...tailCrops.flatMap(e=>[e.from,e.to]),...Object.entries(c.accounts).filter(([,v])=>v!==0).map(([w])=>w)]);
 const ids=new Set([...c.firms.map(f=>f.id),...c.plants.map(p=>p.id),...c.parks.map(p=>p.id),...tailMoney.flatMap(e=>[...e.reason.matchAll(/#(\d+)/g)].map(m=>Number(m[1])))]);
 const structural=(e:Entry)=> e.reason==='Initial municipal grant'||e.reason==='New household arrival savings'&&wallets.has(e.to)||
  /^(?:Build |Demolish park|Self-employed |Market to shop conversion|Business takeover refit|Industry expansion capital|Outside industry (?:bootstrap equity|equity)|Funded industry |Industry expansion residual return)/.test(e.reason)&&
  (wallets.has(e.from)&&e.from.startsWith('firm:')||wallets.has(e.to)&&e.to.startsWith('firm:')||[...e.reason.matchAll(/#(\d+)/g)].some(m=>ids.has(Number(m[1]))));
 const structuralProofs=[...(prior?.structuralProofs??[]),...money].filter(structural);
 for(const [wallet,value] of Object.entries(accounts))if(value===0)delete accounts[wallet];
 for(const [wallet,value] of Object.entries(goodsBalances))if(value===0)delete goodsBalances[wallet];
 for(const wallet of Object.keys(firstProduction))if(!wallets.has(wallet)&&!structuralProofs.some(e=>e.from===wallet))delete firstProduction[wallet];
 const ownerProfit=Object.fromEntries(c.firms.filter(f=>f.owner).map(f=>[f.wallet,captureOwnerProfit(c,f,throughTick)]));
 const latestBasket=copy(prior?.latestBasket??{});
 for(const e of goods)if(e.reason==='Household final consumption'&&(!latestBasket[e.to]||e.tick>latestBasket[e.to].tick))latestBasket[e.to]={commodity:'goods',tick:e.tick,quantity:e.quantity};
 for(const e of crops)if(e.kind==='consumption'&&(!latestBasket[e.to]||e.tick>latestBasket[e.to].tick))latestBasket[e.to]={commodity:'crops',tick:e.tick,quantity:e.quantity};
 const households=new Set(c.households.map(h=>h.wallet));
 for(const key of Object.keys(latestBasket))if(!households.has(key))delete latestBasket[key];
 for(const key of Object.keys(lastIncome))if(!households.has(key))delete lastIncome[key];
 const treasuryMonthEnds=[];
 for(let tick=Math.max(0,throughTick-90);tick<=throughTick;tick+=30){
  if(prior&&tick<prior.throughTick){const old=prior.treasuryMonthEnds.find(p=>p.tick===tick);if(old)treasuryMonthEnds.push({...old});}
  else treasuryMonthEnds.push({tick,balance:(accounts.treasury??0)-money.filter(e=>e.tick>tick).reduce((n,e)=>n+(e.to==='treasury'?e.amount:0)-(e.from==='treasury'?e.amount:0),0)});
 }
 const next:CityHistory={version:1,throughTick,cropOffset:(prior?.cropOffset??0)+crops.length,goodsOffset:(prior?.goodsOffset??0)+goods.length,moneyCount:(prior?.moneyCount??0)+money.length,accounts,goodsBalances,goodsTotals,...agriculture,...typed,latestBasket,lastIncome,firstProduction,ownerProfit,structuralProofs,arrivalCount,taxTotal,treasuryMonthEnds,daily:[...daily.values()].filter(d=>d.tick>c.tick-HISTORY_DAYS).sort((a,b)=>a.tick-b.tick),totals};
 c.history=next;c.ledger=tailMoney;c.cropLedger=tailCrops;c.goodsLedger=tailGoods;
 // A choice before the checkpoint is represented by the latest applicable choice only.
 for(const f of c.firms)for(const key of ['recipeChoices','cropChoices'] as const){const rows=f[key];if(!rows)continue;const before=rows.filter(r=>r.at<=next.cropOffset).at(-1);(f as unknown as Record<string,unknown>)[key]=[...(before?[{...before,at:0}]:[]),...rows.filter(r=>r.at>next.cropOffset)];}
 return true;
}
