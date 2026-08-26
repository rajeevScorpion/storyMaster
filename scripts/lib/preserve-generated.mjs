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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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

/**
 * Persist a snapshot so a *later* process can restore it. The dev server is detached
 * and long-lived: whoever stops it is not the process that started it, and by then the
 * files on disk are already repointed — so snapshotting at stop time captures the
 * pollution instead of the original.
 */
export function persist(saved, file) {
  const payload = {};
  for (const [abs, buf] of saved) payload[abs] = buf.toString('base64');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(payload));
}

/** Read back a persisted snapshot. Returns an empty map if there is none. */
export function loadPersisted(file) {
  const saved = new Map();
  try {
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    for (const [abs, b64] of Object.entries(payload)) saved.set(abs, Buffer.from(b64, 'base64'));
  } catch { /* no snapshot on disk */ }
  return saved;
}
