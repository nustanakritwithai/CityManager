import type { CityHistory } from './city-history-types.ts';
/**
 * Typed-stock checks for rules chain-3. Totals (crop lots, finished goods) are already replayed
 * by the save validators; this layer replays each crop and product after the `typeBaseline` entries,
 * so every firm's mix is the sum of its typed journal, farms hold only their land's crop and a
 * factory only its recipe's crop and product.
 */
import { farmCrop, isMarket, isRetail, type City } from './sim.ts';
import { CROPS, PRODUCTS, RECIPE, RECIPES, emptyCrops, emptyProducts, mixTotal, recipeForCrop, validMix, type CropId, type CropMix, type ProductId, type ProductMix } from './goods.ts';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function validateTypes(c: City): void { replayTypes(c); }
type TypedSeed = Pick<CityHistory, 'typedCrops'|'typedProducts'>;
export function captureTypedHistory(c: City, throughTick: number): TypedSeed {
  validateTypes(c);
  if (!count(throughTick) || throughTick % 30 !== 0 || throughTick < (c.history?.throughTick ?? c.typeBaseline.tick) || throughTick > c.tick) throw new Error('Invalid typed history cutoff.');
  return replayTypes(c, throughTick)!;
}
function replayTypes(c: City, captureTick?: number): TypedSeed | undefined {
  const history = c.history, cropOffset = history?.cropOffset ?? 0, goodsOffset = history?.goodsOffset ?? 0;
  const fail = (): never => { throw new Error('Unsupported or corrupt CityManager save (goods types do not reconcile).'); };
  const b = c.typeBaseline;
  if (!record(b) || !count(b.tick) || b.tick > c.tick || !count(b.cropEntries) || b.cropEntries > cropOffset + c.cropLedger.length || !count(b.goodsEntries) || b.goodsEntries > goodsOffset + c.goodsLedger.length || !record(b.crops) || !record(b.products) || Object.keys(b).length !== 5) fail();
  for (const [wallet, mix] of Object.entries(b.crops)) if (!/^firm:[1-9]\d*$/.test(wallet) || !validMix(mix, CROPS)) fail();
  for (const [wallet, mix] of Object.entries(b.products)) if (!/^firm:[1-9]\d*$/.test(wallet) || !validMix(mix, PRODUCTS)) fail();
  const firms = new Map(c.firms.map(f => [f.wallet, f]));
  for (const f of c.firms) {
    if (!validMix(f.crops, CROPS) || mixTotal(f.crops) !== f.cropInventory || !validMix(f.products, PRODUCTS) || mixTotal(f.products) !== f.inventory) fail();
    if (f.zone === 'I' ? !RECIPES.includes(f.recipe!) : f.recipe !== undefined) fail();
    if (f.recipeMode !== undefined && (f.zone !== 'I' || !['auto', 'manual'].includes(f.recipeMode))) fail();
    if (f.recipeChoices !== undefined) {
      if (f.zone !== 'I' || !Array.isArray(f.recipeChoices) || f.recipeChoices.length < (history ? 1 : 2) || f.recipeChoices[0]?.at !== 0 || f.recipeChoices.at(-1)?.recipe !== f.recipe) fail();
      let last = -1;
      for (const choice of f.recipeChoices) { if (!record(choice) || Object.keys(choice).length !== 2 || !count(choice.at) || choice.at < last || choice.at > cropOffset + c.cropLedger.length || !RECIPES.includes(choice.recipe)) fail(); last = choice.at; }
    }
    if (f.cropMode !== undefined && (f.zone !== 'F' || (f.cropMode !== 'auto' && f.cropMode !== 'manual'))) fail();
    if (f.cropChoices !== undefined) {
      if (f.zone !== 'F' || !Array.isArray(f.cropChoices) || f.cropChoices.length === 0) fail();
      let last = -1;
      for (const choice of f.cropChoices) {
        if (!record(choice) || Object.keys(choice).length !== 2 || !count(choice.at) || choice.at < last || choice.at > cropOffset + c.cropLedger.length || !CROPS.includes(choice.crop)) fail();
        last = choice.at;
      }
    }
    if (f.zone === 'I' && !f.recipeChoices && (CROPS.some(k => k !== RECIPE[f.recipe!].crop && f.crops[k] > 0) || PRODUCTS.some(p => p !== RECIPE[f.recipe!].product && f.products[p] > 0))) fail();
    if (!isMarket(f) && !isRetail(f) && f.zone === 'C') fail();
  }

  // Crops, from the baseline forward.
  const crops = new Map<string, CropMix>(Object.entries(history?.typedCrops ?? b.crops).map(([w, m]) => [w, { ...m }]));
  const cropsOf = (w: string) => { let h = crops.get(w); if (!h) crops.set(w, h = emptyCrops()); return h; };
  const recipeCrop = new Map<string, CropId>();
  for (const [localIndex, e] of c.cropLedger.entries()) {
    const i = cropOffset + localIndex;
    if (captureTick !== undefined && e.tick > captureTick) break;
    if (i < b.cropEntries) { if (e.crop !== undefined || e.mix !== undefined || e.tick > b.tick) fail(); continue; }
    if (e.kind === 'writeoff') {
      if (e.crop !== undefined || !validMix(e.mix, CROPS) || mixTotal(e.mix!) !== e.quantity) fail();
      const h = cropsOf(e.from); if (CROPS.some(k => h[k] !== e.mix![k])) fail();
      crops.set(e.from, emptyCrops()); continue;
    }
    if (!CROPS.includes(e.crop!) || e.mix !== undefined) fail();
    const crop = e.crop!, now = (w: string) => firms.get(w);
    const take = (w: string) => { const h = cropsOf(w); if (h[crop] < e.quantity) fail(); h[crop] -= e.quantity; };
    const give = (w: string) => { cropsOf(w)[crop] += e.quantity; };
    const grows = (w: string) => { const f = now(w); if (f && f.zone === 'F') { const selected = [...(f.cropChoices ?? [])].reverse().find(choice => choice.at <= i)?.crop ?? farmCrop(c, { building: f.building }); if (selected !== crop) fail(); } };
    const mills = (w: string) => { const f = now(w); if (f && f.zone === 'I') { const recipe = [...(f.recipeChoices ?? [])].reverse().find(choice => choice.at <= i)?.recipe ?? f.recipe!; if (RECIPE[recipe].crop !== crop) fail(); } };
    if (e.kind === 'harvest') { grows(e.to); give(e.to); }
    else if (e.kind === 'trade') { take(e.from); mills(e.to); give(e.to); }
    else if (e.kind === 'consumption') take(e.from);
    else if (e.kind === 'export') { take(e.from); }
    else if (e.kind === 'process') { mills(e.from); take(e.from); recipeCrop.set(e.reason, crop); }
    else if (e.kind === 'market-deposit') { if (e.from !== 'market-server') take(e.from); }
    else if (e.kind === 'market-refund' || e.kind === 'market-receipt') { if (e.to.startsWith('firm:')) give(e.to); }
    else fail();
  }
  if (captureTick === undefined) for (const [wallet, h] of crops) { if (wallet === 'market-server') continue; const f = firms.get(wallet); if (CROPS.some(k => (f ? f.crops[k] : 0) !== h[k])) fail(); }
  if (captureTick === undefined) for (const f of c.firms) { const h = crops.get(f.wallet) ?? emptyCrops(); if (CROPS.some(k => f.crops[k] !== h[k])) fail(); }

  // Finished goods, from the baseline forward; a recipe's output is that recipe's product.
  const products = new Map<string, ProductMix>(Object.entries(history?.typedProducts ?? b.products).map(([w, m]) => [w, { ...m }]));
  const productsOf = (w: string) => { let h = products.get(w); if (!h) products.set(w, h = emptyProducts()); return h; };
  for (const [localIndex, e] of c.goodsLedger.entries()) {
    const i = goodsOffset + localIndex;
    if (captureTick !== undefined && e.tick > captureTick) continue;
    if (i < b.goodsEntries) { if (e.product !== undefined || e.tick > b.tick) fail(); continue; }
    if (!PRODUCTS.includes(e.product!)) fail();
    const product = e.product as ProductId, made = recipeCrop.get(e.reason);
    if (e.from === 'production' && (!made || RECIPE[recipeForCrop(made)].product !== product)) fail();
    if (e.from.startsWith('firm:')) { const h = productsOf(e.from); if (h[product] < e.quantity) fail(); h[product] -= e.quantity; }
    if (e.to.startsWith('firm:')) productsOf(e.to)[product] += e.quantity;
  }
  if (captureTick !== undefined) {
    const needed = new Set([...c.firms.map(f => f.wallet), ...c.cropLedger.filter(e => e.tick > captureTick).flatMap(e => [e.from,e.to]), ...c.goodsLedger.filter(e => e.tick > captureTick).flatMap(e => [e.from,e.to])]);
    for (const [w,m] of crops) if (!needed.has(w) && mixTotal(m) === 0) crops.delete(w);
    for (const [w,m] of products) if (!needed.has(w) && mixTotal(m) === 0) products.delete(w);
    return { typedCrops: Object.fromEntries(crops), typedProducts: Object.fromEntries(products) };
  }
  for (const [wallet, h] of products) { if (wallet === 'market-server') continue; const f = firms.get(wallet); if (PRODUCTS.some(p => (f ? f.products[p] : 0) !== h[p])) fail(); }
  for (const f of c.firms) { const h = products.get(f.wallet) ?? emptyProducts(); if (PRODUCTS.some(p => f.products[p] !== h[p])) fail(); }
}
