import { MONTH, summary, type City } from './sim.ts';
import { cityOverview } from './context-data.ts';
import { appendEvent, type CityEvent } from './event-text.ts';
import { buildingIssues } from './map-overlay.ts';

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
  private readonly issueList = document.querySelector<HTMLElement>('#issue-list')!;
  private readonly issueCount = document.querySelector<HTMLElement>('#issue-count')!;
  private log: CityEvent[] = [];
  private key = '';
  private lastEvent = '';
  private city: City | null = null;
  private meters = new Map<string, HTMLElement>();
  private issueKey = '';

  /** `onIssue` opens the building and centres the camera on it. */
  constructor(private readonly onIssue: (cell: number, buildingId: number) => void = () => {}, private readonly onWarnings: () => void = () => {}) {
    this.strip.addEventListener('click', e => { if ((e.target as Element).closest('[data-kpi=warnings]')) this.onWarnings(); });
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
    const vacancies = Math.max(0, s.jobs - s.employed), issues = buildingIssues(city);
    this.renderIssues(city, issues);
    this.strip.dataset.paused = String(paused);
    this.strip.replaceChildren(
      this.item('treasury', 'เงินคลัง', money(o.treasury), `30 วัน ${signed(o.net)}`, o.net < 0 ? 'bad' : ''),
      this.item('people', 'ประชากร', `${s.population} คน`, `${s.households} ครัวเรือน`),
      this.item('jobs', 'งาน', `ว่าง ${vacancies}`, `ว่างงาน ${s.unemployed} คน`, s.unemployed > 0 ? 'warn' : ''),
      this.item('utilities', 'น้ำ · ไฟ', `${city.utilities.water ? '✓' : '✗'} · ${city.utilities.power ? '✓' : '✗'}`, 'จากภายนอก', city.utilities.water && city.utilities.power ? '' : 'bad'),
      this.item('warnings', 'ควรตรวจ', `${o.warnings.length + issues.length}`, issues.length ? `อาคาร ${issues.length} แห่ง` : o.warnings.length ? 'ดูในภาพรวมเมือง' : 'ไม่มี', o.warnings.length + issues.length ? 'warn' : ''),
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
    node.append(title, strong, small);
    if (key === 'warnings') { node.setAttribute('role', 'button'); node.tabIndex = 0; node.title = 'เปิดรายการที่ควรตรวจ'; node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onWarnings(); } }); }
    return node;
  }

  private month(untilPay: number, paused: boolean) {
    const node = document.createElement('div'); node.className = 'kpi kpi-month'; node.dataset.kpi = 'month';
    const title = document.createElement('span'); title.className = 'kpi-label'; title.textContent = paused ? '⏸ หยุดอยู่' : 'ชำระรายเดือน';
    const bar = document.createElement('span'); bar.className = 'kpi-progress'; bar.style.setProperty('--progress', String((MONTH - untilPay) / MONTH));
    const small = document.createElement('small'); small.textContent = `อีก ${untilPay} วัน`;
    node.append(title, bar, small); return node;
  }

  private renderIssues(city: City, issues: ReturnType<typeof buildingIssues>) {
    // Rebuild only when the issues change, so a press in progress is never detached at 10× speed.
    const key = issues.map(issue => `${issue.cell}:${issue.kind}`).join(',');
    if (key === this.issueKey && this.issueList.childElementCount) return;
    this.issueKey = key;
    this.issueCount.textContent = issues.length ? `${issues.length} อาคาร · แตะเพื่อไปดู` : 'ไม่มี';
    this.issueList.replaceChildren(...(issues.length ? issues : []).map(issue => {
      const building = city.buildings.find(b => b.cell === issue.cell), item = document.createElement('li');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'issue-link';
      const name = building ? { R: 'บ้าน', C: 'พาณิชย์', I: 'โรงงาน', F: 'ฟาร์ม' }[building.zone] + ` #${building.id}` : `แปลง ${issue.cell}`;
      const where = `${issue.cell % 24 + 1},${Math.floor(issue.cell / 24) + 1}`;
      button.append(Object.assign(document.createElement('strong'), { textContent: name }), Object.assign(document.createElement('span'), { textContent: `${issue.text} · ${where}` }));
      button.dataset.issue = issue.kind; button.setAttribute('aria-label', `ไปที่${name}: ${issue.text}`);
      if (building) button.addEventListener('click', () => this.onIssue(issue.cell, building.id));
      item.append(button); return item;
    }));
    if (!issues.length) this.issueList.append(Object.assign(document.createElement('li'), { textContent: 'ไม่พบอาคารที่มีปัญหาตอนนี้' }));
  }

  private renderLog() {
    this.logList.replaceChildren(...(this.log.length ? this.log : [{ tick: 0, text: 'ยังไม่มีเหตุการณ์ตั้งแต่เปิดเมืองนี้' }]).map(event => {
      const item = document.createElement('li'), day = document.createElement('small');
      day.textContent = `วันที่ ${event.tick}`; item.append(day, document.createTextNode(event.text)); return item;
    }));
  }
}
