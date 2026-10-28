/**
 * A chain-4 (v9) save with the goods typing and the plants removed: what the same city looked
 * like as v7 / chain-2. Migration tests use it to show that typing is the only change a load
 * makes (an old city has no plants; its outside water and power were simply on).
 */
export function untyped(json: string): Record<string, unknown> {
  const city = JSON.parse(json);
  delete city.typeBaseline; delete city.plants; city.utilities = { power: true, water: true };
  for (const f of city.firms) { delete f.crops; delete f.products; delete f.recipe; delete f.cropChoices; delete f.cropMode; }
  for (const e of city.cropLedger) { delete e.crop; delete e.mix; }
  for (const e of city.goodsLedger) delete e.product;
  return { ...city, version: 7, rulesVersion: 'chain-2' };
}
