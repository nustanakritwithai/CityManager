/** Optional advanced challenges, derived from the live city without saved progress or rewards. */
import { CROPS, type CropId } from './goods.ts';
import { connectedRoads, MONTH, type City } from './sim.ts';
import { roadLinked, roadNeighborsFor } from './road-topology.ts';

export type CityChallenge = {
  id: 'harvest-variety' | 'processing-variety' | 'household-buyers' | 'road-loops';
  name: string;
  hint: string;
  current: number;
  target: number;
  unit: string;
  done: boolean;
};

/** Independent physical cycles in the gateway's connected component, not one-way driving routes. */
export function connectedRoadLoops(c: City): number {
  const roads = connectedRoads(c);
  if (!roads.size) return 0;
  let edges = 0;
  for (const road of roads) for (const next of roadNeighborsFor(c, road)) {
    if (next > road && roads.has(next) && roadLinked(c, road, next)) edges++;
  }
  return edges - roads.size + 1;
}

/** All 30-day journal windows include today and exclude events exactly 30 days old. */
export function cityChallenges(c: City): CityChallenge[] {
  const since = c.tick - MONTH;
  const recent = (tick: number) => tick > since && tick <= c.tick;
  const harvested = new Set<CropId>(), processed = new Set<CropId>();
  for (const e of c.cropLedger) {
    if (!recent(e.tick) || e.quantity <= 0 || !e.crop || !CROPS.includes(e.crop)) continue;
    if (e.kind === 'harvest') harvested.add(e.crop);
    if (e.kind === 'process') processed.add(e.crop);
  }
  // Only current housed households count; both fresh crops and shop goods are food purchases.
  const residents = new Set(c.households.filter(h => h.home !== null).map(h => h.wallet));
  const buyers = new Set<string>();
  for (const e of c.cropLedger) if (recent(e.tick) && e.kind === 'consumption' && e.quantity > 0 && residents.has(e.to)) buyers.add(e.to);
  for (const e of c.goodsLedger) if (recent(e.tick) && e.reason === 'Household final consumption' && e.quantity > 0 && residents.has(e.to)) buyers.add(e.to);
  const challenges: Omit<CityChallenge, 'done'>[] = [
    { id: 'harvest-variety', name: 'เก็บเกี่ยวพืชครบทุกชนิด', hint: 'ให้ฟาร์มเก็บเกี่ยวข้าว ผัก และอ้อยจริงใน 30 วันล่าสุด', current: harvested.size, target: CROPS.length, unit: 'ชนิด' },
    { id: 'processing-variety', name: 'แปรรูปพืชครบทุกชนิด', hint: 'ให้โรงงานแปรรูปข้าว ผัก และอ้อยจริงใน 30 วันล่าสุด', current: processed.size, target: CROPS.length, unit: 'ชนิด' },
    { id: 'household-buyers', name: 'ตลาดอาหารเพื่อชุมชน', hint: 'ให้ 20 ครัวเรือนที่มีบ้านซื้อพืชสดหรือสินค้าใน 30 วันล่าสุด', current: buyers.size, target: 20, unit: 'ครัวเรือน' },
    { id: 'road-loops', name: 'ขยายถนนให้เป็นวงรอบ', hint: 'สร้างวงถนนอิสระ 2 วงที่เชื่อมถึงประตูเมือง (นับการเชื่อมต่อถนน ไม่ใช่ทิศทางรถ)', current: connectedRoadLoops(c), target: 2, unit: 'วง' },
  ];
  return challenges.map(challenge => ({ ...challenge, done: challenge.current >= challenge.target }));
}
