/**
 * A chain-3 (v8) save with the goods typing removed: what the same city looked like as v7 /
 * chain-2. Migration tests use it to show that typing is the only change a load makes.
 */
export function untyped(json: string): Record<string, unknown> {
  const city = JSON.parse(json);
  delete city.typeBaseline;
  for (const f of city.firms) { delete f.crops; delete f.products; delete f.recipe; }
  for (const e of city.cropLedger) { delete e.crop; delete e.mix; }
  for (const e of city.goodsLedger) delete e.product;
  return { ...city, version: 7, rulesVersion: 'chain-2' };
}
