import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const inside = (root, candidate) => {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};

// Resolve both the root and the requested file before checking containment.
// This also rejects a link inside the root which points to a sibling directory.
export function safeFile(root, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') ||
      pathname.includes('\\') || pathname.includes('\0') ||
      pathname.split('/').some(part => part === '.' || part === '..')) return null;
  try {
    const canonicalRoot = realpathSync(root);
    const candidate = resolve(canonicalRoot, '.' + pathname);
    if (!inside(canonicalRoot, candidate)) return null;
    const canonicalFile = realpathSync(candidate);
    if (!inside(canonicalRoot, canonicalFile) || !statSync(canonicalFile).isFile()) return null;
    return canonicalFile;
  } catch {
    return null;
  }
}
