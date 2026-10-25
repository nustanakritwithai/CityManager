/**
 * Deterministic 3D layout for the city network: each group pulls toward a corner of a
 * tetrahedron, linked nodes pull together and every pair pushes apart. No randomness, so the
 * same graph always lands in the same shape.
 */
export type Vec3 = { x: number; y: number; z: number };
type LayoutNode = { id: string; group: string };
type LayoutEdge = { from: string; to: string };

const CORNERS: readonly Vec3[] = [
  { x: 0, y: 1, z: 0 },
  { x: 0.943, y: -0.333, z: 0 },
  { x: -0.471, y: -0.333, z: 0.816 },
  { x: -0.471, y: -0.333, z: -0.816 },
];

/** Small stable offset from the id so nodes of one group do not start on top of each other. */
function seed(id: string, index: number): Vec3 {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const a = (h % 6283) / 1000, b = ((h >>> 12) % 3141) / 1000;
  const r = 0.12 + (index % 3) * 0.04;
  return { x: r * Math.sin(b) * Math.cos(a), y: r * Math.cos(b), z: r * Math.sin(b) * Math.sin(a) };
}

export function layoutNetwork(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], groups: readonly string[], iterations = 420): Record<string, Vec3> {
  const anchor = new Map(groups.map((g, i) => [g, CORNERS[i % CORNERS.length]]));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const p = nodes.map((n, i) => { const a = anchor.get(n.group) ?? CORNERS[0], o = seed(n.id, i); return { x: a.x * 0.7 + o.x, y: a.y * 0.7 + o.y, z: a.z * 0.7 + o.z }; });
  const links = edges.map(e => [index.get(e.from), index.get(e.to)]).filter((l): l is [number, number] => l[0] !== undefined && l[1] !== undefined);
  for (let step = 0; step < iterations; step++) {
    const heat = 0.06 * (1 - step / iterations) + 0.004;
    const f = p.map(() => ({ x: 0, y: 0, z: 0 }));
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      const dx = p[i].x - p[j].x, dy = p[i].y - p[j].y, dz = p[i].z - p[j].z, d2 = dx * dx + dy * dy + dz * dz + 1e-4, d = Math.sqrt(d2);
      const push = 0.02 / d2;
      f[i].x += dx / d * push; f[i].y += dy / d * push; f[i].z += dz / d * push;
      f[j].x -= dx / d * push; f[j].y -= dy / d * push; f[j].z -= dz / d * push;
    }
    for (const [a, b] of links) {
      const dx = p[b].x - p[a].x, dy = p[b].y - p[a].y, dz = p[b].z - p[a].z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
      const pull = (d - 0.62) * 0.03;
      f[a].x += dx / d * pull; f[a].y += dy / d * pull; f[a].z += dz / d * pull;
      f[b].x -= dx / d * pull; f[b].y -= dy / d * pull; f[b].z -= dz / d * pull;
    }
    nodes.forEach((n, i) => {
      const a = anchor.get(n.group) ?? CORNERS[0];
      f[i].x += (a.x * 0.8 - p[i].x) * 0.035; f[i].y += (a.y * 0.8 - p[i].y) * 0.035; f[i].z += (a.z * 0.8 - p[i].z) * 0.035;
    });
    for (let i = 0; i < p.length; i++) {
      const m = Math.hypot(f[i].x, f[i].y, f[i].z), k = m > heat ? heat / m : 1;
      p[i].x += f[i].x * k; p[i].y += f[i].y * k; p[i].z += f[i].z * k;
    }
  }
  // Centre and scale so the farthest node sits on the unit sphere.
  const c = p.reduce((s, v) => ({ x: s.x + v.x / p.length, y: s.y + v.y / p.length, z: s.z + v.z / p.length }), { x: 0, y: 0, z: 0 });
  const r = Math.max(1e-6, ...p.map(v => Math.hypot(v.x - c.x, v.y - c.y, v.z - c.z)));
  return Object.fromEntries(nodes.map((n, i) => [n.id, { x: (p[i].x - c.x) / r, y: (p[i].y - c.y) / r, z: (p[i].z - c.z) / r }]));
}
