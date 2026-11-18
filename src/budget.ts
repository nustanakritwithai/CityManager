/**
 * City budget: how much of the usual upkeep each department gets. Funding scales both the monthly bill and what the
 * service does (its reach and the happiness it adds). Stored only in the optional `city.budget` save section, and only
 * while some department is not at 100%, so a city that never touches the budget saves byte-identically.
 */
import type { CivicKind } from './civic/sites.ts';

export const BUDGET_DEPARTMENTS = ['parks', 'health', 'safety', 'culture'] as const;
export type BudgetDepartment = typeof BUDGET_DEPARTMENTS[number];
export const BUDGET_LEVELS = [50, 75, 100, 125, 150] as const;
export type BudgetLevel = typeof BUDGET_LEVELS[number];
export type BudgetState = { version: 1; levels: Partial<Record<BudgetDepartment, BudgetLevel>> };
export const BUDGET_LABELS: Record<BudgetDepartment, string> = { parks: 'สวนสาธารณะ', health: 'สาธารณสุข', safety: 'ความปลอดภัย', culture: 'วัฒนธรรมและสถานที่' };
/** Which department pays for each kind; kinds not listed (airport, entertainment venues) are outside the budget. */
export const DEPARTMENT_OF: Partial<Record<CivicKind, BudgetDepartment>> = {
  clinic: 'health', hospital: 'health', police: 'safety', fire: 'safety',
  library: 'culture', temple: 'culture', museum: 'culture', stadium: 'culture', amusement: 'culture',
};
export const MAX_BUDGET_LEVEL = 150;

type Host = { budget?: BudgetState };
export const budgetLevel = (c: Host, department: BudgetDepartment | undefined): BudgetLevel => department ? c.budget?.levels[department] ?? 100 : 100;
/** A value scaled by a department's funding, rounded; a reach never drops below one cell. */
export const funded = (value: number, level: number) => Math.round(value * level / 100);
export const fundedReach = (radius: number, level: number) => radius > 0 ? Math.max(1, funded(radius, level)) : 0;
export const isBudgetLevel = (value: unknown): value is BudgetLevel => (BUDGET_LEVELS as readonly unknown[]).includes(value);

/** Set one department's funding. Back at 100% everywhere, the section is removed again. */
export function setBudgetLevel(c: Host, department: BudgetDepartment, level: BudgetLevel): void {
  const levels = { ...c.budget?.levels };
  if (level === 100) delete levels[department]; else levels[department] = level;
  if (Object.keys(levels).length) c.budget = { version: 1, levels }; else delete c.budget;
}

/** Throws on a malformed budget section. Runs only when `budget` is present. */
export function validateBudget(value: unknown): asserts value is BudgetState {
  const fail = (why: string): never => { throw new Error(`Invalid budget save: ${why}`); };
  const s = value as BudgetState;
  if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).sort().join(',') !== 'levels,version' || s.version !== 1) fail('envelope');
  if (!s.levels || typeof s.levels !== 'object' || Array.isArray(s.levels)) fail('levels');
  const entries = Object.entries(s.levels);
  if (!entries.length) fail('empty levels');
  for (const [department, level] of entries) if (!(BUDGET_DEPARTMENTS as readonly string[]).includes(department) || !isBudgetLevel(level) || level === 100) fail('level');
}
