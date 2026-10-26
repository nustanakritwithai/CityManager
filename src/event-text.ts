/**
 * Thai text for the simulator's English action results and `lastEvent` strings.
 * Presentation only: the simulator keeps its messages; unknown text is shown unchanged.
 */
import { CROP_LABELS, RECIPE_LABELS, type CropId, type RecipeId } from './goods.ts';
const ZONES: Record<string, string> = { R: 'บ้าน', C: 'พาณิชย์', I: 'โรงงาน', F: 'ฟาร์ม' };
const zone = (z: string) => ZONES[z] ?? z;

const RULES: readonly [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Built (\d+) road cells\.$/, m => `สร้างถนน ${m[1]} ช่องแล้ว`],
  [/^Road built, but disconnected from the west outside gateway\./, () => 'สร้างถนนแล้ว แต่ยังไม่เชื่อมประตูเมืองฝั่งตะวันตก โซนข้างถนนนี้จะยังไม่โต'],
  [/^Road already exists; no charge\.$/, () => 'มีถนนอยู่แล้ว ไม่เสียเงิน'],
  [/^Need (\d+) credits for this road\.$/, m => `เงินคลังไม่พอ ถนนนี้ต้องใช้ ${m[1]} ฿`],
  [/^A building blocks this road\./, () => 'มีอาคารขวางทาง ต้องรื้อก่อนจึงสร้างถนนได้'],
  [/^Road is outside the bounded map\.$/, () => 'ถนนอยู่นอกแผนที่'],
  [/^Zone cleared\.$/, () => 'ล้างโซนแล้ว'],
  [/^([RCIF]) zone marked\. Growth is evaluated every 3 days\.$/, m => `วางโซน${zone(m[1])}แล้ว ระบบทบทวนการเติบโตทุก 3 วัน`],
  [/^([RCIF]) zone marked, but no connected road frontage\./, m => `วางโซน${zone(m[1])}แล้ว แต่ยังไม่มีถนนข้างแปลงที่เชื่อมประตูเมือง`],
  [/^Road cells cannot be zoned\.$/, () => 'ถนนวางโซนไม่ได้'],
  [/^Bulldoze the existing building before rezoning\.$/, () => 'ต้องรื้ออาคารเดิมก่อนเปลี่ยนโซน'],
  [/^Farm needs fertility (\d+)% or more; parcel fertility (\d+)%\.$/, m => `ฟาร์มต้องมีความอุดมสมบูรณ์อย่างน้อย ${m[1]}% แปลงนี้มี ${m[2]}%`],
  [/^Invalid parcel or zone\.$/, () => 'แปลงหรือโซนไม่ถูกต้อง'],
  [/^Outside the map\.$/, () => 'อยู่นอกแผนที่'],
  [/^The outside gateway is reserved\.$/, () => 'ประตูเมืองรื้อไม่ได้'],
  [/^Need 20 credits for demolition\.$/, () => 'เงินคลังไม่พอค่ารื้อ 20 ฿'],
  [/^Closure needs enough cash to settle earned wages and current profit tax/, () => 'ปิดกิจการไม่ได้ เงินไม่พอจ่ายค่าจ้างและภาษีที่ค้าง ยังไม่เสียค่ารื้อ'],
  [/^Crop disposal could not be journaled/, () => 'บันทึกการตัดพืชผลไม่ได้ กิจการและเมืองยังคงเดิม'],
  [/^Parcel cleared\./, () => 'รื้อแล้ว อาคารที่ขาดถนนเชื่อมจะหยุดรับคน ค้าขาย และเติบโต'],
  [/^([RCIF]) building #(\d+) grew:.*?(?:Recipe: ([a-z-]+)\.|Crop: ([a-z]+)\.)?$/, m => `${m[3] ? RECIPE_LABELS[m[3] as RecipeId] ?? zone(m[1]) : m[4] ? `ฟาร์ม${CROP_LABELS[m[4] as CropId] ?? ''}` : zone(m[1])} #${m[2]} สร้างเสร็จ ผ่านเงื่อนไขถนน น้ำไฟ ความต้องการ และค่าเช่า`],
  [/^Household #(\d+) arrived with (\d+) members and (\d+) workforce;(.*)$/, m => `ครัวเรือน #${m[1]} ย้ายเข้า ${m[2]} คน แรงงาน ${m[3]} คน${/bootstrap/.test(m[4]) ? ' (สิทธิเริ่มเมือง)' : ''}`],
  [/^Market #(\d+) became a shop:/, m => `ตลาด #${m[1]} ยกระดับเป็นร้านค้าแล้ว เจ้าของจ่ายค่าปรับปรุงจากกำไรของแผงเองและยังยืนร้านต่อ`],
  [/^Empty map: only the outside gateway exists\./, () => 'แผนที่ว่าง มีแค่ประตูเมือง · ต่อถนนจากประตูก่อน แล้ววางโซนข้างถนน'],
  [/^Month settled:[^.]*\.?(?: (\d+) idle specialist[^.]*\.)?(?: (\d+) household\(s\) left[^.]*\.)?/, m => 'ชำระรายเดือนแล้ว ค่าจ้าง ค่าเช่า และภาษีอยู่ในบัญชีเงิน'
    + (m[1] ? ` · แรงงาน ${m[1]} คนเปลี่ยนอาชีพเป็นแรงงานทั่วไป เพราะสายงานเดิมไม่มีตำแหน่งว่าง` : '')
    + (m[2] ? ` · ${m[2]} ครัวเรือนย้ายออกจากเมือง หลังไม่มีงานที่ได้ค่าจ้าง 2 เดือน เงินออมติดตัวไปด้วย` : '')],
  [/^Starter road and zones are funded by the recorded grant\./, () => 'รับทุนตั้งเมืองแล้ว กดเล่นเพื่อดูการทบทวนการเติบโตทุก 3 วัน'],
  [/^Entity ID range exhausted/, () => 'รหัสข้อมูลเต็ม ระบบไม่สร้างอาคารหรือครัวเรือนใหม่'],
  [/^Owner capital contribution rejected/, () => 'เติมทุนไม่ได้ เงินและสถานะเดิมไม่เปลี่ยน'],
  [/^Owner profit withdrawal rejected/, () => 'ถอนกำไรไม่ได้ ต้องเหลือกำไร ภาษี และเงินหมุนเวียนพอ'],
  [/^Household moved with the same identity/, () => 'ย้ายครัวเรือนแล้ว ข้อมูลเดิมครบ'],
  [/^Household already lives here/, () => 'ครัวเรือนอยู่บ้านนี้แล้ว'],
  [/^Destination needs a later daily tick/, () => 'บ้านปลายทางต้องรออีกวัน และต้องมีถนน น้ำ ไฟ'],
  [/^Destination lacks household slots/, () => 'บ้านปลายทางไม่มีที่ว่างพอ'],
  [/^Household or destination home does not exist\.$/, () => 'ไม่พบครัวเรือนหรือบ้านปลายทาง'],
];

export function thaiMessage(text: string): string {
  for (const [pattern, render] of RULES) { const match = text.match(pattern); if (match) return render(match); }
  return text;
}

/** Events worth a log line: the simulator's own lastEvent, not every action echo. */
export type CityEvent = { tick: number; text: string };
export const EVENT_LOG_LIMIT = 30;
export function appendEvent(log: readonly CityEvent[], tick: number, raw: string): CityEvent[] {
  const text = thaiMessage(raw);
  if (log.length && log[0].text === text && log[0].tick === tick) return [...log];
  return [{ tick, text }, ...log].slice(0, EVENT_LOG_LIMIT);
}
