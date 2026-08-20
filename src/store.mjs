// store.mjs — where memoria-connect keeps its data on the user's own machine.
// No personal data ships with this package. Everything is written to the
// consumer's local store, configurable via the MEMORIA_HOME env var.
//
//   default store dir: $MEMORIA_HOME  ||  ~/.memoria
//     memory.jsonl          — the recallable log (decisions + outcomes)
//     judgments-open.jsonl  — decisions still awaiting an outcome

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function storeDir() {
  return process.env.MEMORIA_HOME || path.join(os.homedir(), '.memoria');
}
export function memoryFile() { return path.join(storeDir(), 'memory.jsonl'); }
export function openFile() { return path.join(storeDir(), 'judgments-open.jsonl'); }

export function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l, i) => {
      try { return JSON.parse(l); }
      catch { return null; } // tolerate a partially-written trailing line
    })
    .filter(Boolean);
}

export function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}
