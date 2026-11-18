/**
 * City overview dashboard: section navigation, treasury trend and budget, and the
 * 30-day supply chain and city tax settings.
 */
import { treasuryBudget, supplyChain, goodsLines, type ChainFlow, type ChainNode } from './overview-data.ts';
import { CROP_LABELS, PRODUCT_LABELS, RECIPE_LABELS } from './goods.ts';
import { dailySeries, BUILDING_ORDER, BUILDING_NAMES, type DailySeries } from './city-series.ts';
import { cityOverview } from './context-data.ts';
import { CHARTS } from './chart-defs.ts';
import { renderChart, ChartModal } from './chart-modal.ts';
import { mixBar, statTile } from './charts.ts';
import { iconElement } from './ui-icons.ts';
import { cityGoals, renderGoalsCard } from './goals-panel.ts';
import { citySideMissions, type CityGoals } from './city-goals.ts';
import { cityChallenges } from './city-challenges.ts';
import { populationGuidance } from './population-guidance.ts';
import { overviewRevision } from './overview-revision.ts';
import { municipalInvestments, renderMunicipalInvestments, type MunicipalInvestmentTool } from './municipal-investments.ts';
import { budgetSummary, setCityBudget, treasurySpendable } from './sim.ts';
import { BUDGET_LEVELS, type BudgetDepartment, type BudgetLevel } from './budget.ts';
import { MAX_DISTRICTS, createDistrict, deleteDistrict, districtTone, renameDistrict } from './districts.ts';
import { districtStats } from './district-stats.ts';
import { moneyFlows, SECTOR_LABELS, type EconomySector, type MoneyFlows } from './economy-flows.ts';
import { economyInsights } from './economy-insights.ts';
import { treasuryForecast, type TreasuryForecast } from './treasury-forecast.ts';
import { businessSectors, BUSINESS_SECTOR_LABELS, BUYERS, BUYER_LABELS, COST_KINDS, COST_LABELS, type BusinessSectors, type FirmResult } from './business-sectors.ts';
import { householdEconomy, type HouseholdEconomy, INCOME_KINDS, INCOME_LABELS, SAVINGS_BAND_LABELS, SPENDING_KINDS, SPENDING_LABELS } from './household-economy.ts';
import type { City } from './sim.ts';
import { MAX_TAX_RATES, nextTaxDay, scheduleCityTaxes, taxRatesAt, type TaxRates } from './city-tax-policy.ts';
import { taxHappinessPoints } from './resident-happiness.ts';

const SVG = 'http://www.w3.org/2000/svg';
const money = (satang: number) => Math.round(satang / 100).toLocaleString('th-TH') + ' ฿';
const signed = (satang: number) => (satang > 0 ? '+' : satang < 0 ? '−' : '±') + money(Math.abs(satang));
const points = new Intl.NumberFormat('th-TH', { signDisplay: 'exceptZero' });
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) => {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
};
function taxField(key: keyof TaxRates, title: string, households: string) {
  const max = MAX_TAX_RATES[key];
  const field = el('div', `dash-tax-field dash-tax-${key}`);
  const head = el('div', 'dash-tax-field-head');
  const label = el('label', '', title);
  const value = el('span', 'dash-tax-value');
  value.setAttribute('aria-hidden', 'true');
  const input = el('input', 'dash-tax-range');
  input.id = `city-tax-${key}`;
  input.type = 'range';
  input.min = '0'; input.max = String(max); input.step = '1';
  label.htmlFor = input.id;
  const limits = el('div', 'dash-tax-limits');
  limits.setAttribute('aria-hidden', 'true');
  limits.append(el('span', '', '0%'), el('span', '', `${max}%`));
  const impact = el('p', 'dash-tax-impact');
  impact.id = `${input.id}-impact`;
  input.setAttribute('aria-describedby', impact.id);
  head.append(label, value);
  field.append(head, input, limits, impact);
  return {
    field, input,
    preview(happiness: number) {
      const rate = input.valueAsNumber;
      value.textContent = `${rate}%`;
      input.setAttribute('aria-valuetext', `${rate} เปอร์เซ็นต์`);
      input.style.setProperty('--tax-fill', `${rate / max * 100}%`);
      impact.textContent = `ผลต่อเป้าหมายความสุขของ${households} ${points.format(happiness)} คะแนน`;
    },
  };
}
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const node = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); return node;
};

const NAV: readonly [string, string][] = [
  ['dash-goals', 'เป้าหมาย'], ['dash-finance', 'การเงิน'], ['dash-taxes', 'ภาษี'], ['dash-funding', 'งบ'], ['dash-economy', 'เศรษฐกิจ'], ['dash-households', 'ครัวเรือน'], ['dash-business', 'กิจการ'], ['dash-districts', 'ย่าน'], ['dash-chain', 'ห่วงโซ่สินค้า'], ['dash-growth', 'เมืองโต'], ['city-overview', 'ประชากรและงาน'],
  ['growth-anchor', 'ความต้องการ'], ['issue-section', 'ปัญหา'], ['event-log-section', 'เหตุการณ์'], ['money-section', 'บัญชี'],
];
const NODE_NAMES: Record<ChainNode, string> = { farm: 'ฟาร์ม', market: 'C · พืชผล', factory: 'โรงงาน', shop: 'C · สินค้า', household: 'ครัวเรือน', outside: 'ภายนอก' };
const NODE_POS: Record<ChainNode, [number, number]> = { farm: [14, 18], market: [174, 18], household: [334, 104], factory: [14, 190], shop: [174, 190], outside: [334, 190] };
const NODE_W = 92, NODE_H = 48;
/** Flows listed by name; smaller ones fold into one "อื่น ๆ" row. */
const ECONOMY_FLOW_ROWS = 6;
/** At-risk households listed by number; the rest are counted. */
const AT_RISK_ROWS = 3;
/** Firms listed at each end of the profit ranking. */
const FIRM_ROWS = 3;
type BarRow = { label: string; value: number; text: string; detail?: string };
/** Horizontal bars in one hue on a shared scale, each row labelled with its value and share of `total`. */
function barList(title: string, totalText: string, rows: readonly BarRow[], total: number, empty: string): HTMLElement {
  const max = Math.max(1, ...rows.map(r => r.value)), figure = el('figure', 'dash-flowbars'), caption = el('figcaption', 'chart-mix-head');
  caption.append(el('span', '', title), el('strong', '', totalText)); figure.append(caption);
  const list = el('ul', 'dash-flowbar-list');
  for (const r of rows) {
    const share = total ? Math.round(r.value / total * 100) : 0, item = el('li', 'dash-flowbar');
    item.tabIndex = 0; item.title = [`${r.label}: ${r.text}`, `${share}%`, r.detail].filter(Boolean).join(' · ');
    const head = el('div', 'dash-flowbar-head'); head.append(el('span', '', r.label), el('strong', '', r.text), el('small', '', `${share}%`));
    const track = el('span', 'dash-flowbar-track'), bar = el('span', 'dash-flowbar-fill'); bar.style.setProperty('--share', (r.value / max).toFixed(4));
    if (!r.value) bar.style.minWidth = '0';
    track.setAttribute('aria-hidden', 'true'); track.append(bar); item.append(head, track); list.append(item);
  }
  figure.append(rows.length && total ? list : el('p', 'dash-funding-note', empty));
  return figure;
}

export class OverviewDashboard {
  private readonly host: HTMLElement;
  private readonly goals = el('section', 'dash-card dash-goals');
  private readonly kpis = el('section', 'dash-kpis');
  private readonly finance = el('section', 'dash-card dash-finance');
  private readonly financeHead = this.head('การเงินของเมือง', '');
  private readonly financeNote = this.financeHead.querySelector('span')!;
  private readonly financeCharts = el('div');
  private readonly wageTax = taxField('wage', 'ภาษีค่าจ้าง', 'ครัวเรือนที่มีงานรับค่าจ้าง');
  private readonly profitTax = taxField('profit', 'ภาษีกำไรกิจการ', 'ครัวเรือนเจ้าของกิจการ');
  private readonly taxStatus = el('p', 'dash-tax-status');
  private readonly budget = el('section', 'dash-funding');
  private readonly economy = el('section', 'dash-card dash-economy');
  private readonly householdCard = el('section', 'dash-card dash-economy dash-households');
  private readonly businessCard = el('section', 'dash-card dash-economy dash-business');
  private readonly districts = el('section', 'dash-card dash-districts');
  private readonly chain = el('section', 'dash-card dash-chain');
  private readonly growth = el('section', 'dash-card dash-growth');
  private readonly modal = new ChartModal();
  private city: City | null = null;
  private key = '';
  private chartWidth = 300;

  constructor(host: HTMLElement, private readonly onSelectTool?: (tool: MunicipalInvestmentTool) => void, private readonly onPaintDistrict?: (id: number | null) => void) {
    this.host = host;
    this.goals.id = 'dash-goals'; this.finance.id = 'dash-finance'; this.chain.id = 'dash-chain'; this.growth.id = 'dash-growth'; this.kpis.setAttribute('aria-label', 'ตัวเลขหลักของเมือง');
    const nav = el('nav', 'dash-nav'); nav.setAttribute('aria-label', 'ไปยังหมวดในภาพรวมเมือง');
    for (const [target, label] of NAV) {
      const button = el('button', target === 'dash-taxes' ? 'dash-nav-chip dash-nav-tax' : 'dash-nav-chip', label); button.type = 'button';
      button.addEventListener('click', () => {
        const section = document.getElementById(target);
        if (section instanceof HTMLDetailsElement) section.open = true;
        section?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      });
      nav.append(button);
    }
    const taxForm = el('form', 'dash-tax');
    taxForm.id = 'dash-taxes';
    const taxFields = el('fieldset');
    const controls = el('div', 'dash-tax-controls');
    const submit = el('button', 'dash-tax-submit', 'ตั้งอัตรารอบถัดไป');
    submit.type = 'submit';
    controls.append(this.wageTax.field, this.profitTax.field);
    this.taxStatus.setAttribute('role', 'status');
    taxFields.append(el('legend', '', 'อัตราภาษีเมือง'), this.taxStatus, controls, submit);
    taxForm.append(taxFields);
    taxForm.addEventListener('input', () => this.previewTaxRates());
    taxForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!this.city) return;
      scheduleCityTaxes(this.city, this.draftTaxRates());
      this.updateTaxSettings(this.city, true);
    });
    this.budget.id = 'dash-funding';
    this.budget.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-budget-level]');
      if (!button || !this.city) return;
      setCityBudget(this.city, button.dataset.department as BudgetDepartment, Number(button.dataset.budgetLevel) as BudgetLevel);
      this.renderBudget(this.city);
    });
    this.finance.append(this.financeHead, taxForm, this.budget, this.financeCharts);
    this.economy.addEventListener('click', event => {
      const target = (event.target as Element).closest<HTMLElement>('[data-target]')?.dataset.target;
      if (target) document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    this.economy.id = 'dash-economy'; this.householdCard.id = 'dash-households'; this.businessCard.id = 'dash-business';
    this.districts.id = 'dash-districts';
    this.districts.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-district-action]');
      if (!button || !this.city) return;
      const id = Number(button.dataset.districtId) || null, action = button.dataset.districtAction;
      if (action === 'paint') { this.onPaintDistrict?.(id); return; }
      if (action === 'erase') { this.onPaintDistrict?.(null); return; }
      if (action === 'create') { const name = prompt('ชื่อย่านใหม่', `ย่าน ${(this.city.districts?.list.length ?? 0) + 1}`); const made = name ? createDistrict(this.city, name) : null; if (made) this.onPaintDistrict?.(made.id); else this.renderDistricts(this.city); return; }
      if (action === 'rename' && id) { const current = this.city.districts?.list.find(d => d.id === id)?.name ?? ''; const name = prompt('ชื่อย่าน', current); if (name) renameDistrict(this.city, id, name); }
      if (action === 'delete' && id && confirm('ลบย่านนี้? แปลงในย่านจะไม่อยู่ในย่านใด')) deleteDistrict(this.city, id);
      this.renderDistricts(this.city);
    });
    host.replaceChildren(nav, this.goals, this.kpis, this.finance, this.economy, this.householdCard, this.businessCard, this.districts, this.chain, this.growth);
  }
  get modalOpen() { return this.modal.isOpen; }
  closeModal() { this.modal.close(); }

  /** Rebuild once per simulated day; the navigation stays put so a press is never detached. */
  update(city: City, goals: CityGoals = cityGoals(city)) {
    const missions = citySideMissions(city), challenges = cityChallenges(city);
    const population = populationGuidance(city, goals);
    // Road edits and capital changes can alter displayed state without advancing time.
    const key = `${overviewRevision(city, goals, missions, challenges, population)}:${JSON.stringify(municipalInvestments(city))}:${treasurySpendable(city)}:${JSON.stringify(city.districts ?? null)}:${JSON.stringify(city.budget ?? null)}`;
    const switchedCity = city !== this.city;
    if (switchedCity) this.key = ''; // A loaded city may share day and ledger sizes.
    this.updateTaxSettings(city, switchedCity);
    this.city = city; this.modal.update(city);
    if (key === this.key) return;
    this.key = key;
    // Measure once before rebuilding, so building six charts does not force a layout each.
    this.chartWidth = this.width();
    const series = dailySeries(city, 30);
    renderGoalsCard(this.goals, goals, missions, challenges, population);
    this.renderKpis(city, series); this.renderBudget(city); const flows = moneyFlows(city), homes = householdEconomy(city), business = businessSectors(city, undefined, RECIPE_LABELS);
    const forecast = treasuryForecast(city, treasurySpendable(city), budgetSummary(city).reduce((n, row) => n + row.monthly, 0));
    this.renderEconomy(flows, homes, business, forecast); this.renderHouseholds(homes); this.renderBusiness(business); this.renderDistricts(city); this.renderFinance(city, series, forecast); this.renderChain(city, series); this.renderGrowth(city, series);
  }

  /** Chart width follows the card so text stays at its real size. */
  private width() { return Math.max(260, Math.round((this.host.clientWidth || 340) - 44)); }
  private chart(key: string, series: DailySeries) {
    const def = CHARTS[key], box = el('div', 'dash-chart'), head = el('div', 'dash-chart-head');
    const expand = el('button', 'dash-expand'); expand.type = 'button'; expand.title = `ขยาย ${def.title}`; expand.setAttribute('aria-label', `ขยายกราฟ ${def.title}`);
    expand.append(iconElement('zoom-in')); expand.addEventListener('click', () => { if (this.city) this.modal.open(key, this.city); });
    head.append(el('h4', '', def.title), expand); box.append(head, renderChart(def, series, this.chartWidth, 140)); return box;
  }

  /** One row per department: what it costs a month at its funding, and five funding steps. Takes effect at once. */
  private renderBudget(city: City) {
    this.city = city;
    const rows = budgetSummary(city), total = rows.reduce((n, row) => n + row.monthly, 0), base = rows.reduce((n, row) => n + row.base, 0);
    const list = el('div', 'dash-funding-rows');
    for (const row of rows) {
      const line = el('div', 'dash-funding-row'); line.dataset.department = row.department;
      const head = el('div', 'dash-funding-head');
      head.append(el('strong', '', row.label), el('span', 'dash-funding-cost', row.places ? `${row.places} แห่ง · ${money(row.monthly)}/เดือน` : 'ยังไม่มีอาคาร'));
      const steps = el('div', 'dash-funding-steps'); steps.setAttribute('role', 'group'); steps.setAttribute('aria-label', `งบ${row.label}`);
      for (const level of BUDGET_LEVELS) {
        const b = el('button', 'dash-funding-step', `${level}%`); b.type = 'button';
        Object.assign(b.dataset, { department: row.department, budgetLevel: String(level) });
        b.setAttribute('aria-pressed', String(level === row.level));
        steps.append(b);
      }
      line.append(head, steps); list.append(line);
    }
    const note = el('p', 'dash-funding-note', `ค่าบำรุงรวม ${money(total)}/เดือน${total !== base ? ` (งบปกติ ${money(base)})` : ''} · งบต่ำประหยัดเงินแต่ระยะบริการและความสุขลดลง งบสูงกลับกัน · มีผลทันที ค่าบำรุงคิดตอนสิ้นเดือน`);
    this.budget.replaceChildren(el('h4', '', 'งบประมาณรายหมวด'), list, note);
  }

  /** Named districts with what each holds; paint, rename or delete one, or start a new one. */
  /** Who paid whom over 30 days: each side's net, then the largest flows between sides as one-hue bars. */
  private renderEconomy(f: MoneyFlows, homes: HouseholdEconomy, business: BusinessSectors, forecast: TreasuryForecast) {
    const net = (sector: EconomySector) => f.balances.find(b => b.sector === sector)!;
    const keep = (text: string) => text.replace(/ /g, '\u00a0'); // an amount never breaks across lines
    const tone = (v: number) => v > 0 ? 'good' as const : v < 0 ? 'bad' as const : 'flat' as const;
    const side = (sector: EconomySector, icon: string) => {
      const b = net(sector);
      return statTile({ label: SECTOR_LABELS[sector], icon, value: signed(b.net), delta: { text: b.net > 0 ? 'เงินเข้ามากกว่าออก' : b.net < 0 ? 'เงินออกมากกว่าเข้า' : 'เข้าเท่ากับออก', tone: tone(b.net) }, note: `${keep(`รับ ${money(b.inflow)}`)} · ${keep(`จ่าย ${money(b.outflow)}`)}` });
    };
    const border = f.cameIn - f.leftCity;
    const tiles = el('div', 'dash-economy-tiles');
    tiles.append(side('household', 'household'), side('firm', 'shop'), side('treasury', 'coin'),
      statTile({ label: 'เงินเข้าเมืองสุทธิ', icon: 'import', value: signed(border), delta: { text: border > 0 ? 'เข้ามากกว่ารั่วออก' : border < 0 ? 'รั่วออกมากกว่าเข้า' : 'เข้าเท่ากับออก', tone: tone(border) }, note: `${keep(`เข้า ${money(f.cameIn)}`)} · ${keep(`ออก ${money(f.leftCity)}`)}` }));
    const total = f.flows.reduce((n, x) => n + x.amount, 0), shown = f.flows.slice(0, ECONOMY_FLOW_ROWS), rest = f.flows.slice(ECONOMY_FLOW_ROWS);
    const rows = shown.map(x => ({ label: `${SECTOR_LABELS[x.from]} → ${SECTOR_LABELS[x.to]}`, amount: x.amount, entries: x.entries }));
    if (rest.length) rows.push({ label: 'อื่น ๆ', amount: rest.reduce((n, x) => n + x.amount, 0), entries: rest.reduce((n, x) => n + x.entries, 0) });
    const figure = barList('เงินที่ไหลระหว่างฝ่าย', money(total), rows.map(r => ({ label: r.label, value: r.amount, text: money(r.amount), detail: `${r.entries.toLocaleString('th-TH')} รายการ` })), total, 'ยังไม่มีเงินไหลในช่วงนี้');
    const trade = f.within.firm ?? 0, transfers = f.within.household ?? 0;
    const facts = [trade ? `กิจการซื้อขายกันเอง ${money(trade)}` : '', transfers ? `ครัวเรือนจ่ายกันเอง ${money(transfers)}` : ''].filter(Boolean).join(' · ');
    const insights = economyInsights(f, homes, business, forecast), notes = el('ul', 'dash-insights'); notes.setAttribute('aria-label', 'ข้อสังเกตเศรษฐกิจ');
    for (const x of insights) {
      const item = el('li'), go = el('button', `dash-insight ${x.tone}`); go.type = 'button'; go.dataset.target = x.target; go.dataset.insight = x.key;
      go.append(el('span', 'dash-insight-tag', x.tone === 'bad' ? 'ต้องแก้' : x.tone === 'warn' ? 'น่าจับตา' : 'ดี'), el('span', 'dash-insight-text', x.text), el('span', 'dash-insight-go', '›'));
      go.setAttribute('aria-label', `${x.text} · ไปที่รายละเอียด`); item.append(go); notes.append(item);
    }
    this.economy.replaceChildren(this.head('เงินไหลเวียนในเมือง', `วันที่ ${f.fromTick}–${f.toTick}`), ...(insights.length ? [notes] : []), tiles, figure, ...(facts ? [el('p', 'dash-funding-note', facts)] : []));
  }

  /** Household income and spending by kind, savings spread, and who cannot cover next month's rent and water/power. */
  private renderHouseholds(r: HouseholdEconomy) {
    const keep = (text: string) => text.replace(/ /g, '\u00a0');
    // Each kind keeps its colour slot; kinds with nothing this month are left out of the legend.
    const mix = el('div', 'dash-mix');
    mix.append(
      mixBar(INCOME_KINDS.map((k, i) => ({ key: k, label: INCOME_LABELS[k], value: r.income[k], slot: i + 1 })).filter(p => p.value > 0), money, 'รายได้ครัวเรือนตามแหล่ง'),
      mixBar(SPENDING_KINDS.map((k, i) => ({ key: k, label: SPENDING_LABELS[k], value: r.spending[k], slot: i + 1 })).filter(p => p.value > 0), money, 'รายจ่ายครัวเรือนตามประเภท'),
    );
    const risk = r.atRisk.length, tiles = el('div', 'dash-economy-tiles');
    tiles.append(
      statTile({ label: 'เงินเก็บกลาง', icon: 'coin', value: money(r.medianSavings), note: 'ครึ่งหนึ่งของครัวเรือนมีน้อยกว่านี้' }),
      statTile({ label: 'เสี่ยงจ่ายไม่ไหว', icon: 'household', value: `${risk.toLocaleString('th-TH')} ครัวเรือน`, delta: { text: risk ? 'เงินเก็บไม่พอค่าเช่าและน้ำไฟเดือนหน้า' : 'ทุกบ้านจ่ายเดือนหน้าได้', tone: risk ? 'bad' : 'good' }, meter: r.households ? risk / r.households : 0 }),
    );
    const bands = barList('ครัวเรือนตามเงินเก็บ', `${r.households.toLocaleString('th-TH')} ครัวเรือน`, SAVINGS_BAND_LABELS.map((label, i) => ({ label, value: r.savings[i], text: `${r.savings[i].toLocaleString('th-TH')} บ้าน` })), r.households, 'ยังไม่มีครัวเรือน');
    const parts: HTMLElement[] = [this.head('เศรษฐกิจครัวเรือน', `วันที่ ${r.fromTick}–${r.toTick}`), tiles, mix, bands];
    if (risk) {
      const list = el('ul', 'dash-risk-list');
      for (const h of r.atRisk.slice(0, AT_RISK_ROWS)) {
        const item = el('li', 'dash-risk');
        item.append(el('strong', '', `ครัวเรือน #${h.id}`), el('span', '', `${h.members} คน`), el('small', '', `${keep(`เก็บ ${money(h.savings)}`)} · ${keep(`บิล ${money(h.bills)}/เดือน`)}`));
        list.append(item);
      }
      if (risk > AT_RISK_ROWS) list.append(el('li', 'dash-risk more', `และอีก ${(risk - AT_RISK_ROWS).toLocaleString('th-TH')} ครัวเรือน`));
      parts.push(el('h4', 'dash-sub', 'ครัวเรือนที่ควรดูแล'), list);
    }
    const facts = [`${r.spendingMore.toLocaleString('th-TH')} ครัวเรือนใช้มากกว่าหาได้`, r.arrived ? `ย้ายเข้านำเงินมา ${money(r.arrived)}` : '', r.departed ? `ย้ายออกนำเงินไป ${money(r.departed)}` : ''].filter(Boolean).join(' · ');
    parts.push(el('p', 'dash-funding-note', facts));
    this.householdCard.replaceChildren(...parts);
  }

  /** Farms, factories and shops: takings against running costs on one scale, who buys, where the money goes, and the best and worst firms. */
  private renderBusiness(r: BusinessSectors) {
    const open = r.sectors.filter(s => s.firms > 0);
    const tone = (v: number) => v > 0 ? 'good' : v < 0 ? 'bad' : 'flat';
    const max = Math.max(1, ...open.flatMap(s => [s.revenue, s.costs]));
    const legend = el('div', 'dash-legend');
    legend.append(el('span', 'dash-key revenue', 'รายรับ'), el('span', 'dash-key costs', 'ต้นทุนดำเนินการ'));
    const list = el('ul', 'dash-sector-list');
    for (const s of open) {
      const item = el('li', 'dash-sector'), head = el('div', 'dash-flowbar-head');
      head.append(el('span', '', `${BUSINESS_SECTOR_LABELS[s.sector]} · ${s.firms.toLocaleString('th-TH')} แห่ง · ${s.workers.toLocaleString('th-TH')} คน`), el('strong', `dash-profit ${tone(s.profit)}`, `กำไร ${signed(s.profit)}`));
      item.append(head);
      for (const [kind, value] of [['revenue', s.revenue], ['costs', s.costs]] as const) {
        const row = el('div', 'dash-sector-bar'), track = el('span', 'dash-flowbar-track'), bar = el('span', `dash-flowbar-fill ${kind}`);
        bar.style.setProperty('--share', (value / max).toFixed(4)); if (!value) bar.style.minWidth = '0';
        track.setAttribute('aria-hidden', 'true'); track.append(bar); row.append(track, el('small', '', money(value))); item.append(row);
      }
      item.title = `${BUSINESS_SECTOR_LABELS[s.sector]}: รายรับ ${money(s.revenue)} · ต้นทุน ${money(s.costs)} · กำไร ${signed(s.profit)}`;
      list.append(item);
    }
    const sum = <K extends string>(keys: readonly K[], pick: (s: typeof r.sectors[number]) => Record<K, number>) => keys.map((k, i) => ({ key: k, value: r.sectors.reduce((n, s) => n + pick(s)[k], 0), slot: i + 1 }));
    const mix = el('div', 'dash-mix');
    mix.append(
      mixBar(sum(BUYERS, s => s.buyers).map(p => ({ ...p, label: BUYER_LABELS[p.key] })).filter(p => p.value > 0), money, 'รายรับกิจการตามผู้ซื้อ'),
      mixBar(sum(COST_KINDS, s => s.costKinds).map(p => ({ ...p, label: COST_LABELS[p.key] })).filter(p => p.value > 0), money, 'ต้นทุนกิจการตามประเภท'),
    );
    const firmRows = (firms: readonly FirmResult[]) => {
      const ul = el('ul', 'dash-risk-list');
      for (const f of firms) {
        const li = el('li', `dash-risk firm ${tone(f.profit)}`);
        li.append(el('strong', '', f.label), el('span', '', `${f.workers.toLocaleString('th-TH')} คน`), el('small', '', `กำไร ${signed(f.profit)}`.replace(/ /g, '\u00a0')));
        ul.append(li);
      }
      return ul;
    };
    const best = r.firms.slice(0, FIRM_ROWS), worst = r.firms.slice(Math.max(best.length, r.firms.length - FIRM_ROWS)).reverse();
    const payouts = r.sectors.reduce((n, s) => n + s.payouts, 0), investment = r.sectors.reduce((n, s) => n + s.investment, 0);
    const parts: HTMLElement[] = [this.head('กิจการตามภาค', `วันที่ ${r.fromTick}–${r.toTick}`)];
    if (!open.length) parts.push(el('p', 'dash-funding-note', 'ยังไม่มีกิจการในเมือง'));
    else {
      parts.push(legend, list, mix, el('h4', 'dash-sub', 'กำไรสูงสุด'), firmRows(best));
      if (worst.length) parts.push(el('h4', 'dash-sub', 'กำไรต่ำสุด'), firmRows(worst));
      parts.push(el('p', 'dash-funding-note', `กำไร = รายรับ − ต้นทุนดำเนินการ · จ่ายปันผลเจ้าของ ${money(payouts)} · ลงทุนต่อเติม ${money(investment)}`));
    }
    this.businessCard.replaceChildren(...parts);
  }

  private renderDistricts(city: City) {
    this.city = city;
    const stats = districtStats(city), action = (label: string, kind: string, id = 0, className = 'dash-district-action') => {
      const b = el('button', className, label); b.type = 'button'; b.dataset.districtAction = kind; if (id) b.dataset.districtId = String(id); return b;
    };
    const list = el('div', 'dash-district-list');
    for (const d of stats) {
      const row = el('div', 'dash-district-row'); row.dataset.districtId = String(d.id);
      const head = el('div', 'dash-district-head'), swatch = el('span', `dash-district-swatch ${districtTone(d.id)}`);
      head.append(swatch, el('strong', '', d.name), el('span', 'dash-district-meta', `${d.parcels} แปลง · ${d.people} คน`));
      const facts = el('p', 'dash-district-facts', [`${d.households} ครัวเรือน`, d.happiness === null ? null : `ความสุข ${d.happiness}`, d.pollution === null ? null : `มลพิษ ${d.pollution}`, d.landValue === null ? null : `ที่ดิน ${d.landValue}`].filter(Boolean).join(' · '));
      const actions = el('div', 'dash-district-actions'); actions.append(action('ระบาย', 'paint', d.id), action('เปลี่ยนชื่อ', 'rename', d.id), action('ลบ', 'delete', d.id));
      row.append(head, facts, actions); list.append(row);
    }
    const footer = el('div', 'dash-district-actions');
    if (stats.length < MAX_DISTRICTS) footer.append(action('＋ ย่านใหม่', 'create', 0, 'dash-district-action primary'));
    if (stats.length) footer.append(action('เอาแปลงออกจากย่าน', 'erase'));
    this.districts.replaceChildren(this.head('ย่านในเมือง', stats.length ? `${stats.length} / ${MAX_DISTRICTS} ย่าน` : 'ยังไม่มีย่าน'),
      ...(stats.length ? [list] : [el('p', 'dash-district-facts', 'ตั้งชื่อย่านแล้วแตะแปลงบนแผนที่เพื่อระบาย ดูประชากร ความสุข มลพิษ และมูลค่าที่ดินแยกตามย่าน')]), footer);
  }

  private renderKpis(city: City, series: DailySeries) {
    const o = cityOverview(city), now = series.treasury.at(-1)!, net = o.net, people = series.population, popDelta = people.at(-1)! - people[0];
    const employed = o.workforce ? o.employed / o.workforce : 0, housing = o.personCapacity ? o.occupiedPersons / o.personCapacity : 0;
    this.kpis.replaceChildren(
      statTile({ label: 'เงินคลัง', icon: 'coin', value: money(now), delta: { text: `${signed(net)} ใน 30 วัน`, tone: net > 0 ? 'good' : net < 0 ? 'bad' : 'flat' }, spark: series.treasury }),
      statTile({ label: 'ประชากร', icon: 'people', value: `${o.population.toLocaleString('th-TH')} คน`, delta: { text: `${popDelta >= 0 ? '+' : '−'}${Math.abs(popDelta).toLocaleString('th-TH')} ใน 30 วัน`, tone: popDelta > 0 ? 'good' : popDelta < 0 ? 'bad' : 'flat' }, spark: people }),
      statTile({ label: 'มีงานทำ', icon: 'worker', value: `${Math.round(employed * 100)}%`, meter: employed, note: `${o.employed.toLocaleString('th-TH')} จาก ${o.workforce.toLocaleString('th-TH')} คน` }),
      statTile({ label: 'ที่พักใช้ไป', icon: 'household', value: `${Math.round(housing * 100)}%`, meter: housing, note: `${o.occupiedPersons.toLocaleString('th-TH')} จาก ${o.personCapacity.toLocaleString('th-TH')} คน` }),
    );
  }

  private head(title: string, note: string) {
    const head = el('header', 'dash-head'); head.append(el('h3', '', title), el('span', 'dash-note', note)); return head;
  }

  private draftTaxRates(): TaxRates {
    return { wage: this.wageTax.input.valueAsNumber, profit: this.profitTax.input.valueAsNumber };
  }

  private previewTaxRates() {
    const impact = taxHappinessPoints(this.draftTaxRates());
    this.wageTax.preview(impact.wage);
    this.profitTax.preview(impact.profit);
  }

  private updateTaxSettings(city: City, resetInputs: boolean) {
    const active = taxRatesAt(city.taxPolicy, city.tick);
    const latest = city.taxPolicy?.at(-1);
    const pending = latest && latest.fromDay > city.tick ? latest : undefined;
    if (resetInputs) {
      this.wageTax.input.value = String(pending?.wage ?? active.wage);
      this.profitTax.input.value = String(pending?.profit ?? active.profit);
      this.previewTaxRates();
    }
    const current = `ปัจจุบัน ค่าจ้าง ${active.wage}% · กำไรกิจการ ${active.profit}%`;
    const next = pending
      ? `ตั้งไว้สำหรับวันที่ ${pending.fromDay} ค่าจ้าง ${pending.wage}% · กำไรกิจการ ${pending.profit}%`
      : `อัตราใหม่เริ่มใช้วันที่ ${nextTaxDay(city.tick)}`;
    const status = `${current}\n${next}`;
    if (this.taxStatus.textContent !== status) this.taxStatus.textContent = status;
  }

  /** If the next 30 days repeat the last 30: the balance then, how long the money lasts, and the next month-end bill. */
  private renderForecast(f: TreasuryForecast) {
    const box = el('div', 'dash-forecast'), tone = f.daily > 0 ? 'good' as const : f.daily < 0 ? 'bad' as const : 'flat' as const;
    const runway = f.runwayDays === null ? 'ไม่ลดลง' : f.runwayDays >= 365 ? 'เกิน 1 ปี' : `${f.runwayDays.toLocaleString('th-TH')} วัน`;
    const tiles = el('div', 'dash-economy-tiles');
    tiles.append(
      statTile({ label: 'คาดอีก 30 วัน', icon: 'coin', value: money(Math.max(0, f.nextMonth)), delta: { text: `${signed(f.daily)}/วัน`, tone }, note: `ตอนนี้ ${money(f.balance)}` }),
      statTile({ label: 'เงินคลังพอใช้', icon: 'clock', value: runway, delta: { text: f.runwayDays === null ? 'รายรับไม่น้อยกว่ารายจ่าย' : 'ถ้ายังใช้เท่านี้', tone: f.runwayDays === null ? 'good' : f.runwayDays < 90 ? 'bad' : 'flat' }, note: `ใช้ได้ทันที ${money(f.spendable)}` }),
    );
    const note = el('p', 'dash-funding-note', `คิดจาก ${f.windowDays} วันที่ผ่านมา (ไม่รวมเงินตั้งเมือง): รับ ${money(f.income)} · จ่าย ${money(f.spending)} · ตัดบิลสิ้นเดือนอีก ${f.settlementIn} วัน${f.upkeep ? ` · ค่าบำรุงที่รู้แล้ว ${money(f.upkeep)}` : ''}`);
    box.append(el('h4', 'dash-sub', 'พยากรณ์คลัง'), tiles, note);
    return box;
  }

  private renderFinance(city: City, series: DailySeries, forecast: TreasuryForecast) {
    const budget = treasuryBudget(city);
    const mix = el('div', 'dash-mix');
    mix.append(
      mixBar(budget.income.map((line, i) => ({ key: line.key, label: line.label, value: line.amount, slot: i + 1 })), money, 'รายรับคลังตามแหล่ง'),
      mixBar(budget.expense.map((line, i) => ({ key: line.key, label: line.label, value: line.amount, slot: i + 1 })), money, 'รายจ่ายคลังตามประเภท'),
    );
    this.financeNote.textContent = `วันที่ ${series.ticks[0]}–${city.tick}`;
    this.financeCharts.replaceChildren(this.renderForecast(forecast), this.chart('treasury', series), this.chart('cashflow', series), mix, renderMunicipalInvestments(city, this.onSelectTool));
  }

  private renderChain(city: City, series: DailySeries) {
    const chain = supplyChain(city), max = Math.max(1, ...chain.flows.map(f => f.quantity));
    const count = (kind: ChainNode) => kind === 'household' ? city.households.length : kind === 'outside' ? 0
      : city.firms.filter(f => kind === 'farm' ? f.zone === 'F' : kind === 'factory' ? f.zone === 'I' : f.zone === 'C').length;
    const diagram = svg('svg', { viewBox: '0 0 440 270', class: 'dash-chain-svg', role: 'img', 'aria-label': 'แผนภาพการไหลของพืชผลและสินค้า 30 วัน รายละเอียดอยู่ในรายการด้านล่าง' });
    const defs = svg('defs');
    for (const tone of ['crops', 'goods', 'idle']) {
      const marker = svg('marker', { id: `dash-arrow-${tone}`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 11, markerHeight: 11, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' });
      marker.append(svg('path', { d: 'M0,0L10,5L0,10Z', class: `dash-arrow ${tone}` })); defs.append(marker);
    }
    diagram.append(defs);
    const centre = (n: ChainNode) => [NODE_POS[n][0] + NODE_W / 2, NODE_POS[n][1] + NODE_H / 2] as const;
    const edgePoint = (n: ChainNode, toward: readonly [number, number]) => {
      const [cx, cy] = centre(n), dx = toward[0] - cx, dy = toward[1] - cy, sx = NODE_W / 2 / (Math.abs(dx) || 1e-6), sy = NODE_H / 2 / (Math.abs(dy) || 1e-6), s = Math.min(sx, sy);
      return [cx + dx * s, cy + dy * s] as const;
    };
    const labels: SVGElement[] = [];
    for (const flow of chain.flows) {
      const tone = flow.quantity ? flow.commodity : 'idle';
      let a = edgePoint(flow.from, centre(flow.to)), b = edgePoint(flow.to, centre(flow.from)), d: string, mid: [number, number];
      if (flow.from === 'factory' && flow.to === 'outside') { // route under the shop
        a = [centre('factory')[0], NODE_POS.factory[1] + NODE_H]; b = [centre('outside')[0], NODE_POS.outside[1] + NODE_H];
        d = `M${a[0]},${a[1]}C${a[0]},${a[1] + 30} ${b[0]},${b[1] + 30} ${b[0]},${b[1] + 4}`; mid = [(a[0] + b[0]) / 2, a[1] + 22];
      } else { d = `M${a[0]},${a[1]}L${b[0]},${b[1]}`; mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
      diagram.append(svg('path', { d, class: `dash-flow ${tone}`, 'stroke-width': (flow.quantity ? 2 + 4 * flow.quantity / max : 1.5).toFixed(1), 'marker-end': `url(#dash-arrow-${tone})` }));
      if (flow.quantity) {
        const g = svg('g', { class: 'dash-flow-label' }), text = svg('text', { x: mid[0], y: mid[1] + 4, 'text-anchor': 'middle' });
        text.textContent = flow.quantity.toLocaleString('th-TH');
        g.append(svg('rect', { x: mid[0] - 22, y: mid[1] - 9, width: 44, height: 18, rx: 9 }), text); labels.push(g);
      }
    }
    for (const node of Object.keys(NODE_POS) as ChainNode[]) {
      const [x, y] = NODE_POS[node], g = svg('g', { class: `dash-node ${node}` });
      const name = svg('text', { x: x + NODE_W / 2, y: y + 20, 'text-anchor': 'middle', class: 'dash-node-name' }); name.textContent = NODE_NAMES[node];
      const sub = svg('text', { x: x + NODE_W / 2, y: y + 37, 'text-anchor': 'middle', class: 'dash-node-sub' });
      sub.textContent = node === 'outside' ? 'นำเข้า/ส่งออก' : node === 'farm' ? `เก็บ ${chain.harvested}` : node === 'factory' ? `ผลิต ${chain.produced}` : `${count(node)} ${node === 'household' ? 'ครัวเรือน' : 'แห่ง'}`;
      g.append(svg('rect', { x, y, width: NODE_W, height: NODE_H, rx: 12 }), name, sub); diagram.append(g);
    }
    diagram.append(...labels);
    const legend = el('div', 'dash-legend'); legend.append(el('span', 'dash-key crops', 'พืชผล (ล็อต)'), el('span', 'dash-key goods', 'สินค้าสำเร็จรูป (หน่วย)'), el('span', 'dash-key idle', 'ไม่มีการไหลในช่วงนี้'));
    const list = el('ul', 'dash-flow-list');
    for (const flow of chain.flows) {
      const item = el('li', flow.quantity ? '' : 'idle'); item.dataset.flow = `${flow.from}-${flow.to}`;
      item.append(el('span', `dash-key ${flow.quantity ? flow.commodity : 'idle'}`, `${NODE_NAMES[flow.from]} → ${NODE_NAMES[flow.to]}`), el('strong', '', `${flow.quantity.toLocaleString('th-TH')} ${flow.commodity === 'crops' ? 'ล็อต' : 'หน่วย'}`));
      list.append(item);
    }
    const summary = el('p', 'dash-note-line', `เก็บเกี่ยว ${chain.harvested} ล็อต · แปรรูป ${chain.processed} ล็อต เป็นสินค้า ${chain.produced} หน่วย · วันที่ ${chain.window.fromTick}–${chain.window.toTick}`);
    // One row per farm-to-table line: grown, made and sold in the window.
    const lines = el('ul', 'dash-flow-list dash-goods');
    for (const line of goodsLines(city)) {
      const active = line.farms + line.factories > 0, item = el('li', active ? '' : 'idle'); item.dataset.recipe = line.recipe;
      item.append(el('span', `dash-key ${active ? 'goods' : 'idle'}`, `${CROP_LABELS[line.crop]} → ${PRODUCT_LABELS[line.product]}`),
        el('strong', '', active ? `ฟาร์ม ${line.farms} · ${RECIPE_LABELS[line.recipe]} ${line.factories} · เก็บ ${line.harvested} · ผลิต ${line.produced} · ขาย ${line.sold + line.freshSold}${line.imported ? ` · นำเข้า ${line.imported}` : ''}${line.exportedCrops ? ` · ส่งออกพืช ${line.exportedCrops}` : ''}` : `ยังไม่มี · เลือกปลูก${CROP_LABELS[line.crop]}ที่ฟาร์ม`));
      lines.append(item);
    }
    this.chain.replaceChildren(this.head('ห่วงโซ่สินค้า 30 วัน', 'พาณิชย์ทั้งสองช่องคือกิจการเดียวกัน แยกแสดงตามสินค้า ไม่ใช่จำนวนกิจการที่ต้องบวกกัน'), diagram, legend, summary, lines, list, this.chart('crops', series), this.chart('goods', series));
  }

  private renderGrowth(city: City, series: DailySeries) {
    const o = cityOverview(city), idle = Math.max(0, o.workforce - o.employeeWorkers - o.selfEmployedWorkers);
    const ICON = { shop: 'shop', I: 'I', R: 'R', F: 'F', market: 'market' } as const;
    const mix = el('div', 'dash-mix');
    mix.append(
      mixBar(BUILDING_ORDER.map((kind, i) => ({ key: kind, label: BUILDING_NAMES[kind], value: series.buildings[kind].at(-1) ?? 0, slot: i + 1, icon: ICON[kind] })), v => `${v.toLocaleString('th-TH')} หลัง`, 'อาคารตอนนี้'),
      mixBar([
        { key: 'employee', label: 'ลูกจ้าง', value: o.employeeWorkers, slot: 1, icon: 'worker' }, { key: 'owner', label: 'ทำกิจการเอง', value: o.selfEmployedWorkers, slot: 2, icon: 'market' },
        { key: 'idle', label: 'ว่างงาน', value: idle, slot: 3, icon: 'idle' }, { key: 'dependents', label: 'ผู้พึ่งพิง', value: o.dependents, slot: 4, icon: 'dependents' },
      ], v => `${v.toLocaleString('th-TH')} คน`, 'ประชากรตามบทบาท'),
    );
    this.growth.replaceChildren(this.head('การเติบโตของเมือง', 'อาคารที่ยังอยู่ · ประชากรจากวันที่ย้ายเข้า'), this.chart('population', series), this.chart('buildings', series), mix);
  }
}

export type { ChainFlow };
