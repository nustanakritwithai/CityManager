/** Population milestones worth a celebration on the map. Presentation only. */
export const POPULATION_MILESTONES: readonly number[] = [25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000];
/** The highest milestone crossed going from `before` to `after` people, or null (a drop never celebrates). */
export function milestoneCrossed(before: number, after: number): number | null {
  if (!(after > before)) return null;
  let crossed: number | null = null;
  for (const m of POPULATION_MILESTONES) if (before < m && after >= m) crossed = m;
  return crossed;
}
/** How long the fireworks for a milestone last, in seconds. */
export const CELEBRATION_SECONDS = 10;
