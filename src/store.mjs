// store.mjs — where memoria-connect keeps its data on the user's own machine.
// No personal data ships with this package. Everything is written to the
// consumer's local store, configurable via the MEMORIA_HOME env var.
//
//   default store dir: $MEMORIA_HOME  ||  ~/.memoria   (created mode 0700)
//     memory.jsonl          — the recallable log (decisions + outcomes)
//     judgments-open.jsonl  — decisions still awaiting an outcome
//     .lock/                — cross-process write lock (see withStoreLock)
//
// The store holds the *reasons* behind an agent's decisions, which is often
// business-sensitive. It is created private to the owner (0700 dir / 0600
// files) so other local users can't read it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export function storeDir() {
  return process.env.MEMORIA_HOME || path.join(os.homedir(), '.memoria');
}
export function memoryFile() { return path.join(storeDir(), 'memory.jsonl'); }
export function openFile() { return path.join(storeDir(), 'judgments-open.jsonl'); }

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
}

export function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', { mode: FILE_MODE });
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); }
      catch { return null; } // tolerate a partially-written trailing line
    })
    .filter(Boolean);
}

export function writeJsonl(file, rows) {
  ensureDir(path.dirname(file));
  const data = rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  // write-then-rename so a crash mid-write can't truncate the ledger
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: FILE_MODE });
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Cross-process write lock.
//
// outcome()/forget()/prune() rewrite a whole ledger (read -> filter -> write).
// Without a lock, an interleaved writer — the app and a cron'd `memoria
// observe` are the normal case — loses the other's update: closed judgments
// reappear in the open ledger, or a fresh decision vanishes. mkdir is atomic
// on every platform we target, so it makes a portable, dependency-free lock.

const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 30000; // a holder that died leaves the dir behind

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

let depth = 0; // re-entrancy guard: nested calls in one process share the lock

/** Run `fn` while holding the store-wide write lock. */
export function withStoreLock(fn) {
  if (depth > 0) { // already held by this call stack
    depth++;
    try { return fn(); } finally { depth--; }
  }

  const dir = storeDir();
  const lock = path.join(dir, '.lock');
  ensureDir(dir);

  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try { fs.mkdirSync(lock, { mode: DIR_MODE }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; }
      catch { continue; } // released while we looked — retry immediately
      if (age > LOCK_STALE_MS) { try { fs.rmdirSync(lock); } catch { /* raced */ } continue; }
      if (Date.now() > deadline) {
        throw new Error(`memoria: timed out waiting for the store lock (${lock}). ` +
          'If no other memoria process is running, remove that directory.');
      }
      sleepSync(10 + (process.pid % 15)); // jitter, so waiters don't sync up
    }
  }

  depth = 1;
  try { return fn(); }
  finally { depth = 0; try { fs.rmdirSync(lock); } catch { /* already gone */ } }
}
