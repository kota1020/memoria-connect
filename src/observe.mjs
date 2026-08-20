// observe.mjs — the auto-observer. Walks the open ledger and, for each judgment
// whose result is now measurable (dueAt passed), runs the probe named by its
// outcomeSpec.metric and closes it automatically. "How to measure the result"
// differs per decision type, so the decision declares the spec and the observer
// resolves it through a pluggable probe registry. Add a probe, cover a new type.

import fs from 'node:fs';
import { listOpen, outcome } from './judgment.mjs';

// probe(row) => { result, verdict } to close, or null to keep waiting.
export const PROBES = {
  // Human closes it. The observer never touches manual judgments.
  manual() { return null; },

  // Compare a numeric KPI from a JSON file against a baseline.
  // spec: { path, field, baseline, betterIsUp=true, margin=0.05 }
  'kpi-file'(row) {
    const s = row.outcomeSpec || {};
    if (!s.path || !fs.existsSync(s.path)) return null; // result not available yet
    let data;
    try { data = JSON.parse(fs.readFileSync(s.path, 'utf8')); } catch { return null; }
    const val = s.field ? s.field.split('.').reduce((o, k) => (o == null ? o : o[k]), data) : data;
    if (typeof val !== 'number' || typeof s.baseline !== 'number') return null;
    const up = s.betterIsUp !== false;
    const margin = s.margin != null ? Number(s.margin) : 0.05;
    const rel = (val - s.baseline) / (Math.abs(s.baseline) || 1);
    const better = up ? rel : -rel;
    const verdict = better >= margin ? 'win' : better <= -margin ? 'loss' : 'mixed';
    return { result: `${s.field || 'value'}=${val} (${(rel * 100).toFixed(1)}% vs baseline ${s.baseline})`, verdict };
  },

  // Watch later memory records for negative / positive signals about this context.
  // spec: { bad:[...], good:[...], neutralIsWin=true }
  'memory-signal'(row, { records } = {}) {
    const s = row.outcomeSpec || {};
    const ctx = String(row.context || '').split(/[\s/#]+/).filter(t => t.length >= 2);
    const later = (records || []).filter(r => r.kind !== 'judgment' && String(r.ts || '') > row.ts);
    const hay = later
      .filter(r => ctx.length === 0 || ctx.some(tok => `${r.text || ''}`.includes(tok)))
      .map(r => r.text || '')
      .join('\n');
    const hit = arr => (arr || []).some(k => hay.includes(k));
    if (hit(s.bad)) return { result: `negative signal found (${(s.bad || []).join('/')})`, verdict: 'loss' };
    if (hit(s.good)) return { result: `positive signal found (${(s.good || []).join('/')})`, verdict: 'win' };
    return s.neutralIsWin !== false ? { result: 'no negative signal within window', verdict: 'win' } : null;
  },
};

/**
 * Run one observation pass. Returns a summary you can log.
 * @param {{dry?: boolean, now?: Date, probes?: object, records?: object[]}} [opts]
 *   dry     — evaluate but don't close
 *   probes  — extra/override probes merged over the built-ins
 *   records — memory records for probes that scan history (e.g. memory-signal)
 */
export function observe({ dry = false, now = new Date(), probes = {}, records } = {}) {
  const registry = { ...PROBES, ...probes };
  const nowIso = now.toISOString();
  const open = listOpen();
  const events = [];
  let closed = 0, waiting = 0, nospec = 0;

  for (const row of open) {
    const spec = row.outcomeSpec;
    if (!spec || !spec.metric) { nospec++; continue; }
    if (spec.dueAt && spec.dueAt > nowIso) { waiting++; continue; }
    const probe = registry[spec.metric];
    if (!probe) { events.push({ id: row.id, note: `unknown metric: ${spec.metric}` }); continue; }

    let verdict = null;
    try { verdict = probe(row, { records }); }
    catch (e) { events.push({ id: row.id, note: `probe error: ${e.message}` }); continue; }

    if (!verdict) { waiting++; events.push({ id: row.id, note: `not decided yet (${spec.metric})` }); continue; }
    if (dry) { events.push({ id: row.id, dry: true, ...verdict }); continue; }

    outcome(row.id, { result: verdict.result, verdict: verdict.verdict });
    closed++;
    events.push({ id: row.id, agent: row.agent, ...verdict });
  }

  return { now: nowIso, open: open.length, closed, waiting, nospec, events };
}
