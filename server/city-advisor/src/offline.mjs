import { readFile, writeFile } from 'node:fs/promises';
import { buildLocalReport } from './server.mjs';

// Pure operator harness: no listener, env-file access, authentication or network.
try {
  const args = process.argv.slice(2);
  if (![1, 3].includes(args.length) || (args.length === 3 && args[1] !== '--out')) throw new Error('Usage');
  const bytes = await readFile(args[0]);
  if (bytes.length > 16 * 1024) throw new Error('Size');
  const report = buildLocalReport(JSON.parse(bytes.toString('utf8')));
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.length === 3) await writeFile(args[2], output, { flag: 'wx' });
  else process.stdout.write(output);
} catch {
  console.error('Offline report failed. Use: node src/offline.mjs INPUT.json [--out NEW_OUTPUT.json]. Input must match the bounded schema; output must not already exist.');
  process.exitCode = 1;
}
