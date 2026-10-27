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

export function validateTypes(c: City): void {
  const fail = (): never => { throw new Error('Unsupported or corrupt CityManager save (goods types do not reconcile).'); };
  const b = c.typeBaseline;
  if (!record(b) || !count(b.tick) || b.tick > c.tick || !count(b.cropEntries) || b.cropEntries > c.cropLedger.length || !count(b.goodsEntries) || b.goodsEntries > c.goodsLedger.length || !record(b.crops) || !record(b.products) || Object.keys(b).length !== 5) fail();
  for (const [wallet, mix] of Object.entries(b.crops)) if (!/^firm:[1-9]\d*$/.test(wallet) || !validMix(mix, CROPS)) fail();
  for (const [wallet, mix] of Object.entries(b.products)) if (!/^firm:[1-9]\d*$/.test(wallet) || !validMix(mix, PRODUCTS)) fail();
  const firms = new Map(c.firms.map(f => [f.wallet, f]));
  for (const f of c.firms) {
    if (!validMix(f.crops, CROPS) || mixTotal(f.crops) !== f.cropInventory || !validMix(f.products, PRODUCTS) || mixTotal(f.products) !== f.inventory) fail();
    if (f.zone === 'I' ? !RECIPES.includes(f.recipe!) : f.recipe !== undefined) fail();
    const onlyCrop: CropId | null = f.zone === 'F' ? farmCrop(c, f) : f.zone === 'I' ? RECIPE[f.recipe!].crop : null;
    if (onlyCrop && CROPS.some(k => k !== onlyCrop && f.crops[k] > 0)) fail();
    if (f.zone === 'I' && PRODUCTS.some(p => p !== RECIPE[f.recipe!].product && f.products[p] > 0)) fail();
    if (!isMarket(f) && !isRetail(f) && f.zone === 'C') fail();
  }

  // Crops, from the baseline forward.
  const crops = new Map<string, CropMix>(Object.entries(b.crops).map(([w, m]) => [w, { ...m }]));
  const cropsOf = (w: string) => { let h = crops.get(w); if (!h) crops.set(w, h = emptyCrops()); return h; };
  const recipeCrop = new Map<string, CropId>();
  for (const [i, e] of c.cropLedger.entries()) {
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
    const grows = (w: string) => { const f = now(w); if (f && f.zone === 'F' && farmCrop(c, f) !== crop) fail(); };
    const mills = (w: string) => { const f = now(w); if (f && f.zone === 'I' && RECIPE[f.recipe!].crop !== crop) fail(); };
    if (e.kind === 'harvest') { grows(e.to); give(e.to); }
    else if (e.kind === 'trade') { grows(e.from); take(e.from); mills(e.to); give(e.to); }
    else if (e.kind === 'consumption') take(e.from);
    else if (e.kind === 'export') { grows(e.from); take(e.from); }
    else if (e.kind === 'process') { mills(e.from); take(e.from); recipeCrop.set(e.reason, crop); }
    else if (e.kind === 'market-deposit' || e.kind === 'market-refund') { take(e.from); give(e.to); }
    else if (e.kind === 'market-receipt') { give(e.to); }
    else fail();
  }
  for (const [wallet, h] of crops) { if (wallet === 'market-server') continue; const f = firms.get(wallet); if (CROPS.some(k => (f ? f.crops[k] : 0) !== h[k])) fail(); }
  for (const f of c.firms) { const h = crops.get(f.wallet) ?? emptyCrops(); if (CROPS.some(k => f.crops[k] !== h[k])) fail(); }

  // Finished goods, from the baseline forward; a recipe's output is that recipe's product.
  const products = new Map<string, ProductMix>(Object.entries(b.products).map(([w, m]) => [w, { ...m }]));
  const productsOf = (w: string) => { let h = products.get(w); if (!h) products.set(w, h = emptyProducts()); return h; };
  for (const [i, e] of c.goodsLedger.entries()) {
    if (i < b.goodsEntries) { if (e.product !== undefined || e.tick > b.tick) fail(); continue; }
    if (!PRODUCTS.includes(e.product!)) fail();
    const product = e.product as ProductId, made = recipeCrop.get(e.reason);
    if (e.from === 'production' && (!made || RECIPE[recipeForCrop(made)].product !== product)) fail();
    if (e.from.startsWith('firm:')) { const h = productsOf(e.from); if (h[product] < e.quantity) fail(); h[product] -= e.quantity; }
    if (e.to.startsWith('firm:')) productsOf(e.to)[product] += e.quantity;
  }
  for (const [wallet, h] of products) { const f = firms.get(wallet); if (PRODUCTS.some(p => (f ? f.products[p] : 0) !== h[p])) fail(); }
  for (const f of c.firms) { const h = products.get(f.wallet) ?? emptyProducts(); if (PRODUCTS.some(p => f.products[p] !== h[p])) fail(); }
}
