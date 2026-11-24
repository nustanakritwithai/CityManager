/**
 * Big towns. A city started in the game with `tileScale: 10` puts ten times as much on every tile: a farm tile is
 * 1,000 rai instead of 100, a mill or a shop is ten times the size with ten times the staff, a home tile holds ten
 * times the households, and a water or power plant ten times the supply, as does the gate. What one person earns,
 * eats and pays is the real figure, so the town is the same real economy at ten times the size, and people come for
 * the ten times as many jobs. Cities without the field keep real single buildings.
 */
export const TILE_SCALE = 10;
export type TileRules = { tileScale?: number };
/** How many real buildings one tile of this city holds: 10 in a big town, else 1. Any other saved value counts as 1. */
export const tileScale = (c: TileRules | undefined): number => c?.tileScale === TILE_SCALE ? TILE_SCALE : 1;
