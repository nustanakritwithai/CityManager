/** Daily food needs are counted per household member, paid from the household wallet. */
export function dailyFoodDemand(members: number, purchased: number, cash: number, unitPrice: number) {
  if (![members, purchased, cash, unitPrice].every(Number.isSafeInteger) || members < 0 || purchased < 0 || purchased > members || cash < 0 || unitPrice <= 0) {
    throw new RangeError('Invalid household food demand');
  }
  const missing = members - purchased;
  return { required: members, purchased, missing, affordable: Math.min(missing, Math.floor(cash / unitPrice)) };
}

/** Report current-day food purchases, using the physical journals rather than cash estimates. */
export function householdFoodToday(city: import('./sim.ts').City, household: import('./sim.ts').Household) {
  const crops = city.cropLedger.filter(e => e.tick === city.tick && e.kind === 'consumption' && e.to === household.wallet).reduce((sum, e) => sum + e.quantity, 0);
  const goods = city.goodsLedger.filter(e => e.tick === city.tick && e.reason === 'Household final consumption' && e.to === household.wallet).reduce((sum, e) => sum + e.quantity, 0);
  return { required: household.members, purchased: crops + goods, missing: Math.max(0, household.members - crops - goods) };
}
