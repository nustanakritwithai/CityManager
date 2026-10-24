/** Pure road-tile choice; no PlayCanvas or simulation state. */
export type RoadTile = 'road-straight' | 'road-end' | 'road-corner' | 'road-tee' | 'road-cross' | 'road-crossing' | 'road-square';
export type Side = '+x' | '-z' | '-x' | '+z';
/** Sides in +90° Y-rotation order: rotating a tile by 90° maps each side to the next. */
export const SIDES: readonly Side[] = ['+x', '-z', '-x', '+z'];
/** Open (road-continuing) sides of each Kenney tile at rotation 0, measured from its geometry. */
export const TILE_OPEN: Readonly<Record<RoadTile, readonly Side[]>> = {
  'road-straight': ['+x', '-x'], 'road-crossing': ['+x', '-x'], 'road-end': ['+x'], 'road-corner': ['-x', '+z'],
  'road-tee': ['+x', '-x', '+z'], 'road-cross': ['+x', '-z', '-x', '+z'], 'road-square': [],
};
/** Picks the tile and Y rotation whose open sides match the parcel's real road neighbours. */
export function roadTileFor(open: ReadonlySet<Side>, cell: number): { tile: RoadTile; rotation: number } {
  const straight = open.size === 2 && (open.has('+x') && open.has('-x') || open.has('+z') && open.has('-z'));
  const tile: RoadTile = open.size === 0 ? 'road-square' : open.size === 1 ? 'road-end' : open.size === 3 ? 'road-tee' : open.size === 4 ? 'road-cross'
    : straight ? (cell % 9 === 4 ? 'road-crossing' : 'road-straight') : 'road-corner';
  for (let turn = 0; turn < 4; turn++) {
    const rotated = TILE_OPEN[tile].map(side => SIDES[(SIDES.indexOf(side) + turn) % 4]);
    if (rotated.length === open.size && rotated.every(side => open.has(side))) return { tile, rotation: turn * 90 };
  }
  return { tile, rotation: 0 };
}
