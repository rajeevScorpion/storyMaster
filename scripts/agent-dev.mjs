#!/usr/bin/env node
/**
 * Agent-owned dev server.
 *
 * Runs Next on its own port AND its own build directory, so it can never collide
 * with the developer's `npm run dev` on port 3000 / `.next`. That collision is the
 * single worst trap in this repo: on Windows `next dev` and `next build` fight over
 * `.next`, and the build stalls silently with zero output rather than failing.
 * See docs/agent-context/GOTCHAS.md.
 *
 *   node scripts/agent-dev.mjs start    # start (idempotent), wait until it answers
 *   node scripts/agent-dev.mjs stop     # stop it and every child it spawned
 *   node scripts/agent-dev.mjs status   # is it up, on what pid/port
 *   node scripts/agent-dev.mjs restart
 *   node scripts/agent-dev.mjs logs [n] # tail the server log
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, restore, persist, loadPersisted } from './lib/preserve-generated.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(ROOT, '.agent');
const STATE_FILE = join(STATE_DIR, 'dev-server.json');
const LOG_FILE = join(STATE_DIR, 'dev-server.log');
const GENERATED_SNAPSHOT = join(STATE_DIR, 'generated-snapshot.json');

const PORT = Number(process.env.AGENT_DEV_PORT || 3100);
const HOST = '127.0.0.1';
const DIST_DIR = process.env.AGENT_DEV_DIST_DIR || '.next-agent';
const READY_TIMEOUT_MS = Number(process.env.AGENT_DEV_TIMEOUT_MS || 180_000);
const IS_WINDOWS = process.platform === 'win32';

const readState = () => {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
};

/** Is this pid alive? Signal 0 checks liveness without touching the process. */
const isAlive = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

const urlFor = (path = '/') => `http://${HOST}:${PORT}${path}`;

async function respondsToHttp(timeoutMs = 8000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // Any HTTP answer proves the listener is up; a 500 still means "serving".
    await fetch(urlFor('/'), { signal: ac.signal, redirect: 'manual' });
    return true;
  } catch { return false; } finally { clearTimeout(timer); }
}

/**
 * Kill the whole tree. Killing the npm/next wrapper alone orphans the child, which
 * keeps holding the port and multiple GB of memory — that has already happened here.
 */
function killTree(pid) {
  if (!pid) return;
  if (IS_WINDOWS) {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
    return;
  }
  try { process.kill(-pid, 'SIGTERM'); } catch { /* no process group */ }
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  const existing = readState();
  if (existing && isAlive(existing.pid) && await respondsToHttp()) {
    console.log(`already running  pid=${existing.pid}  ${urlFor()}  distDir=${existing.distDir}`);
    return 0;
  }
  if (existing && isAlive(existing.pid)) killTree(existing.pid);

  // next-env.d.ts and tsconfig.json are tracked, and Next repoints them at our
  // private distDir on startup. Put them back once the server is serving.
  const saved = snapshot();

  mkdirSync(STATE_DIR, { recursive: true });
  // Hand the pre-spawn state to whoever stops this server later.
  persist(saved, GENERATED_SNAPSHOT);
  // Truncate the log so what we read back belongs to this run only.
  writeFileSync(LOG_FILE, '');
  const out = openSync(LOG_FILE, 'a');

  // Mirror the `dev` script's raised header cap. Supabase stores auth tokens as
  // several chunked cookies and localhost shares one cookie origin across projects,
  // so Node's 16KB default is reachable and answers 431 before Next sees the request.
  const child = spawn(
    process.execPath,
    ['--max-http-header-size=32768', join('node_modules', 'next', 'dist', 'bin', 'next'),
     'dev', '--hostname', HOST, '--port', String(PORT)],
    {
      cwd: ROOT,
      env: { ...process.env, NEXT_DIST_DIR: DIST_DIR },
      // Detach on every platform. On Windows the launcher runs under an npm job
      // object, and a non-detached child is terminated the moment npm exits — the
      // server compiled, served, and died. On POSIX this also gives the child its
      // own process group so the whole tree can be signalled at once.
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
    },
  );
  child.unref();

  writeFileSync(STATE_FILE, JSON.stringify(
    { pid: child.pid, port: PORT, host: HOST, distDir: DIST_DIR, startedAt: new Date().toISOString() }, null, 2));

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isAlive(child.pid)) {
      restore(saved);
      console.error(`dev server exited during startup. Log:\n${tail(40)}`);
      return 1;
    }
    if (await respondsToHttp()) {
      const restored = restore(saved);
      console.log(`started  pid=${child.pid}  ${urlFor()}  distDir=${DIST_DIR}  log=.agent/dev-server.log`);
      if (restored.length) console.log(`restored generated file(s): ${restored.join(', ')}`);
      return 0;
    }
    await sleep(1000);
  }
  console.error(`timed out after ${READY_TIMEOUT_MS}ms waiting for ${urlFor()}. Log:\n${tail(40)}`);
  return 1;
}

async function stop() {
  // Deliberately NOT snapshot(): by now the running server has already repointed
  // these files, so a fresh snapshot would preserve the pollution rather than undo it.
  const saved = loadPersisted(GENERATED_SNAPSHOT);
  const state = readState();
  if (!state) { console.log('not running (no state file)'); return 0; }
  killTree(state.pid);
  for (let i = 0; i < 20 && isAlive(state.pid); i++) await sleep(250);
  const stillAlive = isAlive(state.pid);
  rmSync(STATE_FILE, { force: true });
  const restored = restore(saved);
  rmSync(GENERATED_SNAPSHOT, { force: true });
  if (restored.length) console.log(`restored generated file(s): ${restored.join(', ')}`);
  console.log(stillAlive ? `WARNING: pid ${state.pid} survived the kill` : `stopped  pid=${state.pid}`);
  return stillAlive ? 1 : 0;
}

async function status() {
  const state = readState();
  if (!state) { console.log('stopped (no state file)'); return 1; }
  const alive = isAlive(state.pid);
  const http = alive ? await respondsToHttp(15_000) : false;
  console.log(`pid=${state.pid} alive=${alive} http=${http} url=${urlFor()} distDir=${state.distDir} startedAt=${state.startedAt}`);
  return http ? 0 : 1;
}

function tail(n = 40) {
  if (!existsSync(LOG_FILE)) return '(no log)';
  return readFileSync(LOG_FILE, 'utf8').split('\n').slice(-n).join('\n');
}

const command = process.argv[2] || 'status';
const run = {
  start,
  stop,
  status,
  restart: async () => { await stop(); return start(); },
  logs: async () => { console.log(tail(Number(process.argv[3] || 60))); return 0; },
}[command];

if (!run) {
  console.error(`unknown command "${command}" — use start | stop | status | restart | logs`);
  process.exit(2);
}
process.exit(await run());
