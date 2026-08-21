// recall.mjs — read relevant past judgments back out, to feed the next decision.
// This is the "inject context before deciding" side of the loop. Generic and
// dependency-free: a simple token-overlap search over the local memory log.

import { memoryFile, readJsonl } from './store.mjs';

const STOP = new Set(['the', 'and', 'for', 'you', 'with', 'that', 'this', 'was', 'are', 'not']);

function tokenize(s) {
  return [...new Set(
    (String(s).toLowerCase().match(/[a-z0-9]{3,}|[぀-ヿ一-鿿]{2,}/g) || [])
      .filter(t => !STOP.has(t)),
  )].slice(0, 16);
}

// Latin tokens match on word boundaries — a bare substring test scores "app"
// against "happy" and buries the real hits. CJK has no such boundaries (and the
// tokenizer grabs maximal runs), so those stay substring matches.
function matcher(tok) {
  if (!/^[a-z0-9]+$/.test(tok)) return hay => hay.includes(tok);
  const re = new RegExp(`(?<![a-z0-9])${tok}(?![a-z0-9])`);
  return hay => re.test(hay);
}

/**
 * Return the judgments most relevant to `query`, newest-first among ties.
 * @param {string} query
 * @param {{limit?: number, verdicts?: string[]}} [opts]
 */
export function recall(query, { limit = 5, verdicts } = {}) {
  const toks = tokenize(query);
  if (!toks.length) return [];
  const min = toks.length <= 2 ? 1 : 2;
  const tests = toks.map(matcher);

  let rows = readJsonl(memoryFile());
  if (verdicts && verdicts.length) rows = rows.filter(r => verdicts.includes(r.verdict));

  const scored = [];
  for (const r of rows) {
    const hay = `${r.text || ''} ${r.decision || ''} ${r.context || ''}`.toLowerCase();
    let s = 0;
    for (const test of tests) if (test(hay)) s++;
    if (s >= min) scored.push([s, r]);
  }
  scored.sort((a, b) => b[0] - a[0] || String(b[1].ts || '').localeCompare(String(a[1].ts || '')));

  // dedupe by decision so an updated (closed) record replaces its open twin
  const seen = new Set();
  const out = [];
  for (const [, r] of scored) {
    const key = r.id || r.decision;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
