/**
 * City services and places the treasury builds: clinic, police and fire stations, library, temple,
 * football stadium and airport. Most serve homes within a
 * walking radius and adds to their happiness. Pure data + validation with no sim.ts import, so sim.ts
 * can depend on it without a cycle. Stored only in the optional `city.civic` save section: a city that
 * never builds one keeps a byte-identical save.
 */
export const CIVIC_KINDS = ['clinic', 'police', 'fire', 'library', 'temple', 'stadium', 'airport', 'hospital', 'museum', 'amusement', 'cinema', 'restaurant', 'nightmarket', 'concert'] as const;
export type CivicKind = typeof CIVIC_KINDS[number];
/** `cell` is the top-left parcel. `cells` lists the whole footprint, top-left first, and is present only on sites larger than one parcel. */
export type CivicAllocation = { householdId: number; skill: 'general' | 'manufacturing' | 'retail'; workers: number };
/** Who works at a staffed venue today, and the days each wallet has earned and not yet been paid for. */
export type CivicStaffing = { allocations: CivicAllocation[]; workDays: Record<string, number> };
/** A household that leases a venue from the city: it keeps the takings, pays its staff daily and the city a monthly rent. */
export type CivicOperator = { householdId: number; since: number };
export type CivicSite = { id: number; cell: number; kind: CivicKind; tick: number; cells?: number[]; staffing?: CivicStaffing; operator?: CivicOperator };
export type CivicState = { version: 1; rules: 'civic-1'; sites: CivicSite[] };

/**
 * Money in satang. `radius` is Manhattan cells from the nearest parcel of the site; `points` is happiness for a covered home.
 * `footprint` is [columns, rows] and defaults to one parcel. `visitors` is monthly income from outside: a base plus an
 * amount per attraction in the city. `staff` makes the kind a venue: it hires residents for a daily wage, serves
 * `visitsPerWorker` households a day for `fee` each, and gives its happiness only while someone works there.
 */
export type CivicSpec = { label: string; cost: number; upkeep: number; radius: number; points: number; footprint?: readonly [number, number]; visitors?: { base: number; perAttraction: number }; staff?: { slots: number; dailyWage: number; fee: number; visitsPerWorker: number } };
export const CIVIC = Object.freeze({
  clinic: Object.freeze({ label: 'สถานีอนามัย', cost: 250_000, upkeep: 6_000, radius: 7, points: 5 }),
  police: Object.freeze({ label: 'สถานีตำรวจ', cost: 300_000, upkeep: 8_000, radius: 8, points: 5 }),
  fire: Object.freeze({ label: 'สถานีดับเพลิง', cost: 300_000, upkeep: 8_000, radius: 8, points: 5 }),
  library: Object.freeze({ label: 'ห้องสมุด', cost: 150_000, upkeep: 4_000, radius: 6, points: 4 }),
  temple: Object.freeze({ label: 'วัด', cost: 200_000, upkeep: 3_000, radius: 7, points: 5 }),
  stadium: Object.freeze({ label: 'สนามฟุตบอล', cost: 800_000, upkeep: 20_000, radius: 12, points: 8, footprint: [2, 2] as const }),
  airport: Object.freeze({ label: 'สนามบิน', cost: 2_000_000, upkeep: 50_000, radius: 0, points: 0, footprint: [3, 2] as const, visitors: Object.freeze({ base: 50_000, perAttraction: 30_000 }) }),
  hospital: Object.freeze({ label: 'โรงพยาบาล', cost: 1_200_000, upkeep: 30_000, radius: 14, points: 8, footprint: [2, 2] as const }),
  museum: Object.freeze({ label: 'พิพิธภัณฑ์', cost: 400_000, upkeep: 8_000, radius: 8, points: 4 }),
  amusement: Object.freeze({ label: 'สวนสนุก', cost: 1_000_000, upkeep: 25_000, radius: 12, points: 7, footprint: [2, 2] as const }),
  cinema: Object.freeze({ label: 'โรงภาพยนตร์', cost: 350_000, upkeep: 6_000, radius: 8, points: 5, staff: Object.freeze({ slots: 3, dailyWage: 1_400, fee: 600, visitsPerWorker: 3 }) }),
  restaurant: Object.freeze({ label: 'ร้านอาหาร', cost: 180_000, upkeep: 3_000, radius: 6, points: 4, staff: Object.freeze({ slots: 2, dailyWage: 1_400, fee: 500, visitsPerWorker: 4 }) }),
  nightmarket: Object.freeze({ label: 'ตลาดกลางคืน', cost: 300_000, upkeep: 5_000, radius: 9, points: 5, staff: Object.freeze({ slots: 4, dailyWage: 1_400, fee: 400, visitsPerWorker: 4 }) }),
  concert: Object.freeze({ label: 'ลานคอนเสิร์ต', cost: 900_000, upkeep: 15_000, radius: 12, points: 7, footprint: [2, 2] as const, staff: Object.freeze({ slots: 4, dailyWage: 1_400, fee: 900, visitsPerWorker: 3 }) }),
} satisfies Record<CivicKind, CivicSpec>);
export const MAX_CIVIC_SITES = 32;
/** Ledger reasons stay English like every other journal reason; panels translate them. */
export const CIVIC_REASON_NAMES: Record<CivicKind, string> = { clinic: 'clinic', police: 'police station', fire: 'fire station', library: 'library', temple: 'temple', stadium: 'football stadium', airport: 'airport', hospital: 'hospital', museum: 'museum', amusement: 'amusement park', cinema: 'cinema', restaurant: 'restaurant', nightmarket: 'night market', concert: 'concert ground' };
export const civicBuildReason = (kind: CivicKind, id: number) => `Build ${CIVIC_REASON_NAMES[kind]} #${id}`;
export const civicUpkeepReason = (kind: CivicKind, id: number) => `Monthly ${CIVIC_REASON_NAMES[kind]} upkeep #${id}`;
export const civicVisitorsReason = (id: number) => `Airport visitors #${id}`;
export const civicWageReason = (kind: CivicKind, id: number) => `Monthly ${CIVIC_REASON_NAMES[kind]} wages #${id}`;
export const civicFeeReason = (kind: CivicKind, id: number) => `Visit ${CIVIC_REASON_NAMES[kind]} #${id}`;
const VENUE_NAMES = () => CIVIC_KINDS.filter(kind => civicSpec(kind).staff).map(kind => CIVIC_REASON_NAMES[kind]).join('|');
export const isCivicWageReason = (reason: string) => new RegExp(`^(?:Monthly|Daily) (${VENUE_NAMES()}) wages #[1-9]\\d*$`).test(reason);
/** A leased venue pays its staff each day from the operator's wallet. */
export const civicDailyWageReason = (kind: CivicKind, id: number) => `Daily ${CIVIC_REASON_NAMES[kind]} wages #${id}`;
export const civicRentReason = (kind: CivicKind, id: number) => `Monthly ${CIVIC_REASON_NAMES[kind]} rent #${id}`;
/** A household needs this much to take on a venue: ten days of wages for every post. */
export const civicLeaseCapital = (kind: CivicKind) => { const staff = civicSpec(kind).staff; return staff ? staff.slots * staff.dailyWage * 10 : 0; };
/** Kinds visitors come for; parks count too, and the caller adds them. */
export const CIVIC_ATTRACTIONS: readonly CivicKind[] = ['library', 'temple', 'stadium', 'museum', 'amusement', 'cinema', 'restaurant', 'nightmarket', 'concert'];
export const civicSpec = (kind: CivicKind): CivicSpec => CIVIC[kind];
export const civicFootprint = (kind: CivicKind): readonly [number, number] => civicSpec(kind).footprint ?? [1, 1];
/** Every parcel a site stands on. */
export const civicCells = (site: CivicSite): readonly number[] => site.cells ?? [site.cell];
export const civicWorkers = (site: CivicSite): number => site.staffing?.allocations.reduce((n, a) => n + a.workers, 0) ?? 0;
/** Wages earned at a venue and not yet paid. */
export const civicPayroll = (site: CivicSite): number => Object.values(site.staffing?.workDays ?? {}).reduce((n, days) => n + days, 0) * (civicSpec(site.kind).staff?.dailyWage ?? 0);
/** A venue is open while at least one resident works there; every other kind is always open. */
export const civicOpen = (site: CivicSite): boolean => !civicSpec(site.kind).staff || civicWorkers(site) > 0;
/** Households a venue can serve today. */
export const civicDailyVisits = (site: CivicSite): number => civicWorkers(site) * (civicSpec(site.kind).staff?.visitsPerWorker ?? 0);
/** Monthly income of one airport given how many attractions the city has. */
export const civicVisitorIncome = (kind: CivicKind, attractions: number) => { const v = civicSpec(kind).visitors; return v ? v.base + v.perAttraction * Math.max(0, attractions) : 0; };

export const isCivicKind = (value: string): value is CivicKind => (CIVIC_KINDS as readonly string[]).includes(value);
export const createCivic = (): CivicState => ({ version: 1, rules: 'civic-1', sites: [] });
type Host = { civic?: CivicState };
export const civicAt = (c: Host, i: number): CivicSite | undefined => c.civic?.sites.find(s => s.cell === i || !!s.cells?.includes(i));

/** Which kinds reach a home; `distance` is supplied by the caller so this module stays map-free. */
export function civicCoverage(c: Host, cell: number, distance: (a: number, b: number) => number): Record<CivicKind, boolean> {
  const covered = Object.fromEntries(CIVIC_KINDS.map(kind => [kind, false])) as Record<CivicKind, boolean>;
  for (const site of c.civic?.sites ?? []) if (!covered[site.kind] && civicSpec(site.kind).points > 0 && civicOpen(site) && civicCells(site).some(part => distance(cell, part) <= civicSpec(site.kind).radius)) covered[site.kind] = true;
  return covered;
}
/** Services and places together add at most this much to a home's target, so a city cannot buy full happiness with buildings alone. */
export const CIVIC_POINTS_CAP = 30;
export const civicPoints = (covered: Record<CivicKind, boolean>) => Math.min(CIVIC_POINTS_CAP, CIVIC_KINDS.reduce((n, kind) => n + (covered[kind] ? CIVIC[kind].points : 0), 0));

/** Facts the validator needs from the city, supplied by sim.ts (keeps this module City-free). */
export type CivicValidationView = {
  cells: readonly { road: boolean; zone: unknown; building: number | null }[];
  tick: number; nextId: number;
  /** The parcels a kind covers from a top-left parcel on this map, or null when it would leave the map. */
  footprint: (kind: CivicKind, anchor: number) => number[] | null;
  /** Cells and ids already held by parks, plants, campuses, taxi and bus sites. */
  otherCells: ReadonlySet<number>; otherIds: ReadonlySet<number>;
  /** Households that exist now; a venue's operator must be one of them. */
  householdIds?: ReadonlySet<number>;
};
/** Throws on any malformed or conflicting civic section. Runs only when `civic` is present. */
export function validateCivic(value: unknown, view: CivicValidationView): asserts value is CivicState {
  const fail = (why: string): never => { throw new Error(`Invalid civic save: ${why}`); };
  const s = value as CivicState;
  if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).sort().join(',') !== 'rules,sites,version' || s.version !== 1 || s.rules !== 'civic-1' || !Array.isArray(s.sites)) fail('envelope');
  if (s.sites.length > MAX_CIVIC_SITES) fail('too many sites');
  const ids = new Set<number>(), cells = new Set<number>(), operators = new Set<number>();
  for (const site of s.sites) {
    const keys = site && typeof site === 'object' ? Object.keys(site).sort().join(',') : '';
    const optional = keys.split(',').filter(key => !['cell', 'id', 'kind', 'tick'].includes(key));
    if (!['cell', 'id', 'kind', 'tick'].every(key => keys.split(',').includes(key)) || optional.some(key => !['cells', 'staffing', 'operator'].includes(key))) fail('site fields');
    if (!CIVIC_KINDS.includes(site.kind)) fail('site kind');
    if (site.staffing !== undefined) {
      const staff = civicSpec(site.kind).staff, st = site.staffing, int = (n: unknown, min: number) => Number.isSafeInteger(n) && (n as number) >= min;
      if (!staff || !st || typeof st !== 'object' || Object.keys(st).sort().join(',') !== 'allocations,workDays' || !Array.isArray(st.allocations) || !st.workDays || typeof st.workDays !== 'object' || Array.isArray(st.workDays)) fail('site staffing');
      const pairs = new Set<string>();
      for (const a of st.allocations) {
        if (!a || typeof a !== 'object' || Object.keys(a).sort().join(',') !== 'householdId,skill,workers' || !int(a.householdId, 1) || !int(a.workers, 1) || !['general', 'manufacturing', 'retail'].includes(a.skill) || pairs.has(`${a.householdId}:${a.skill}`)) fail('site staffing');
        pairs.add(`${a.householdId}:${a.skill}`);
      }
      if (civicWorkers(site) > staff!.slots) fail('site staffing');
      for (const [wallet, days] of Object.entries(st.workDays)) if (!/^household:[1-9]\d*$/.test(wallet) || !int(days, 1)) fail('site staffing');
      if (Object.values(st.workDays).reduce((n, days) => n + days, 0) > staff!.slots * Math.max(0, view.tick - site.tick)) fail('site staffing');
      // A leased venue pays each day, so it never carries unpaid days.
      if (site.operator !== undefined && Object.keys(st.workDays).length) fail('site staffing');
    }
    if (site.operator !== undefined) {
      const op = site.operator;
      if (!civicSpec(site.kind).staff || !op || typeof op !== 'object' || Object.keys(op).sort().join(',') !== 'householdId,since' || !Number.isSafeInteger(op.householdId) || op.householdId < 1 || !Number.isSafeInteger(op.since) || op.since < site.tick || op.since > view.tick) fail('site operator');
      if (view.householdIds && !view.householdIds.has(op.householdId)) fail('site operator');
      if (operators.has(op.householdId)) fail('site operator');
      operators.add(op.householdId);
    }
    if (!Number.isSafeInteger(site.id) || site.id < 1 || site.id >= view.nextId || ids.has(site.id) || view.otherIds.has(site.id)) fail('site id');
    // A site without `cells` is one parcel: every kind was, before larger footprints existed, so old stadiums stay valid.
    const footprint = site.cells === undefined ? [site.cell] : view.footprint(site.kind, site.cell);
    if (site.cells !== undefined && (!Array.isArray(site.cells) || !footprint || footprint.length < 2 || site.cells.length !== footprint.length || site.cells.some((part, n) => part !== footprint[n]))) fail('site footprint');
    if (site.cells === undefined && civicSpec(site.kind).visitors) fail('site footprint');
    for (const part of footprint!) {
      if (!Number.isSafeInteger(part) || part < 0 || part >= view.cells.length || cells.has(part) || view.otherCells.has(part)) fail('site cell');
      const cell = view.cells[part];
      if (cell.road || cell.zone !== null || cell.building !== null) fail('site overlaps road, zone or building');
    }
    if (!Number.isSafeInteger(site.tick) || site.tick < 0 || site.tick > view.tick) fail('site tick');
    ids.add(site.id); for (const part of footprint!) cells.add(part);
  }
}
