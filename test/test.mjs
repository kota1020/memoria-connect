// Minimal, dependency-free test suite. Runs against a throwaway store so it
// never touches your real ~/.memoria. Exit code 0 = all passed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';

// isolate the store BEFORE importing the library
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-test-'));
process.env.MEMORIA_HOME = TMP;

const { decide, outcome, listOpen, recall, observe } = await import('../src/index.mjs');
const { readJsonl, memoryFile } = await import('../src/store.mjs');

let passed = 0;
function ok(name) { console.log(`  ok - ${name}`); passed++; }

// 1. decide requires decision + why
assert.throws(() => decide({ decision: 'x' }), /why/, 'missing why should throw');
ok('decide rejects missing why');

// 2. decide records an open judgment and makes it recallable
const id = decide({ agent: 'test', decision: 'ship feature A', why: 'users asked', context: 'proj-1' });
assert.match(id, /^j_/, 'id format');
assert.equal(listOpen().length, 1, 'one open judgment');
assert.equal(recall('feature A proj-1').length, 1, 'recall finds it');
ok('decide records + recall finds it');

// 3. outcome closes it and promotes the record
const closed = outcome(id, { result: 'adoption up', verdict: 'win' });
assert.equal(closed.verdict, 'win');
assert.equal(listOpen().length, 0, 'open ledger emptied');
const memRows = readJsonl(memoryFile());
assert.ok(memRows.some(r => r.status === 'closed' && r.verdict === 'win'), 'closed record written');
ok('outcome closes + promotes to triple');

// 4. recall dedupes to the closed record (not the stale open one)
const hits = recall('ship feature A');
assert.equal(hits.length, 1, 'deduped to one');
assert.equal(hits[0].verdict, 'win', 'closed record wins');
ok('recall dedupes open/closed by id');

// 5. outcome rejects unknown verdict + unknown id
assert.throws(() => outcome(id, { verdict: 'nope' }), /verdict/);
assert.throws(() => outcome('does-not-exist', { verdict: 'win' }), /no open judgment/);
ok('outcome validates verdict + id');

// 6. observer: kpi-file probe auto-closes a due judgment
const kpi = path.join(TMP, 'kpi.json');
fs.writeFileSync(kpi, JSON.stringify({ cvr: 0.036 }));
const jid = decide({
  agent: 'ad', decision: 'optimize for B', why: 'higher CVR', context: 'campaign',
  outcomeSpec: { metric: 'kpi-file', path: kpi, field: 'cvr', baseline: 0.02, betterIsUp: true, margin: 0.1, afterHours: 0 },
});
const sum = observe({ records: readJsonl(memoryFile()) });
assert.equal(sum.closed, 1, 'observer closed the due judgment');
assert.ok(listOpen().every(r => r.id !== jid), 'closed one removed from ledger');
ok('observer auto-closes due kpi-file judgment');

// 7. observer waits on a future-due judgment
decide({
  agent: 'cs', decision: 'no refund', why: 'no evidence', context: 'order-9',
  outcomeSpec: { metric: 'memory-signal', bad: ['complaint'], good: ['resolved'], afterHours: 72 },
});
const sum2 = observe({ records: readJsonl(memoryFile()) });
assert.equal(sum2.waiting >= 1, true, 'future-due judgment is still waiting');
ok('observer respects dueAt window');

console.log(`\nAll ${passed} tests passed. (store: ${TMP})`);
fs.rmSync(TMP, { recursive: true, force: true });
