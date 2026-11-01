/** Thai names and stock lines for the goods catalog, shared by the place cards, HUD and maps. */
import { farmCrop, type City, type Firm } from './sim.ts';
import { commercialPresentation } from './commercial-visuals.ts';
import { CROPS, CROP_LABELS, PRODUCTS, PRODUCT_LABELS, RECIPE, RECIPE_LABELS } from './goods.ts';

/** Product-specific production names; commercial architecture follows the shared level. */
export function firmGoodsName(city: City, firm: Firm): string {
  if (firm.zone === 'F') return `ฟาร์ม${CROP_LABELS[farmCrop(city, firm)]}`;
  if (firm.zone === 'I') return firm.recipe ? RECIPE_LABELS[firm.recipe] : 'โรงงาน';
  const building = city.buildings.find(b => b.id === firm.building);
  return building ? commercialPresentation(building.level).title : 'พาณิชย์';
}
/** One line of what this business grows, makes or holds, e.g. "ข้าว → ข้าวสาร" or "ข้าวสาร 6 · น้ำตาล 2". */
export function firmGoodsLine(city: City, firm: Firm): string {
  if (firm.zone === 'F') return `ปลูก${CROP_LABELS[farmCrop(city, firm)]} · คลัง ${CROPS.filter(k => firm.crops[k] > 0).map(k => `${CROP_LABELS[k]} ${firm.crops[k]}`).join(' · ') || 'ว่าง'} ล็อต`;
  if (firm.zone === 'I' && firm.recipe) { const r = RECIPE[firm.recipe]; return `${CROP_LABELS[r.crop]} ${firm.crops[r.crop]} → ${PRODUCT_LABELS[r.product]} ${firm.products[r.product]}`; }
  const crops = CROPS.filter(k => firm.crops[k] > 0).map(k => `${CROP_LABELS[k]} ${firm.crops[k]}`);
  const products = PRODUCTS.filter(p => firm.products[p] > 0).map(p => `${PRODUCT_LABELS[p]} ${firm.products[p]}`);
  return `พืชผล: ${crops.join(' · ') || 'ว่าง'} · สินค้าสำเร็จรูป: ${products.join(' · ') || 'ว่าง'}`;
}
