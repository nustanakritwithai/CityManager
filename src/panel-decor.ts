/**
 * Presentation pass over rendered panels: an icon on every number tile and long explanations
 * folded behind an ⓘ button on their section heading. Text stays in the DOM (hidden), so
 * screen readers, search and tests still see it; only the default view gets quieter.
 */
import './panel-decor.css';
import { iconElement } from './ui-icons.ts';

/** Metric key → icon, first match wins. Keys are the `data-context-metric` values. */
const METRIC_ICONS: readonly [RegExp, string][] = [
  [/^(income|imported)$|inflow|bought/, 'import'], [/^(expense|exported)$|outflow|sold/, 'export'], [/^plot/, 'F'], [/^goods-/, 'box'],
  [/tax/, 'tax'], [/rent/, 'rent'], [/price/, 'price'],
  [/^(treasury|cash|spendable|distributable|drawable|net|profit|realised-profit|reserved|crop-cost|funding-capital)$|capital|reserve|owner-(withdrawn|capital)/, 'coin'],
  [/^(population|persons|members|occupied-persons|person-capacity|person-vacancy|vacant-persons)$/, 'people'],
  [/^(households|household-count|home-slots|occupied-home-slots|vacant-households|housing-vacancy|home)$/, 'household'],
  [/^homeless/, 'homeless'], [/^dependents$/, 'dependents'], [/^(unemployed|funded-vacancies)$/, 'idle'],
  [/workers|workforce|employed|^jobs$|^employers$|owner-household/, 'worker'],
  [/^crop-|harvest|yield|fertility|available-batches/, 'crop'], [/^recipe-|production/, 'gear'],
  [/^(stock|inventory|produced)$/, 'box'], [/^(consumed|needs|last-purchase)$/, 'consume'],
  [/^firms$|sponsor/, 'I'], [/^level$/, 'level'], [/^age$/, 'clock'],
];
export function metricIcon(key: string): string | null { return METRIC_ICONS.find(([pattern]) => pattern.test(key))?.[1] ?? null; }

const NOTES = '.dash-flow-list, .signal-note, .city-question-note, .entity-explain-note, .owner-note, .owner-summary-note, #game-content .game-menu > p:not(.inspector-status), .cx-detail-note, .cx-account-note, .sm-footnote, .parcel-note, .dash-note-line, .st-note, .cx-flow-meta';
const HOSTS = '.cx-section, .bc-section, .st-col, .dash-card, .parcel-checklist, .growth-section, details, section';
const openInfo = new Set<string>();

function decorateMetrics(root: ParentNode) {
  for (const card of root.querySelectorAll<HTMLElement>('.cx-metric:is([data-context-metric], [data-card-metric]):not([data-decor])')) {
    card.dataset.decor = '';
    const name = metricIcon(card.dataset.contextMetric ?? card.dataset.cardMetric!) ?? (card.classList.contains('money') ? 'coin' : null), dt = card.querySelector('dt');
    if (name && dt) dt.prepend(iconElement(name, 'ui-icon cx-metric-icon'));
    const note = card.querySelector('small');
    card.title = [dt?.textContent, note?.textContent].filter(Boolean).join(' · ');
  }
}
function decorateNotes(root: ParentNode) {
  for (const note of root.querySelectorAll<HTMLElement>(NOTES)) {
    if (note.classList.contains('info-note') || !note.textContent?.trim() || note.closest('.submenu-section')) continue;
    // Live feedback (status, alerts, errors) always stays in view.
    if (note.matches('[role=status], [role=alert], [aria-live], [class*=error], [class*=warn]')) continue;
    let host = note.parentElement?.closest<HTMLElement>(HOSTS) ?? null, heading: HTMLElement | null = null;
    while (host && !(heading = host.querySelector<HTMLElement>(HEADINGS))) host = host.parentElement?.closest<HTMLElement>(HOSTS) ?? null;
    if (!host || !heading) continue;
    note.classList.add('info-note'); infoButton(host, heading, note);
  }
}
const HEADINGS = ':scope > h3, :scope > h4, :scope > .cx-section-head, :scope > .bc-section-head, :scope > .dash-head, :scope > .st-col-title';
/** One ⓘ per section heading; it reveals everything marked `.info-note` / `.dup-metric` inside. */
let nextHost = 0;
function infoButton(host: HTMLElement, heading: HTMLElement, ...items: HTMLElement[]) {
  const key = heading.textContent?.trim() ?? '';
  host.dataset.infoId ??= String(++nextHost);
  for (const item of items) item.dataset.infoOf = host.dataset.infoId;
  const apply = (open: boolean) => {
    host.dataset.infoOpen = String(open); button!.setAttribute('aria-expanded', String(open));
    for (const item of host.querySelectorAll<HTMLElement>(`[data-info-of="${host.dataset.infoId}"]`)) item.classList.toggle('info-closed', !open);
  };
  let button = heading.querySelector<HTMLButtonElement>(':scope > .info-toggle');
  if (!button) {
    button = document.createElement('button'); button.type = 'button'; button.className = 'info-toggle';
    button.setAttribute('aria-label', 'รายละเอียด'); button.title = 'รายละเอียด'; button.append(iconElement('info'));
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const open = host.dataset.infoOpen !== 'true'; apply(open);
      if (open) openInfo.add(key); else openInfo.delete(key);
    });
    heading.append(button);
  }
  apply(openInfo.has(key));
}
const PERSON = '<circle cx="12" cy="6.5" r="3.6" fill="currentColor"/><path d="M5.5 22v-6.5a6.5 6.5 0 0 1 13 0V22z" fill="currentColor"/>';
const GROUPS = [['employed', 'ทำงาน', 'work'], ['unemployed', 'ว่างงาน', 'idle'], ['dependents', 'ผู้พึ่งพิง', 'dep']] as const;
/** Members as figures (small groups) or a donut (large): working, idle workforce, dependents. */
function decoratePeople(root: ParentNode) {
  for (const employed of root.querySelectorAll<HTMLElement>('[data-context-metric="employed"]')) {
    const host = employed.closest<HTMLElement>('.cx-section, .bc-section'); if (!host) continue;
    const values = GROUPS.map(([key]) => Number(host.querySelector<HTMLElement>(`[data-context-metric="${key}"]`)?.dataset.value ?? NaN));
    if (values.some(v => !Number.isFinite(v))) continue;
    const signature = values.join(','), existing = host.querySelector<HTMLElement>('.people-picto');
    if (existing?.dataset.signature === signature) continue;
    const total = values.reduce((a, b) => a + b, 0), picto = document.createElement('div');
    picto.className = 'people-picto'; picto.dataset.signature = signature; picto.setAttribute('role', 'img');
    picto.setAttribute('aria-label', GROUPS.map(([, label], i) => `${label} ${values[i]} คน`).join(' · '));
    const visual = document.createElement('div'); visual.className = total <= 24 ? 'people-figures' : 'people-donut';
    if (total <= 24) {
      GROUPS.forEach(([, , tone], i) => { for (let k = 0; k < values[i]; k++) { const f = document.createElement('span'); f.className = `figure ${tone}`; f.innerHTML = `<svg viewBox="0 0 24 24">${PERSON}</svg>`; visual.append(f); } });
    } else {
      const r = 15.9155, c = 2 * Math.PI * r; let offset = 0, arcs = '';
      GROUPS.forEach(([, , tone], i) => { const len = total ? values[i] / total * c : 0; arcs += `<circle class="arc ${tone}" r="${r}" cx="21" cy="21" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}"/>`; offset += len; });
      visual.innerHTML = `<svg viewBox="0 0 42 42"><circle class="arc track" r="${r}" cx="21" cy="21"/>${arcs}<text x="21" y="23.5" text-anchor="middle">${total.toLocaleString('th-TH')}</text></svg>`;
    }
    const legend = document.createElement('div'); legend.className = 'people-legend';
    GROUPS.forEach(([, label, tone], i) => { const item = document.createElement('span'); item.className = `key ${tone}`; item.innerHTML = `<i></i><b>${values[i].toLocaleString('th-TH')}</b>`; item.title = label; item.append(label); legend.append(item); });
    const card = host.classList.contains('bc-section'), heading = host.querySelector<HTMLElement>(HEADINGS);
    if (card) {
      // Cards keep every tile in view; the figures ride along in the heading and add no height.
      picto.classList.add('inline'); picto.append(visual);
      if (existing) existing.replaceWith(picto); else (heading ?? host).append(picto);
      continue;
    }
    picto.append(visual, legend);
    // The donut already shows these counts; their city tiles move behind ⓘ.
    const dups = ['workforce', 'dependents', 'unemployed'].map(key => host.querySelector<HTMLElement>(`[data-context-metric="${key}"]`)).filter((e): e is HTMLElement => !!e);
    if (heading) infoButton(host, heading, ...dups);
    if (existing) existing.replaceWith(picto); else heading ? heading.after(picto) : host.prepend(picto);
  }
}
/** City-wide tiles that read zero say nothing at a glance; they wait behind the section's ⓘ. */
function foldZeros(root: ParentNode) {
  for (const host of root.querySelectorAll<HTMLElement>('#city-overview .cx-section')) {
    const zeros = [...host.querySelectorAll<HTMLElement>('.cx-metric[data-value="0"]:not([data-info-of])')];
    const heading = host.querySelector<HTMLElement>(HEADINGS);
    if (zeros.length && heading) infoButton(host, heading, ...zeros);
  }
}
const GAUGES = [['occupied-home-slots', 'home-slots', 'household', 'ครัวเรือน'], ['occupied-persons', 'person-capacity', 'people', 'คน']] as const;
/** City housing as two fill gauges (used / capacity); the six raw tiles fold behind ⓘ. */
function decorateHousing(root: ParentNode) {
  for (const capacity of root.querySelectorAll<HTMLElement>('#city-overview [data-context-metric="home-slots"]')) {
    const host = capacity.closest<HTMLElement>('.cx-section'), heading = host?.querySelector<HTMLElement>(HEADINGS); if (!host || !heading) continue;
    const value = (key: string) => Number(host.querySelector<HTMLElement>(`[data-context-metric="${key}"]`)?.dataset.value ?? NaN);
    const signature = GAUGES.map(([used, cap]) => `${value(used)}/${value(cap)}`).join(',');
    if (signature.includes('NaN') || host.querySelector<HTMLElement>(':scope > .gauge-set')?.dataset.signature === signature) continue;
    const set = document.createElement('div'); set.className = 'gauge-set'; set.dataset.signature = signature;
    for (const [used, cap, icon, unit] of GAUGES) {
      const u = value(used), c = value(cap), share = c > 0 ? Math.min(1, u / c) : 0, row = document.createElement('div');
      row.className = `gauge${share >= .95 ? ' full' : ''}`; row.setAttribute('role', 'img'); row.setAttribute('aria-label', `พักอยู่ ${u} จาก ${c} ${unit}`);
      const bar = document.createElement('span'); bar.className = 'gauge-bar'; bar.style.setProperty('--share', share.toFixed(3));
      const label = document.createElement('b'); label.textContent = `${u.toLocaleString('th-TH')} / ${c.toLocaleString('th-TH')}`;
      const free = document.createElement('small'); free.textContent = `ว่าง ${Math.max(0, c - u).toLocaleString('th-TH')}`;
      row.append(iconElement(icon, 'ui-icon gauge-icon'), bar, label, free); set.append(row);
    }
    host.querySelector(':scope > .gauge-set')?.remove(); heading.after(set);
    const tiles = [...host.querySelectorAll<HTMLElement>('.cx-metric')]; infoButton(host, heading, ...tiles);
  }
}
const GROWTH_ICONS = ['power', 'I', 'worker', 'household', 'crop', 'coin', 'coin'];
const CHECK_ICONS: Record<string, string> = { road: 'road', power: 'power', water: 'water', ids: 'gear', 'building-limit': 'level', 'firm-limit': 'level', 'housing-demand': 'household', income: 'coin', fertility: 'F', 'crop-demand': 'crop', owner: 'people', 'market-demand': 'market', industry: 'I' };
const expandedChecks = new Set<string>();
/** Condition lists as a row of icon tiles with ✓ / ! badges; only the blocking step keeps its words. Tap to see all. */
function decorateChecklists(root: ParentNode) {
  for (const list of root.querySelectorAll<HTMLOListElement>('ol.cx-growth-checklist, ol.parcel-checks')) {
    if (list.dataset.decor !== undefined) continue;
    list.dataset.decor = ''; list.classList.add('icon-checks');
    const kind = list.classList.contains('parcel-checks') ? 'parcel' : 'growth';
    [...list.children].forEach((item, index) => {
      const li = item as HTMLElement, key = li.dataset.check, icon = kind === 'growth' ? GROWTH_ICONS[index] : CHECK_ICONS[key ?? ''] ?? 'info';
      if (!li.querySelector('.cx-check-label, .parcel-check-label')) { const label = document.createElement('span'); label.className = 'cx-check-label'; label.textContent = li.textContent; li.textContent = ''; li.append(label); }
      li.title = li.querySelector('.cx-check-label, .parcel-check-label')?.textContent ?? '';
      li.prepend(iconElement(icon, 'ui-icon check-icon'));
    });
    const toggle = () => { const open = list.dataset.expanded !== 'true'; list.dataset.expanded = String(open); list.setAttribute('aria-expanded', String(open)); if (open) expandedChecks.add(kind); else expandedChecks.delete(kind); };
    list.dataset.expanded = String(expandedChecks.has(kind)); list.tabIndex = 0; list.setAttribute('role', 'button');
    list.setAttribute('aria-label', 'แตะเพื่อดูเงื่อนไขทั้งหมด'); list.setAttribute('aria-expanded', list.dataset.expanded);
    list.addEventListener('click', toggle); list.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }
}
type FlowNode = [key: string, icon: string, label: string, unit: string];
const FLOWS: Record<string, FlowNode[]> = {
  factory: [['crop-stock', 'crop', 'พืชผล', 'ล็อต'], ['available-batches', 'gear', 'แปรรูปได้', 'ชุด'], ['stock', 'box', 'สินค้า', 'หน่วย']],
  farm: [['fertility', 'F', 'ดิน', ''], ['harvest-today', 'crop', 'เก็บวันนี้', 'ล็อต'], ['crop-stock', 'box', 'คลัง', 'ล็อต']],
  market: [['crop-stock', 'crop', 'พืชผล', 'ล็อต'], ['workers', 'worker', 'คนขาย', 'คน'], ['cash', 'coin', 'เงิน', '']],
  shop: [['stock', 'box', 'สินค้า', 'หน่วย'], ['workers', 'worker', 'คนขาย', 'คน'], ['cash', 'coin', 'เงิน', '']],
};
/** A firm's work as one strip of icons and numbers: input → process → output. */
function decorateFlow(root: ParentNode) {
  const host = root.querySelector<HTMLElement>('#entity-content[data-card-kind]'); if (!host) return;
  const nodes = FLOWS[host.dataset.cardKind ?? '']; if (!nodes) return;
  const read = (key: string) => host.querySelector<HTMLElement>(`[data-context-metric="${key}"], [data-card-metric="${key}"]`);
  const values = nodes.map(([key]) => read(key)), signature = values.map(v => v?.dataset.value ?? '').join('|');
  const hero = host.querySelector<HTMLElement>('.bc-hero'); if (!hero || values.every(v => !v)) return;
  const old = host.querySelector<HTMLElement>(':scope > .flow-strip'); if (old?.dataset.signature === signature) return;
  const strip = document.createElement('div'); strip.className = 'flow-strip'; strip.dataset.signature = signature; strip.setAttribute('role', 'img');
  const parts: string[] = [];
  nodes.forEach(([, icon, label, unit], i) => {
    const card = values[i]; if (!card) return;
    const text = card.querySelector('dd')?.textContent?.trim() ?? '';
    const raw = Number(card.dataset.value), money = card.classList.contains('money');
    const shown = money && Number.isFinite(raw) ? `${Math.round(raw / 100).toLocaleString('th-TH')} ฿` : text.split(/\s/)[0];
    if (strip.children.length) { const arrow = document.createElement('span'); arrow.className = 'flow-arrow'; arrow.textContent = '›'; arrow.setAttribute('aria-hidden', 'true'); strip.append(arrow); }
    const node = document.createElement('div'); node.className = `flow-node${card.classList.contains('money') ? ' money' : ''}`;
    const num = document.createElement('b'); num.textContent = shown; const cap = document.createElement('small'); cap.textContent = unit ? `${label} (${unit})` : label;
    node.append(iconElement(icon, 'ui-icon flow-icon'), num, cap); strip.append(node); parts.push(`${label} ${text}`);
  });
  strip.setAttribute('aria-label', parts.join(' → '));
  if (old) old.replaceWith(strip); else hero.after(strip);
}
/** Where household members work: workplace icon + skill icon lead, the sentence folds behind ⓘ. */
function decorateWork(root: ParentNode) {
  for (const row of root.querySelectorAll<HTMLElement>('.cx-employment-row:not([data-decor]), .cx-owner-labor-row:not([data-decor])')) {
    row.dataset.decor = '';
    const owner = row.classList.contains('cx-owner-labor-row'), place = owner ? 'market' : row.dataset.occupation === 'manufacturing' ? 'I' : 'shop';
    const lead = document.createElement('span'); lead.className = 'work-icons';
    lead.append(iconElement(place, `ui-icon work-place zone-${place}`), iconElement(row.dataset.skill ?? 'general', 'ui-icon work-skill'));
    row.prepend(lead);
    const detail = row.querySelector<HTMLElement>(':scope > span:not(.work-icons)'); if (!detail) continue;
    row.title = detail.textContent ?? '';
    let host = row.parentElement?.closest<HTMLElement>(HOSTS) ?? null, heading: HTMLElement | null = null;
    while (host && !(heading = host.querySelector<HTMLElement>(HEADINGS))) host = host.parentElement?.closest<HTMLElement>(HOSTS) ?? null;
    if (host && heading) { detail.classList.add('info-note'); infoButton(host, heading, detail); }
  }
}
const SECTION_ICONS: readonly [RegExp, string][] = [
  [/ตรวจ/, 'info'], [/ยอดและจำนวน/, 'overview'], [/ที่พัก|ความจุ|พักอยู่/, 'household'], [/ทักษะ|ความสามารถ/, 'general'],
  [/เพาะปลูก/, 'F'], [/เก็บเกี่ยว|พืชผล/, 'crop'], [/วัตถุดิบ|แปรรูป|ขยายโรงงาน/, 'gear'], [/สินค้า/, 'box'],
  [/เจ้าของ/, 'market'], [/เงิน|ทุน|บัญชี|คลัง/, 'coin'], [/ครัวเรือน/, 'people'], [/สมาชิก|แรงงาน/, 'worker'],
];
/** Each section heading leads with an icon of what it is about. */
function decorateSections(root: ParentNode) {
  for (const h3 of root.querySelectorAll<HTMLElement>('.cx-section > .cx-section-head > h3, .cx-section > h3, .growth-section > h3')) {
    if (h3.querySelector(':scope > .section-icon')) continue;
    const name = SECTION_ICONS.find(([pattern]) => pattern.test(h3.textContent ?? ''))?.[1]; if (name) h3.prepend(iconElement(name, 'ui-icon section-icon'));
  }
}
export function decoratePanels(root: ParentNode) { decorateSections(root); decorateFlow(root); decorateWork(root); decorateMetrics(root); decorateNotes(root); decoratePeople(root); decorateHousing(root); foldZeros(root); decorateChecklists(root); }

/** Re-decorate whenever panel content is replaced; batched to one pass per frame. */
export function watchPanels(...roots: (HTMLElement | null)[]) {
  let queued = false;
  const run = () => { queued = false; for (const root of roots) if (root) decoratePanels(root); };
  const observer = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  for (const root of roots) if (root) observer.observe(root, { childList: true, subtree: true });
  run();
}
