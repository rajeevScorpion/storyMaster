/**
 * Next rewrites two *tracked* files to point at whatever distDir it is currently
 * building into: `next-env.d.ts` (its /// <reference path> to <distDir>/types/routes.d.ts)
 * and `tsconfig.json` (its `include` list, which it also reformats).
 *
 * That is harmless when everyone uses `.next`, but agent tooling builds into
 * `.next-verify` / `.next-agent` — so without this, every agent build leaves the
 * developer's working tree dirty and can point tsc at a directory that does not
 * exist on their machine, breaking `npx tsc --noEmit`.
 *
 * Contract: agent tooling never modifies a tracked file as a side effect.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATED = ['next-env.d.ts', 'tsconfig.json'];

export function snapshot() {
  const saved = new Map();
  for (const rel of GENERATED) {
    const abs = join(ROOT, rel);
    if (existsSync(abs)) saved.set(abs, readFileSync(abs));
  }
  return saved;
}

/** Restore only what actually changed. Returns the list of restored files. */
export function restore(saved) {
  const restored = [];
  for (const [abs, before] of saved) {
    try {
      if (!existsSync(abs) || !readFileSync(abs).equals(before)) {
        writeFileSync(abs, before);
        restored.push(abs.slice(ROOT.length + 1).split(sep).join('/'));
      }
    } catch { /* best effort — never fail the caller over this */ }
  }
  return restored;
}

/** snapshot(), run fn, restore() no matter how fn ends. */
export async function preserving(fn) {
  const saved = snapshot();
  try {
    return await fn();
  } finally {
    const restored = restore(saved);
    if (restored.length) console.log(`restored generated file(s): ${restored.join(', ')}`);
  }
}
