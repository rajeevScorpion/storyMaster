import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A *running* dev server keeps repointing `next-env.d.ts` and `tsconfig.json` at its
 * own distDir as it compiles each newly-visited route — so restoring them once at
 * startup is not enough, and an e2e run that visits new routes leaves both tracked
 * files dirty. Snapshot before the suite, restore after it.
 *
 * This duplicates the few lines in scripts/lib/preserve-generated.mjs rather than
 * importing it: Playwright loads config and setup files through its own TypeScript
 * loader, which cannot consume that ESM module (`import.meta` outside a module).
 *
 * Playwright runs the function returned from globalSetup as the global teardown.
 */
const GENERATED = ['next-env.d.ts', 'tsconfig.json'];

export default async function globalSetup() {
  const root = process.cwd();
  const saved = new Map<string, Buffer>();
  for (const rel of GENERATED) {
    const abs = join(root, rel);
    if (existsSync(abs)) saved.set(abs, readFileSync(abs));
  }

  return async () => {
    const restored: string[] = [];
    for (const [abs, before] of saved) {
      try {
        if (!existsSync(abs) || !readFileSync(abs).equals(before)) {
          writeFileSync(abs, before);
          restored.push(abs.slice(root.length + 1));
        }
      } catch { /* best effort — never fail a green run over this */ }
    }
    if (restored.length) console.log(`restored generated file(s): ${restored.join(', ')}`);
  };
}
