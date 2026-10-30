/** Conflict quadrants for right-hand traffic on the existing 24-column grid.
 * Bits clockwise from NW: NW, NE, SE, SW. Opposite straight movements occupy
 * disjoint halves; crossing/merging movements share at least one resource.
 * Each resource supplies service time, never additional downstream storage.
 */
export function movementMask(from: number, node: number, to: number): number {
  const sides = [-24, 1, 24, -1];
  const incoming = sides.indexOf(from - node), outgoing = sides.indexOf(to - node);
  if (incoming < 0 || outgoing < 0) throw Error('Junction movement must join adjacent roads');
  const turn = (outgoing - incoming + 4) % 4;
  // From north: right exits west via NW; straight via NW+SW; left via NW+SW+SE.
  // U-turns use all quadrants. Direction legality remains the road graph's job.
  const count = turn === 3 ? 1 : turn === 2 ? 2 : turn === 1 ? 3 : 4;
  let mask = 0;
  for (let step = 0; step < count; step++) mask |= 1 << ((incoming - step + 4) % 4);
  return mask;
}
