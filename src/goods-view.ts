/** Thai names and stock lines for the goods catalog, shared by the place cards, HUD and maps. */
import { farmCrop, isMarket, isRetail, type City, type Firm } from './sim.ts';
import { CROPS, CROP_LABELS, PRODUCTS, PRODUCT_LABELS, RECIPE, RECIPE_LABELS } from './goods.ts';

/** "ฟาร์มข้าว", "โรงสีข้าว", "ตลาดพืชผล", "ร้านค้า". */
export function firmGoodsName(city: City, firm: Firm): string {
  if (firm.zone === 'F') return `ฟาร์ม${CROP_LABELS[farmCrop(city, firm)]}`;
  if (firm.zone === 'I') return firm.recipe ? RECIPE_LABELS[firm.recipe] : 'โรงงาน';
  return isMarket(firm) ? 'ตลาดพืชผล' : 'ร้านค้า';
}
/** One line of what this business grows, makes or holds, e.g. "ข้าว → ข้าวสาร" or "ข้าวสาร 6 · น้ำตาล 2". */
export function firmGoodsLine(city: City, firm: Firm): string {
  if (firm.zone === 'F') return `ปลูก${CROP_LABELS[farmCrop(city, firm)]} · คลัง ${CROPS.filter(k => firm.crops[k] > 0).map(k => `${CROP_LABELS[k]} ${firm.crops[k]}`).join(' · ') || 'ว่าง'} ล็อต`;
  if (firm.zone === 'I' && firm.recipe) { const r = RECIPE[firm.recipe]; return `${CROP_LABELS[r.crop]} ${firm.cropInventory} → ${PRODUCT_LABELS[r.product]} ${firm.inventory}`; }
  const parts = isRetail(firm) ? PRODUCTS.filter(p => firm.products[p] > 0).map(p => `${PRODUCT_LABELS[p]} ${firm.products[p]}`) : CROPS.filter(k => firm.crops[k] > 0).map(k => `${CROP_LABELS[k]} ${firm.crops[k]}`);
  return parts.length ? parts.join(' · ') : isRetail(firm) ? 'ชั้นวางว่าง' : 'ยังไม่มีพืชผล';
}
