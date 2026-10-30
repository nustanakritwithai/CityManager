// Synthetic maximum 24×24 road grid; this is not a full-city frame-time benchmark.
import { performance } from 'node:perf_hooks';
import { buildNetwork } from '../src/traffic/network.ts';
import { linkTimes } from '../src/traffic/routing.ts';
import { travelTree, treeMinutes } from '../src/taxi/coverage.ts';

const size = 24, nodes = size * size;
const net = buildNetwork({ cells: Array.from({ length: nodes }, () => ({ road: true })) });
const times = linkTimes(net, new Map());
const samples = [];
// 192 distinct origins, 192 destinations per origin: cold tree creation then warm lookups.
for (let run = 0; run < 5; run++) {
  const trees = [], start = performance.now();
  for (let i = 0; i < 192; i++) trees.push(travelTree(net, times, (i * 3) % nodes));
  const built = performance.now();
  let checksum = 0;
  for (const tree of trees) for (let j = 0; j < 192; j++) checksum += treeMinutes(tree, (j * 3) % nodes);
  const end = performance.now();
  samples.push({ treeMs: +(built - start).toFixed(2), lookupMs: +(end - built).toFixed(2), checksum: +checksum.toFixed(3) });
}
console.log(JSON.stringify({ scenario: '24x24 all-road grid, 576 nodes, 192 distinct origins, 192 destinations each', links: net.links.size, node: process.version, platform: process.platform, arch: process.arch, samples }, null, 2));
