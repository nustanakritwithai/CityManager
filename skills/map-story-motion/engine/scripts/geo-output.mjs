import { lstatSync, mkdirSync, mkdtempSync, realpathSync, linkSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';
import { safeOutputName } from './output-files.mjs';

export function geoDirectory(storyDir) {
  const root = realpathSync(storyDir);
  const dir = join(root, 'geo');
  try { mkdirSync(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('geo directory must not be a symlink');
  const actual = realpathSync(dir), rel = relative(root, actual);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('geo directory escapes story');
  return actual;
}

// Mapshaper writes into a fresh directory; the final name is installed only if
// it does not exist. No prior output or symlink is ever replaced.
export function buildGeoFile(storyDir, src, generate) {
  const name = safeOutputName(src);
  const dir = geoDirectory(storyDir), target = join(dir, name + '.json');
  try { lstatSync(target); throw new Error('geo output already exists'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const work = mkdtempSync(join(dir, '.geo-build-')), tmp = join(work, 'result.json');
  try { generate(tmp); linkSync(tmp, target); return target; }
  finally {
    try { unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    rmdirSync(work);
  }
}
