import type { Entry } from './sim.ts';
import type { CropMix, ProductMix } from './goods.ts';

/** Exact sufficient state before the retained journal suffix. No market journal is compacted. */
export type HistoryOwnerFinance = {
  contributed: number; withdrawn: number; taxPaid: number; cash: number; profit: number;
};
export type HistoryOwnerProfit = {
  profit: number; tax: number; invested: number; retained: number;
};
export type HistoryDay = {
  tick: number; moneyCount: number; moneyAmount: number; cropCount: number; goodsCount: number;
  income: number; expense: number;
  cropsHarvested: number; cropsProcessed: number; cropsConsumed: number; cropsWrittenOff: number; cropsExported: number;
  goodsProduced: number; goodsConsumed: number; goodsExported: number; goodsImported: number;
};
export type CityHistory = {
  version: 1;
  /** Inclusive, completed accounting month. Every retained event is strictly later. */
  throughTick: number;
  cropOffset: number; goodsOffset: number; moneyCount: number;
  accounts: Record<string, number>;
  goodsBalances: Record<string, number>;
  goodsTotals: { produced: number; imported: number; consumed: number; exported: number };
  cropTotals: { harvested: number; processed: number; consumed: number; writtenOff: number; exported: number };
  cropHoldings: Record<string, { quantity: number; value: number }>;
  typedCrops: Record<string, CropMix>; typedProducts: Record<string, ProductMix>;
  latestPurchase: Record<string, number>;
  latestBasket: Record<string, {commodity:'goods'|'crops';tick:number;quantity:number}>;
  lastIncome: Record<string, number>;
  roles: Record<string, 'F'|'T'|'I'>;
  farmMinimumLevels: Record<string, number>;
  ownerFinance: Record<string, HistoryOwnerFinance>;
  ownerProfit: Record<string, HistoryOwnerProfit>;
  /** Original sparse evidence still needed by extant assets or unsettled estates. */
  structuralProofs: Entry[];
  firstProduction: Record<string, number>;
  arrivalCount: number;
  taxTotal: number;
  treasuryMonthEnds: {tick:number;balance:number}[];
  daily: HistoryDay[];
  totals: { moneyCount: number; moneyAmount: number; cropCount: number; cropQuantity: number; goodsCount: number; goodsQuantity: number };
};
