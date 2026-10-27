import { lstatSync, mkdirSync, mkdtempSync, openSync, closeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export function safeOutputName(name) {
  if (typeof name !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]{0,79}$/u.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) throw new Error('output name must be a simple filename');
  return name;
}

export function newOutputDirectory(parent, prefix) {
  const root = resolve(parent);
  mkdirSync(root, { recursive: true });
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('output directory must not be a symlink');
  return mkdtempSync(join(root, prefix));
}

export function videoOutput(parent, name) {
  const safeName = safeOutputName(name);
  const dir = newOutputDirectory(parent, 'render-');
  return { dir, mp4: join(dir, safeName + '.mp4'), srt: join(dir, safeName + '.srt') };
}

export function muxOutput(clip) {
  const path = resolve(clip);
  if (!/\.mp4$/i.test(path)) throw new Error('mux input must be an MP4 file');
  const dir = newOutputDirectory(dirname(path), 'voice-');
  return join(dir, basename(path).replace(/\.mp4$/i, '-voice.mp4'));
}

export function withExclusiveOutput(path, write) {
  const fd = openSync(resolve(path), 'wx', 0o600);
  try { return write(fd); } finally { closeSync(fd); }
}
