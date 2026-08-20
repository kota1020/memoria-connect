#!/usr/bin/env node
// memoria-connect CLI — use from any language / shell.
//
//   memoria decide  --agent A --decision "..." --why "..." [--context C] [--tags a,b]
//   memoria outcome <id> --result "..." --verdict win|loss|mixed
//   memoria open
//   memoria recall  "query text" [--limit 5]
//   memoria observe [--dry]
//   memoria forget  <id>
//   memoria prune   [--days 365] [--include-open]
//   memoria where

import { decide, outcome, listOpen, forget, prune } from '../src/judgment.mjs';
import { recall } from '../src/recall.mjs';
import { observe } from '../src/observe.mjs';
import { storeDir, memoryFile, readJsonl } from '../src/store.mjs';

const USAGE = 'usage: memoria decide|outcome <id>|open|recall <q>|observe|forget <id>|prune|where  [--flags]';

function parse(argv) {
  const flags = {};
  const pos = [];
  let positionalOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (positionalOnly) { pos.push(arg); continue; }
    if (arg === '--') { positionalOnly = true; continue; }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      // --flag=value keeps values that themselves start with "--" intact
      if (eq !== -1) { flags[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
      const next = argv[i + 1];
      flags[arg.slice(2)] = next !== undefined && !next.startsWith('--') ? argv[++i] : 'true';
    } else pos.push(arg);
  }
  return { flags, pos };
}

const [cmd, ...rest] = process.argv.slice(2);
const { flags, pos } = parse(rest);

try {
  switch (cmd) {
    case 'decide': {
      const id = decide({
        agent: flags.agent, decision: flags.decision, why: flags.why,
        context: flags.context, tags: flags.tags,
      });
      console.log(`decide -> ${id}`);
      break;
    }
    case 'outcome': {
      if (!pos[0]) throw new Error('outcome: missing <id>');
      const r = outcome(pos[0], { result: flags.result, verdict: flags.verdict });
      console.log(`outcome -> ${r.id} closed as ${r.verdict}`);
      break;
    }
    case 'open': {
      const o = listOpen();
      console.log(`open judgments: ${o.length}`);
      for (const r of o) console.log(`  ${r.id} [${r.agent}] ${r.decision}`);
      break;
    }
    case 'recall': {
      const hits = recall(pos.join(' '), { limit: Number(flags.limit) || 5 });
      console.log(`recall "${pos.join(' ')}": ${hits.length}`);
      for (const r of hits) console.log(`  [${r.verdict}] ${r.decision}  (${r.context})`);
      break;
    }
    case 'observe': {
      const records = readJsonl(memoryFile());
      const sum = observe({ dry: flags.dry === 'true', records });
      console.log(`observe: open=${sum.open} closed=${sum.closed} waiting=${sum.waiting} ` +
        `no-spec=${sum.nospec} unknown-metric=${sum.unknown} probe-errors=${sum.failed}`);
      for (const e of sum.events) console.log('  ' + JSON.stringify(e));
      break;
    }
    case 'forget': {
      if (!pos[0]) throw new Error('forget: missing <id>');
      const r = forget(pos[0]);
      console.log(`forget -> ${r.id}: ${r.removed} record(s) erased`);
      break;
    }
    case 'prune': {
      const r = prune({
        olderThanDays: flags.days != null ? Number(flags.days) : 365,
        includeOpen: flags['include-open'] === 'true',
      });
      console.log(`prune -> ${r.removed} record(s) removed, ${r.kept} kept`);
      break;
    }
    case 'where':
      console.log(storeDir());
      console.log(memoryFile());
      break;
    default:
      console.log(USAGE);
      if (cmd !== undefined && cmd !== 'help' && cmd !== '--help') process.exit(1);
  }
} catch (e) {
  console.error('error:', e.message);
  process.exit(1);
}
