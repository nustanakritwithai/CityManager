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

const NOTES = '.dash-flow-list, .cx-detail-note, .cx-account-note, .sm-footnote, .parcel-note, .dash-note-line, .st-note, .cx-flow-meta';
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
    const signature = values.join(','), existing = host.querySelector<HTMLElement>(':scope > .people-picto');
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
    picto.append(visual, legend);
    // The figures already show these counts; their tiles move behind ⓘ (members and employed stay).
    const dups = ['workforce', 'dependents', 'unemployed'].map(key => host.querySelector<HTMLElement>(`[data-context-metric="${key}"]`)).filter((e): e is HTMLElement => !!e);
    const heading = host.querySelector<HTMLElement>(HEADINGS); if (heading) infoButton(host, heading, ...dups);
    if (existing) existing.replaceWith(picto);
    else { const head = host.querySelector(':scope > .cx-section-head, :scope > h3'); head ? head.after(picto) : host.prepend(picto); }
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
export function decoratePanels(root: ParentNode) { decorateMetrics(root); decorateNotes(root); decoratePeople(root); decorateHousing(root); foldZeros(root); }

/** Re-decorate whenever panel content is replaced; batched to one pass per frame. */
export function watchPanels(...roots: (HTMLElement | null)[]) {
  let queued = false;
  const run = () => { queued = false; for (const root of roots) if (root) decoratePanels(root); };
  const observer = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  for (const root of roots) if (root) observer.observe(root, { childList: true, subtree: true });
  run();
}
