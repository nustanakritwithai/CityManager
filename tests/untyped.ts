/**
 * A chain-4 (v9) save with the goods typing and the plants removed: what the same city looked
 * like as v7 / chain-2. Migration tests use it to show that typing is the only change a load
 * makes (an old city has no plants; its outside water and power were simply on).
 */
export function untyped(json: string): Record<string, unknown> {
  const city = JSON.parse(json);
  // Only an untouched historical migration may be projected back to the frozen v7 schema.
  // Never erase a unified-runtime boundary from a newly simulated city.
  if (city.commercialUnifiedStartTick !== undefined) {
    const baseline=city.commercialUnifiedBaseline;
    if (city.commercialUnifiedStartTick !== city.tick || !baseline ||
        baseline.moneyEntries !== (city.history?.moneyCount ?? 0)+city.ledger.length ||
        baseline.cropEntries !== (city.history?.cropOffset ?? 0)+city.cropLedger.length ||
        baseline.goodsEntries !== (city.history?.goodsOffset ?? 0)+city.goodsLedger.length) throw Error('Only untouched pre-unification history can form a v7 fixture');
    delete city.commercialUnifiedStartTick; delete city.commercialUnifiedBaseline; delete city.commercialBaseVersion;
  }
  delete city.factoryProgressionStartTick; delete city.farmLevelStartTick; delete city.parks; delete city.foodDemandStartTick; delete city.typeBaseline; delete city.plants; city.utilities = { power: true, water: true };
  for (const f of city.firms) { delete f.crops; delete f.products; delete f.recipe; delete f.recipeMode; delete f.recipeChoices; delete f.cropChoices; delete f.cropMode; }
  for (const e of city.cropLedger) { delete e.crop; delete e.mix; }
  for (const e of city.goodsLedger) delete e.product;
  return { ...city, version: 7, rulesVersion: 'chain-2' };
}
