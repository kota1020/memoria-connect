// judgment.mjs — the connector. Any agent plugs in with one import.
//
// A judgment is a "decision + why + (later) outcome" triple. Decisions are the
// data that make an agent get sharper over time — not raw logs, but the record
// of what was decided, why, and how it turned out. This module captures that.

import { randomUUID } from 'node:crypto';
import {
  memoryFile, openFile, appendJsonl, readJsonl, writeJsonl, withStoreLock,
} from './store.mjs';

export const VERDICTS = new Set(['win', 'loss', 'mixed', 'pending']);

function newId() {
  return `j_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

// Shape stored in memory.jsonl — a flat, recall-friendly record.
function toMemoryRecord(row, closed) {
  const result = closed ? `outcome: ${row.outcome} (${row.verdict})` : 'outcome: pending';
  return {
    kind: 'judgment',
    status: closed ? 'closed' : 'open',
    id: row.id,
    ts: closed && row.closedAt ? row.closedAt : row.ts,
    agent: row.agent,
    context: row.context,
    text: `decision: ${row.decision} | why: ${row.why} | ${result} | context: ${row.context} | agent: ${row.agent}`,
    decision: row.decision,
    why: row.why,
    outcome: row.outcome ?? null,
    verdict: row.verdict,
    tags: row.tags,
  };
}

// A malformed spec must fail here, at the call site that wrote it — not hours
// later inside a cron'd observer pass where nobody is watching.
function normalizeSpec(spec, now) {
  if (spec == null) return null;
  if (typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('decide: `outcomeSpec` must be an object');
  }
  if (typeof spec.metric !== 'string' || !spec.metric) {
    throw new Error('decide: `outcomeSpec.metric` is required (e.g. "kpi-file", "memory-signal", "manual")');
  }
  if (spec.afterHours == null) return { ...spec };

  const hours = Number(spec.afterHours);
  if (!Number.isFinite(hours)) {
    throw new Error(`decide: \`outcomeSpec.afterHours\` must be a number (got ${JSON.stringify(spec.afterHours)})`);
  }
  return { ...spec, afterHours: hours, dueAt: new Date(now.getTime() + hours * 3600e3).toISOString() };
}

/**
 * Record a decision the moment it's made. `decision` and `why` are required —
 * a decision with no "why" is a half-record. Optionally attach an `outcomeSpec`
 * so the observer can close it automatically once the result is measurable.
 *
 * @returns {string} the judgment id (pass it to outcome() to close it).
 */
export function decide({ agent = 'unknown', decision, why, context = '-', tags = [], outcomeSpec = null } = {}) {
  if (!decision) throw new Error('decide: `decision` is required');
  if (!why) throw new Error('decide: `why` is required (a decision with no reason is a half-record)');

  const now = new Date();
  const spec = normalizeSpec(outcomeSpec, now);

  const row = {
    id: newId(),
    ts: now.toISOString(),
    agent,
    decision,
    why,
    context,
    tags: Array.isArray(tags) ? tags : String(tags).split(',').map(s => s.trim()).filter(Boolean),
    outcome: null,
    verdict: 'pending',
    outcomeSpec: spec,
  };

  withStoreLock(() => {
    appendJsonl(memoryFile(), toMemoryRecord(row, false)); // immediately recallable
    appendJsonl(openFile(), row);                          // await an outcome
  });
  return row.id;
}

/**
 * Close a judgment with its outcome — promoting "decision + why" to the full
 * "decision + why + outcome" triple that actually compounds.
 */
export function outcome(id, { result, verdict = 'pending' } = {}) {
  if (!VERDICTS.has(verdict)) throw new Error('outcome: `verdict` must be win | loss | mixed | pending');

  return withStoreLock(() => {
    const rows = readJsonl(openFile());
    const row = rows.find(r => r.id === id);
    if (!row) throw new Error(`outcome: no open judgment with id ${id}`);

    row.outcome = result ?? null;
    row.verdict = verdict;
    row.closedAt = new Date().toISOString();

    appendJsonl(memoryFile(), toMemoryRecord(row, true)); // closed record wins on recall (newer ts)
    writeJsonl(openFile(), rows.filter(r => r.id !== id)); // drop from the open ledger
    return { id, ...row };
  });
}

/** Judgments still awaiting an outcome (the observer's input). */
export function listOpen() {
  return readJsonl(openFile());
}

/**
 * Erase a judgment from the store entirely — both the recallable log and the
 * open ledger. Agents write free text into `decision`/`why`, so there has to be
 * a way to take something back out (a mistaken record, a deletion request).
 *
 * @returns {{id: string, removed: number}} how many records were erased.
 */
export function forget(id) {
  if (!id) throw new Error('forget: `id` is required');

  return withStoreLock(() => {
    let removed = 0;
    for (const file of [memoryFile(), openFile()]) {
      const rows = readJsonl(file);
      const kept = rows.filter(r => r.id !== id);
      if (kept.length !== rows.length) {
        removed += rows.length - kept.length;
        writeJsonl(file, kept);
      }
    }
    return { id, removed };
  });
}

/**
 * Drop records older than `olderThanDays` so the store doesn't grow forever.
 * Open judgments are kept by default — an unclosed decision is still live work.
 *
 * @returns {{removed: number, kept: number}}
 */
export function prune({ olderThanDays = 365, includeOpen = false } = {}) {
  const days = Number(olderThanDays);
  if (!Number.isFinite(days) || days < 0) throw new Error('prune: `olderThanDays` must be a non-negative number');
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();

  return withStoreLock(() => {
    let removed = 0, kept = 0;
    const stale = r => String(r.ts || '') < cutoff;

    const mem = readJsonl(memoryFile());
    const memKept = mem.filter(r => !stale(r));
    removed += mem.length - memKept.length;
    kept += memKept.length;
    if (memKept.length !== mem.length) writeJsonl(memoryFile(), memKept);

    if (includeOpen) {
      const open = readJsonl(openFile());
      const openKept = open.filter(r => !stale(r));
      removed += open.length - openKept.length;
      if (openKept.length !== open.length) writeJsonl(openFile(), openKept);
    }
    return { removed, kept };
  });
}
