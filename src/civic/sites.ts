/**
 * City services and places the treasury builds: clinic, police and fire stations, library, temple and
 * football stadium. Each serves homes within a
 * walking radius and adds to their happiness. Pure data + validation with no sim.ts import, so sim.ts
 * can depend on it without a cycle. Stored only in the optional `city.civic` save section: a city that
 * never builds one keeps a byte-identical save.
 */
export const CIVIC_KINDS = ['clinic', 'police', 'fire', 'library', 'temple', 'stadium'] as const;
export type CivicKind = typeof CIVIC_KINDS[number];
export type CivicSite = { id: number; cell: number; kind: CivicKind; tick: number };
export type CivicState = { version: 1; rules: 'civic-1'; sites: CivicSite[] };

/** Money in satang. `radius` is Manhattan cells from the site; `points` is happiness for a covered home. */
export const CIVIC = Object.freeze({
  clinic: Object.freeze({ label: 'สถานีอนามัย', cost: 250_000, upkeep: 6_000, radius: 7, points: 5 }),
  police: Object.freeze({ label: 'สถานีตำรวจ', cost: 300_000, upkeep: 8_000, radius: 8, points: 5 }),
  fire: Object.freeze({ label: 'สถานีดับเพลิง', cost: 300_000, upkeep: 8_000, radius: 8, points: 5 }),
  library: Object.freeze({ label: 'ห้องสมุด', cost: 150_000, upkeep: 4_000, radius: 6, points: 4 }),
  temple: Object.freeze({ label: 'วัด', cost: 200_000, upkeep: 3_000, radius: 7, points: 5 }),
  stadium: Object.freeze({ label: 'สนามฟุตบอล', cost: 800_000, upkeep: 20_000, radius: 12, points: 8 }),
} satisfies Record<CivicKind, { label: string; cost: number; upkeep: number; radius: number; points: number }>);
export const MAX_CIVIC_SITES = 20;
/** Ledger reasons stay English like every other journal reason; panels translate them. */
export const CIVIC_REASON_NAMES: Record<CivicKind, string> = { clinic: 'clinic', police: 'police station', fire: 'fire station', library: 'library', temple: 'temple', stadium: 'football stadium' };
export const civicBuildReason = (kind: CivicKind, id: number) => `Build ${CIVIC_REASON_NAMES[kind]} #${id}`;
export const civicUpkeepReason = (kind: CivicKind, id: number) => `Monthly ${CIVIC_REASON_NAMES[kind]} upkeep #${id}`;

export const isCivicKind = (value: string): value is CivicKind => (CIVIC_KINDS as readonly string[]).includes(value);
export const createCivic = (): CivicState => ({ version: 1, rules: 'civic-1', sites: [] });
type Host = { civic?: CivicState };
export const civicAt = (c: Host, i: number): CivicSite | undefined => c.civic?.sites.find(s => s.cell === i);

/** Which kinds reach a home; `distance` is supplied by the caller so this module stays map-free. */
export function civicCoverage(c: Host, cell: number, distance: (a: number, b: number) => number): Record<CivicKind, boolean> {
  const covered = Object.fromEntries(CIVIC_KINDS.map(kind => [kind, false])) as Record<CivicKind, boolean>;
  for (const site of c.civic?.sites ?? []) if (!covered[site.kind] && distance(cell, site.cell) <= CIVIC[site.kind].radius) covered[site.kind] = true;
  return covered;
}
export const civicPoints = (covered: Record<CivicKind, boolean>) => CIVIC_KINDS.reduce((n, kind) => n + (covered[kind] ? CIVIC[kind].points : 0), 0);

/** Facts the validator needs from the city, supplied by sim.ts (keeps this module City-free). */
export type CivicValidationView = {
  cells: readonly { road: boolean; zone: unknown; building: number | null }[];
  tick: number; nextId: number;
  /** Cells and ids already held by parks, plants, campuses, taxi and bus sites. */
  otherCells: ReadonlySet<number>; otherIds: ReadonlySet<number>;
};
/** Throws on any malformed or conflicting civic section. Runs only when `civic` is present. */
export function validateCivic(value: unknown, view: CivicValidationView): asserts value is CivicState {
  const fail = (why: string): never => { throw new Error(`Invalid civic save: ${why}`); };
  const s = value as CivicState;
  if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).sort().join(',') !== 'rules,sites,version' || s.version !== 1 || s.rules !== 'civic-1' || !Array.isArray(s.sites)) fail('envelope');
  if (s.sites.length > MAX_CIVIC_SITES) fail('too many sites');
  const ids = new Set<number>(), cells = new Set<number>();
  for (const site of s.sites) {
    if (!site || typeof site !== 'object' || Object.keys(site).sort().join(',') !== 'cell,id,kind,tick') fail('site fields');
    if (!CIVIC_KINDS.includes(site.kind)) fail('site kind');
    if (!Number.isSafeInteger(site.id) || site.id < 1 || site.id >= view.nextId || ids.has(site.id) || view.otherIds.has(site.id)) fail('site id');
    if (!Number.isSafeInteger(site.cell) || site.cell < 0 || site.cell >= view.cells.length || cells.has(site.cell) || view.otherCells.has(site.cell)) fail('site cell');
    const cell = view.cells[site.cell];
    if (cell.road || cell.zone !== null || cell.building !== null) fail('site overlaps road, zone or building');
    if (!Number.isSafeInteger(site.tick) || site.tick < 0 || site.tick > view.tick) fail('site tick');
    ids.add(site.id); cells.add(site.cell);
  }
}
