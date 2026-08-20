// judgment.mjs — the connector. Any agent plugs in with one import.
//
// A judgment is a "decision + why + (later) outcome" triple. Decisions are the
// data that make an agent get sharper over time — not raw logs, but the record
// of what was decided, why, and how it turned out. This module captures that.

import { randomUUID } from 'node:crypto';
import { memoryFile, openFile, appendJsonl, readJsonl, writeJsonl } from './store.mjs';

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
  let spec = outcomeSpec;
  if (spec && spec.afterHours != null) {
    spec = { ...spec, dueAt: new Date(now.getTime() + Number(spec.afterHours) * 3600e3).toISOString() };
  }

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

  appendJsonl(memoryFile(), toMemoryRecord(row, false)); // immediately recallable
  appendJsonl(openFile(), row);                          // await an outcome
  return row.id;
}

/**
 * Close a judgment with its outcome — promoting "decision + why" to the full
 * "decision + why + outcome" triple that actually compounds.
 */
export function outcome(id, { result, verdict = 'pending' } = {}) {
  if (!VERDICTS.has(verdict)) throw new Error('outcome: `verdict` must be win | loss | mixed | pending');
  const rows = readJsonl(openFile());
  const row = rows.find(r => r.id === id);
  if (!row) throw new Error(`outcome: no open judgment with id ${id}`);

  row.outcome = result ?? null;
  row.verdict = verdict;
  row.closedAt = new Date().toISOString();

  appendJsonl(memoryFile(), toMemoryRecord(row, true)); // closed record wins on recall (newer ts)
  writeJsonl(openFile(), rows.filter(r => r.id !== id)); // drop from the open ledger
  return { id, ...row };
}

/** Judgments still awaiting an outcome (the observer's input). */
export function listOpen() {
  return readJsonl(openFile());
}
