import { MONTH, summary, type City } from './sim.ts';
import { cityOverview } from './context-data.ts';
import { appendEvent, type CityEvent } from './event-text.ts';

const money = (satang: number) => '฿' + (satang / 100).toLocaleString('th-TH', { maximumFractionDigits: 0 });
const signed = (satang: number) => (satang > 0 ? '+' : satang < 0 ? '−' : '±') + money(Math.abs(satang));
const DEMAND_CAP: Record<'R' | 'C' | 'I' | 'F', number> = { R: 4, C: 2, I: 1, F: 1 };

/**
 * Always-visible city summary, month progress, demand meters on the zone tools and the
 * event log. Read-only; refreshed once per simulated day (or when the city object changes).
 */
export class CityHud {
  private readonly strip = document.querySelector<HTMLElement>('#city-kpis')!;
  private readonly logList = document.querySelector<HTMLElement>('#event-log')!;
  private log: CityEvent[] = [];
  private key = '';
  private lastEvent = '';
  private city: City | null = null;
  private meters = new Map<string, HTMLElement>();

  constructor() {
    for (const zone of ['R', 'C', 'I', 'F'] as const) {
      const button = document.querySelector<HTMLElement>(`[data-tool="${zone}"]`);
      if (!button) continue;
      const meter = document.createElement('span'); meter.className = 'demand-meter'; meter.setAttribute('aria-hidden', 'true');
      // First child: existing CSS styles the label as `.tool>span:last-child`.
      meter.append(document.createElement('i')); button.prepend(meter); this.meters.set(zone, meter);
    }
  }

  get events(): readonly CityEvent[] { return this.log; }

  update(city: City, paused: boolean) {
    if (city !== this.city) { this.city = city; this.log = []; this.lastEvent = ''; }
    if (city.lastEvent && city.lastEvent !== this.lastEvent) { this.lastEvent = city.lastEvent; this.log = appendEvent(this.log, city.tick, city.lastEvent); this.renderLog(); }
    const key = `${city.tick}:${paused}:${city.ledger.length}:${city.buildings.length}:${city.households.length}`;
    if (key === this.key) return;
    this.key = key;
    const s = summary(city), o = cityOverview(city), untilPay = MONTH - city.tick % MONTH;
    const vacancies = Math.max(0, s.jobs - s.employed);
    this.strip.dataset.paused = String(paused);
    this.strip.replaceChildren(
      this.item('treasury', 'เงินคลัง', money(o.treasury), `30 วัน ${signed(o.net)}`, o.net < 0 ? 'bad' : ''),
      this.item('people', 'ประชากร', `${s.population} คน`, `${s.households} ครัวเรือน`),
      this.item('jobs', 'งาน', `ว่าง ${vacancies}`, `ว่างงาน ${s.unemployed} คน`, s.unemployed > 0 ? 'warn' : ''),
      this.item('utilities', 'น้ำ · ไฟ', `${city.utilities.water ? '✓' : '✗'} · ${city.utilities.power ? '✓' : '✗'}`, 'จากภายนอก', city.utilities.water && city.utilities.power ? '' : 'bad'),
      this.item('warnings', 'ควรตรวจ', `${o.warnings.length}`, o.warnings.length ? 'ดูในภาพรวมเมือง' : 'ไม่มี', o.warnings.length ? 'warn' : ''),
      this.month(untilPay, paused),
    );
    for (const [zone, meter] of this.meters) {
      const value = s.demand[zone as keyof typeof DEMAND_CAP];
      meter.style.setProperty('--demand', String(Math.min(1, value / DEMAND_CAP[zone as keyof typeof DEMAND_CAP])));
      meter.dataset.demand = String(value);
    }
  }

  private item(key: string, label: string, value: string, note: string, tone = '') {
    const node = document.createElement('div'); node.className = `kpi ${tone}`; node.dataset.kpi = key;
    const title = document.createElement('span'); title.className = 'kpi-label'; title.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    const small = document.createElement('small'); small.textContent = note;
    node.append(title, strong, small); return node;
  }

  private month(untilPay: number, paused: boolean) {
    const node = document.createElement('div'); node.className = 'kpi kpi-month'; node.dataset.kpi = 'month';
    const title = document.createElement('span'); title.className = 'kpi-label'; title.textContent = paused ? '⏸ หยุดอยู่' : 'ชำระรายเดือน';
    const bar = document.createElement('span'); bar.className = 'kpi-progress'; bar.style.setProperty('--progress', String((MONTH - untilPay) / MONTH));
    const small = document.createElement('small'); small.textContent = `อีก ${untilPay} วัน`;
    node.append(title, bar, small); return node;
  }

  private renderLog() {
    this.logList.replaceChildren(...(this.log.length ? this.log : [{ tick: 0, text: 'ยังไม่มีเหตุการณ์ตั้งแต่เปิดเมืองนี้' }]).map(event => {
      const item = document.createElement('li'), day = document.createElement('small');
      day.textContent = `วันที่ ${event.tick}`; item.append(day, document.createTextNode(event.text)); return item;
    }));
  }
}
