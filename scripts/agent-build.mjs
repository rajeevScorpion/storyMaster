#!/usr/bin/env node
/**
 * Production build into a private directory (.next-verify by default).
 *
 * `next build` and `next dev` both write `.next`, and on Windows they do not fail
 * cleanly when they collide — the build stalls indefinitely with no output. Building
 * somewhere else removes the collision instead of scheduling around it, so a build
 * can be run without stopping anyone's dev server.
 *
 *   node scripts/agent-build.mjs
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, restore } from './lib/preserve-generated.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = process.env.AGENT_BUILD_DIST_DIR || '.next-verify';

console.log(`building into ${DIST_DIR}/ (leaves .next untouched)\n`);

// Next rewrites next-env.d.ts and tsconfig.json to point at the active distDir.
// Both are tracked, so capture them first and put them back however this ends.
const saved = snapshot();
const putBack = () => {
  const restored = restore(saved);
  if (restored.length) console.log(`
restored generated file(s): ${restored.join(', ')}`);
};
process.on('SIGINT', () => { putBack(); process.exit(130); });
process.on('SIGTERM', () => { putBack(); process.exit(143); });

const child = spawn(
  process.execPath,
  [join('node_modules', 'next', 'dist', 'bin', 'next'), 'build'],
  {
    cwd: ROOT,
    env: { ...process.env, NEXT_DIST_DIR: DIST_DIR },
    stdio: 'inherit',
    windowsHide: true,
  },
);

child.on('exit', (code) => { putBack(); process.exit(code ?? 1); });
