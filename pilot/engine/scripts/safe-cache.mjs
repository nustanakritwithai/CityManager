import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';

// Fixed and validated path components only; reject links and junctions at each level.
export function safeSubdirectory(root, components) {
  let current = realpathSync(root);
  for (const part of components) {
    if (typeof part !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(part) && part !== '.cache') throw new Error('invalid cache path');
    const next = join(current, part);
    try { mkdirSync(next); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const st = lstatSync(next);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('cache directory must not be a symlink');
    const actual = realpathSync(next), rel = relative(current, actual);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('cache directory escapes root');
    current = actual;
  }
  return current;
}
