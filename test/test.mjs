// Minimal, dependency-free test suite. Runs against a throwaway store so it
// never touches your real ~/.memoria. Exit code 0 = all passed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

// isolate the store BEFORE importing the library
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-test-'));
process.env.MEMORIA_HOME = TMP;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { decide, outcome, listOpen, forget, prune, recall, observe } = await import('../src/index.mjs');
const { readJsonl, writeJsonl, memoryFile, openFile } = await import('../src/store.mjs');

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

// 8. kpi-file grades loss and mixed, not just win
{
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-kpi-'));
  const grade = (value, opts) => {
    const f = path.join(t, `${value}-${Math.trunc(Math.abs(value) * 1e6)}.json`);
    fs.writeFileSync(f, JSON.stringify({ cvr: value }));
    const gid = decide({
      agent: 'ad', decision: `try ${value}`, why: 'experiment', context: 'grading',
      outcomeSpec: { metric: 'kpi-file', path: f, field: 'cvr', baseline: 0.02, margin: 0.1, afterHours: 0, ...opts },
    });
    observe({ records: readJsonl(memoryFile()) });
    return readJsonl(memoryFile()).find(r => r.id === gid && r.status === 'closed').verdict;
  };
  assert.equal(grade(0.010), 'loss', '50% below baseline is a loss');
  assert.equal(grade(0.021), 'mixed', 'inside the margin is mixed');
  assert.equal(grade(0.010, { betterIsUp: false }), 'win', 'betterIsUp:false flips the sign');
  fs.rmSync(t, { recursive: true, force: true });
  ok('kpi-file grades loss / mixed / betterIsUp');
}

// 9. memory-signal actually sees signals in later memory.
//    Regression: the probe used to drop every record with kind === 'judgment',
//    which is every record this library writes — so it always closed as 'win'.
{
  const sid = decide({
    agent: 'cs', decision: 'no refund', why: 'no evidence', context: 'order-77',
    outcomeSpec: { metric: 'memory-signal', bad: ['complaint'], good: ['resolved'], afterHours: 0 },
  });
  decide({ agent: 'cs', decision: 'escalate', why: 'customer filed a complaint on order-77', context: 'order-77' });
  observe({ records: readJsonl(memoryFile()) });
  const rec = readJsonl(memoryFile()).find(r => r.id === sid && r.status === 'closed');
  assert.equal(rec.verdict, 'loss', 'negative signal in later memory must close as loss');

  // and a judgment must not read its own text back as its own signal
  const oid = decide({
    agent: 'cs', decision: 'refund the complaint case', why: 'goodwill', context: 'order-88',
    outcomeSpec: { metric: 'memory-signal', bad: ['complaint'], afterHours: 0 },
  });
  observe({ records: readJsonl(memoryFile()) });
  const own = readJsonl(memoryFile()).find(r => r.id === oid && r.status === 'closed');
  assert.equal(own.verdict, 'win', 'own text is not a signal about itself');
  ok('memory-signal detects later negative signals');
}

// 10. an unknown metric is surfaced in the counts, not just buried in events
{
  decide({ agent: 'x', decision: 'unknown metric', why: 'typo', context: 'weird',
    outcomeSpec: { metric: 'no-such-probe', afterHours: 0 } });
  const s = observe({ records: readJsonl(memoryFile()) });
  assert.equal(s.unknown, 1, 'unknown metric counted');
  assert.ok(s.events.some(e => /unknown metric/.test(e.note || '')), 'and reported');
  ok('observer counts unknown metrics');
}

// 11. a malformed outcomeSpec fails at decide(), not hours later in the observer
assert.throws(
  () => decide({ decision: 'a', why: 'b', outcomeSpec: { metric: 'kpi-file', afterHours: 'soon' } }),
  /afterHours/, 'non-numeric afterHours should be a validation error');
assert.throws(
  () => decide({ decision: 'a', why: 'b', outcomeSpec: { path: '/tmp/x' } }),
  /metric/, 'a spec with no metric should throw');
ok('decide validates outcomeSpec');

// 12. recall matches Latin tokens on word boundaries ("app" must not hit "happy")
{
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-recall-'));
  const home = process.env.MEMORIA_HOME;
  process.env.MEMORIA_HOME = t;
  decide({ agent: 'a', decision: 'deploy the happy path', why: 'x', context: 'release' });
  decide({ agent: 'a', decision: 'restart the app service', why: 'x', context: 'release' });
  const r = recall('app service');
  assert.equal(r.length, 1, 'only the real match');
  assert.match(r[0].decision, /app service/);
  process.env.MEMORIA_HOME = home;
  fs.rmSync(t, { recursive: true, force: true });
  ok('recall respects word boundaries');
}

// 12b. recall segments Japanese instead of treating a clause as one token.
//      Regression: the tokenizer took maximal kana+kanji runs, so a natural
//      query became a single token and matched nothing but its own twin.
{
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-recall-ja-'));
  const home = process.env.MEMORIA_HOME;
  process.env.MEMORIA_HOME = t;
  decide({
    agent: 'a', decision: '毎月の請求書を手作業で処理するのをやめる',
    why: '転記ミスが月に3件出ているため', context: '経理',
  });
  assert.equal(recall('請求書').length, 1, 'a bare keyword still matches');
  assert.equal(recall('請求書の処理を自動化する方法').length, 1, 'a natural-language query matches');
  assert.equal(recall('転記ミスを減らしたい').length, 1, 'the why is searchable too');
  assert.equal(recall('来月の売上目標を決める').length, 0, 'an unrelated query still misses');
  process.env.MEMORIA_HOME = home;
  fs.rmSync(t, { recursive: true, force: true });
  ok('recall segments Japanese on script boundaries');
}

// 13. forget erases a judgment from both ledgers
{
  const fid = decide({ agent: 'a', decision: 'leaked secret in here', why: 'oops', context: 'incident' });
  assert.equal(forget(fid).removed, 2, 'one memory record + one open row');
  assert.equal(recall('leaked secret incident').length, 0, 'no longer recallable');
  assert.ok(listOpen().every(r => r.id !== fid), 'gone from the open ledger');
  assert.equal(forget(fid).removed, 0, 'forgetting twice is a no-op');
  ok('forget erases a judgment');
}

// 14. prune drops records older than the cutoff, keeping open work by default
{
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-prune-'));
  const home = process.env.MEMORIA_HOME;
  process.env.MEMORIA_HOME = t;
  const oldTs = new Date(Date.now() - 400 * 864e5).toISOString();
  decide({ agent: 'a', decision: 'ancient', why: 'x', context: 'c' });
  decide({ agent: 'a', decision: 'recent', why: 'x', context: 'c' });
  writeJsonl(memoryFile(), readJsonl(memoryFile()).map(
    r => (r.decision === 'ancient' ? { ...r, ts: oldTs } : r)));
  const res = prune({ olderThanDays: 365 });
  assert.equal(res.removed, 1, 'only the ancient record went');
  assert.equal(readJsonl(memoryFile()).length, 1, 'the recent one stayed');
  assert.equal(readJsonl(openFile()).length, 2, 'open work is kept by default');
  assert.throws(() => prune({ olderThanDays: -1 }), /olderThanDays/);
  process.env.MEMORIA_HOME = home;
  fs.rmSync(t, { recursive: true, force: true });
  ok('prune trims old records, keeps open ones');
}

// 15. the store is private to its owner (0700 dir / 0600 files)
if (process.platform !== 'win32') {
  assert.equal(fs.statSync(TMP).mode & 0o777, 0o700, 'store dir is 0700');
  assert.equal(fs.statSync(memoryFile()).mode & 0o777, 0o600, 'memory.jsonl is 0600');
  assert.equal(fs.statSync(openFile()).mode & 0o777, 0o600, 'open ledger is 0600');
  ok('store is created private to the owner');
}

// 16. concurrent writers don't clobber each other's ledger rewrite.
//     Regression: outcome() did an unlocked read-modify-write, so closed
//     judgments were left behind in the open ledger (and a fresh decision from
//     a parallel process could vanish). The app plus a cron'd `memoria observe`
//     is exactly this race. Workers sync on a shared start time so their
//     rewrites actually overlap — staggered writers hide the bug.
{
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-race-'));
  const worker = path.join(t, 'worker.mjs');
  fs.writeFileSync(worker, `
    const { decide, outcome } = await import(${JSON.stringify(path.join(ROOT, 'src/judgment.mjs'))});
    const [, , startAt, n] = process.argv;
    const id = decide({ agent: 'race', decision: 'd' + n, why: 'w', context: 'race' });
    await new Promise(r => setTimeout(r, Math.max(0, Number(startAt) - Date.now())));
    outcome(id, { result: 'r', verdict: 'win' });
  `);
  const N = 12;
  const startAt = Date.now() + 750; // long enough for every child to boot
  const kids = Array.from({ length: N }, (_, i) => spawn(
    process.execPath, [worker, String(startAt), String(i)],
    { env: { ...process.env, MEMORIA_HOME: t }, stdio: 'inherit' },
  ));
  const codes = await Promise.all(kids.map(k => new Promise(res => k.on('exit', res))));
  assert.ok(codes.every(c => c === 0), 'every writer exited cleanly');

  const home = process.env.MEMORIA_HOME;
  process.env.MEMORIA_HOME = t;
  const open = readJsonl(openFile());
  const mem = readJsonl(memoryFile());
  const closedRows = mem.filter(r => r.status === 'closed');
  assert.equal(open.length, 0, `every judgment was closed, so the open ledger must be empty (found ${open.length})`);
  assert.equal(closedRows.length, N, 'every close was recorded');
  assert.equal(new Set(closedRows.map(r => r.id)).size, N, 'and recorded exactly once each');
  assert.equal(mem.filter(r => r.status === 'open').length, N, 'no decision was lost from the log');
  process.env.MEMORIA_HOME = home;
  fs.rmSync(t, { recursive: true, force: true });
  ok('concurrent writers keep the ledger consistent');
}

// 17. CLI smoke test — the commands people actually paste into a shell
{
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-cli-'));
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/memoria.mjs'), ...args],
      { env: { ...process.env, MEMORIA_HOME: t }, encoding: 'utf8' });
    return { ...r, out: r.stdout + r.stderr };
  };
  // a value starting with "--" survives via --flag=value
  const d = cli('decide', '--agent', 'cli', '--decision=--dry-run by default', '--why', 'safer');
  assert.equal(d.status, 0, d.out);
  const cliId = d.out.match(/decide -> (\S+)/)[1];
  assert.match(cli('open').out, new RegExp(cliId), 'open lists it');
  assert.match(cli('recall', 'dry run default').out, /dry-run/, 'recall finds it');
  assert.equal(cli('outcome', cliId, '--result', 'fine', '--verdict', 'win').status, 0);
  // a closed judgment leaves two memory rows behind (the open one + the closed one)
  assert.match(cli('forget', cliId).out, /2 record\(s\) erased/, 'forget reports what it erased');
  assert.equal(cli('outcome').status, 1, 'missing id is an error, not a crash');
  assert.equal(cli('bogus-command').status, 1, 'unknown command exits non-zero');
  assert.match(cli('where').out, new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'where prints the store');
  fs.rmSync(t, { recursive: true, force: true });
  ok('CLI commands work end to end');
}

console.log(`\nAll ${passed} tests passed. (store: ${TMP})`);
fs.rmSync(TMP, { recursive: true, force: true });
