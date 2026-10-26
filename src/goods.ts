/**
 * The goods catalog (rules chain-3): three farm-to-table lines. A farm grows the crop its land
 * suits, a factory runs one recipe chosen when it opens, shops stock what the city makes, and a
 * household's daily basket rotates through what is on the shelf. Pure data and arithmetic.
 */
export const CROPS = ['rice', 'vegetables', 'sugarcane'] as const;
export const PRODUCTS = ['milled-rice', 'canned-food', 'sugar'] as const;
export const RECIPES = ['rice-mill', 'cannery', 'sugar-mill'] as const;
export type CropId = typeof CROPS[number];
export type ProductId = typeof PRODUCTS[number];
export type RecipeId = typeof RECIPES[number];
export type CropMix = Record<CropId, number>;
export type ProductMix = Record<ProductId, number>;

/** Each recipe turns 2 lots of its crop into 8 units of its product, as the single chain did. */
export const RECIPE: Readonly<Record<RecipeId, { crop: CropId; product: ProductId }>> = Object.freeze({
  'rice-mill': Object.freeze({ crop: 'rice', product: 'milled-rice' }),
  cannery: Object.freeze({ crop: 'vegetables', product: 'canned-food' }),
  'sugar-mill': Object.freeze({ crop: 'sugarcane', product: 'sugar' }),
});
export const recipeForCrop = (crop: CropId): RecipeId => RECIPES.find(r => RECIPE[r].crop === crop)!;

export const CROP_LABELS: Readonly<Record<CropId, string>> = Object.freeze({ rice: 'ข้าว', vegetables: 'ผัก', sugarcane: 'อ้อย' });
export const PRODUCT_LABELS: Readonly<Record<ProductId, string>> = Object.freeze({ 'milled-rice': 'ข้าวสาร', 'canned-food': 'อาหารกระป๋อง', sugar: 'น้ำตาล' });
export const RECIPE_LABELS: Readonly<Record<RecipeId, string>> = Object.freeze({ 'rice-mill': 'โรงสีข้าว', cannery: 'โรงงานอาหารกระป๋อง', 'sugar-mill': 'โรงงานน้ำตาล' });

/** Fertility bands (percent) for each crop; below 50 nothing grows. Equal thirds of 50–100. */
export const CROP_BANDS: Readonly<Record<CropId, readonly [number, number]>> = Object.freeze({ sugarcane: [50, 66], vegetables: [67, 83], rice: [84, 100] });
export function cropForFertility(fertility: number): CropId | null {
  for (const crop of CROPS) { const [lo, hi] = CROP_BANDS[crop]; if (fertility >= lo && fertility <= hi) return crop; }
  return null;
}

export const emptyCrops = (): CropMix => ({ rice: 0, vegetables: 0, sugarcane: 0 });
export const emptyProducts = (): ProductMix => ({ 'milled-rice': 0, 'canned-food': 0, sugar: 0 });
export const mixTotal = (mix: Readonly<Record<string, number>>): number => Object.values(mix).reduce((n, v) => n + v, 0);
const safeCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function validMix(mix: unknown, keys: readonly string[]): boolean {
  return !!mix && typeof mix === 'object' && !Array.isArray(mix) && Object.keys(mix).length === keys.length && keys.every(k => safeCount((mix as Record<string, unknown>)[k]));
}

/**
 * A household's order of preference today: it rotates daily by household so the city buys a
 * mix rather than one product. Deterministic and stateless; no RNG.
 */
export function productPreference(householdId: number, tick: number): ProductId[] {
  const start = (householdId + tick) % PRODUCTS.length;
  return PRODUCTS.map((_, i) => PRODUCTS[(start + i) % PRODUCTS.length]);
}
/** Fresh crops a household buys at a market, in today's order; sugarcane only when nothing else is left. */
export function freshPreference(householdId: number, tick: number): CropId[] {
  return (householdId + tick) % 2 ? ['vegetables', 'rice', 'sugarcane'] : ['rice', 'vegetables', 'sugarcane'];
}
/** Take `quantity` from a mix, largest stock first (ties in catalog order). Returns what was taken. */
export function takeLargest<K extends string>(mix: Record<K, number>, keys: readonly K[], quantity: number): Record<K, number> {
  const taken = Object.fromEntries(keys.map(k => [k, 0])) as Record<K, number>;
  let left = quantity;
  while (left > 0) {
    const k = [...keys].sort((a, b) => mix[b] - taken[b] - (mix[a] - taken[a]) || keys.indexOf(a) - keys.indexOf(b))[0];
    const room = mix[k] - taken[k]; if (room <= 0) break;
    const n = Math.min(room, left); taken[k] += n; left -= n;
  }
  return taken;
}
