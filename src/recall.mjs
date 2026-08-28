// recall.mjs — read relevant past judgments back out, to feed the next decision.
// This is the "inject context before deciding" side of the loop. Generic and
// dependency-free: a simple token-overlap search over the local memory log.

import { memoryFile, readJsonl } from './store.mjs';

const STOP = new Set(['the', 'and', 'for', 'you', 'with', 'that', 'this', 'was', 'are', 'not']);

// Japanese is written without spaces, so a maximal run of kana+kanji is a whole
// clause rather than a word. Treating one as a single token meant a natural
// query only ever matched an exact-substring twin of itself:
//
//   decide({ decision: '毎月の請求書を手作業で処理するのをやめる', ... })
//   recall('請求書')                      -> 1 hit
//   recall('請求書の処理を自動化する方法')  -> 0 hit   ← the query was one token
//
// A 0-hit recall is indistinguishable from "no relevant past", so this failed
// silently: the caller just never saw the memory it had.
//
// Splitting on script boundaries approximates segmentation without shipping a
// dictionary (this package stays dependency-free): content words in Japanese
// are written in kanji or katakana, and the hiragana between them is grammar
// (の / を / する / ている). Kanji and katakana runs become tokens; pure-hiragana
// runs are dropped — they are inflection and particles, and being ubiquitous
// they would match every record and drown the real signal.
const KATAKANA = '\u30a0-\u30ff\u31f0-\u31ff';   // includes the ー prolonged mark
const KANJI = '\u4e00-\u9fff\u3005-\u3007';      // includes 々 / 〆 / 〇
const TOKEN_RE = new RegExp(`[a-z0-9]{3,}|[${KATAKANA}]{2,}|[${KANJI}]{2,}`, 'g');

function tokenize(s) {
  return [...new Set(
    (String(s).toLowerCase().match(TOKEN_RE) || [])
      .filter(t => !STOP.has(t)),
  )].slice(0, 16);
}

// Latin tokens match on word boundaries — a bare substring test scores "app"
// against "happy" and buries the real hits. CJK genuinely has no boundaries, so
// those stay substring matches.
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
