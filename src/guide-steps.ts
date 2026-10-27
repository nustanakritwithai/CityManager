/**
 * The guided first game: nine steps from an empty map to a working supply chain, each one read
 * from the city itself, so a reload or a loaded save lands on the right step. Read-only over City.
 */
import { GATEWAY, access, connectedRoads, type City, type Zone } from './sim.ts';
import { cityGoals } from './city-goals.ts';

export type GuideTool = 'road' | Zone | 'play' | 'power' | 'water' | null;
export type GuideStep = { id: string; title: string; text: string; tool: GuideTool; progress: [number, number] };
export type GuideState = { index: number; total: number; step: GuideStep | null };

const zoned = (c: City, zone: Zone) => c.cells.filter((cell, i) => cell.zone === zone && access(c, i)).length;

export function guideSteps(c: City): (GuideStep & { done: boolean })[] {
  const roads = [...connectedRoads(c)].filter(i => i !== GATEWAY).length;
  const level = cityGoals(c).level, homes = zoned(c, 'R'), shops = zoned(c, 'C');
  const step = (id: string, title: string, text: string, tool: GuideTool, have: number, need: number) =>
    ({ id, title, text, tool, progress: [Math.min(have, need), need] as [number, number], done: have >= need });
  return [
    step('road', 'ต่อถนนจากประตูเมือง', 'เลือกถนน แล้วลากจากประตูสีเหลืองออกไปอย่างน้อย 6 ช่อง ทุกอาคารต้องติดถนนที่เชื่อมถึงประตู', 'road', roads, 6),
    step('homes', 'วางโซนบ้าน 4 แปลง', 'เลือกบ้าน แล้วแตะแปลงที่ติดถนน ครัวเรือนจะย้ายเข้ามาเมื่อมีบ้านว่าง', 'R', homes, 4),
    step('farm', 'วางฟาร์ม 1 แปลง', 'เลือกฟาร์ม แผนที่จะแสดงสีตามพืชที่ดินปลูกได้: เหลือง = ข้าว เขียว = ผัก ฟ้า = อ้อย วางบนแปลงที่ติดถนน ฟาร์มต่างพืชทำให้เมืองมีสินค้าหลายอย่าง', 'F', zoned(c, 'F'), 1),
    step('factory', 'วางโรงงาน 1 แปลง', 'เลือกโรงงาน แล้ววางข้างถนน โรงงานแปรรูปพืชผลจากฟาร์มเป็นสินค้า', 'I', zoned(c, 'I'), 1),
    step('commerce', 'วางพาณิชย์ 2 แปลง', 'เลือกพาณิชย์ แล้ววางข้างถนน 2 แปลง แปลงแรกเป็นตลาดขายพืชผล ต่อมาเป็นร้านขายสินค้าจากโรงงาน', 'C', shops, 2),
    step('play', 'กดเล่นแล้วรอครัวเรือนแรก', 'กดเล่น ▶ (หรือ Space) อาคารเกิดทุก 3 วันเมื่อผ่านเงื่อนไข ครัวเรือนแรกจะย้ายเข้าบ้านใหม่', 'play', c.households.filter(h => h.home !== null).length, 1),
    step('chain', 'รอห่วงโซ่สินค้าทำงาน', 'ฟาร์มเก็บเกี่ยว โรงงานแปรรูป แล้วร้านขายสินค้าในเมือง เร่งเวลา 3× ได้ ป้ายระดับใต้ชื่อเกมจะขึ้นถึงระดับ 3', 'play', level, 3),
    step('grow', 'ขยายเมือง: บ้าน 6 แปลง โรงงาน 2 แปลง', 'เมืองระดับ 4 ต้องมีคน 20 คนและงานพอ เพิ่มบ้านให้ครบ 6 แปลงและโรงงานให้ครบ 2 แปลงข้างถนน', homes < 6 ? 'R' : 'I', Math.min(homes, 6) + Math.min(zoned(c, 'I'), 2), 8),
    step('utilities', 'สร้างโรงไฟฟ้าและโรงสูบน้ำ', 'ประตูเมืองจ่ายน้ำและไฟได้จำกัด เมืองโตต่อต้องมีโรงของตัวเอง เลือกไฟฟ้า (5) แล้ววางแปลงว่างริมถนน ตามด้วยประปา (6) น้ำไฟวิ่งไปตามถนน อาคารใกล้แหล่งจ่ายได้ก่อน', c.plants.some(p => p.kind === 'power') ? 'water' : 'power', (['power', 'water'] as const).filter(k => c.plants.some(p => p.kind === k)).length, 2),
  ];
}

/** The first step not yet done; `step` is null once the whole guide is complete. */
export function guideState(c: City): GuideState {
  const steps = guideSteps(c), index = steps.findIndex(s => !s.done);
  if (index < 0) return { index: steps.length, total: steps.length, step: null };
  const { done: _, ...step } = steps[index];
  return { index, total: steps.length, step };
}
