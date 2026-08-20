#!/usr/bin/env node
// memoria-connect CLI — use from any language / shell.
//
//   memoria decide  --agent A --decision "..." --why "..." [--context C] [--tags a,b]
//   memoria outcome <id> --result "..." --verdict win|loss|mixed
//   memoria open
//   memoria recall  "query text" [--limit 5]
//   memoria observe [--dry]
//   memoria where

import { decide, outcome, listOpen } from '../src/judgment.mjs';
import { recall } from '../src/recall.mjs';
import { observe } from '../src/observe.mjs';
import { storeDir, memoryFile, readJsonl } from '../src/store.mjs';

function parse(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      flags[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    } else pos.push(argv[i]);
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
      console.log(`observe: open=${sum.open} closed=${sum.closed} waiting=${sum.waiting} no-spec=${sum.nospec}`);
      for (const e of sum.events) console.log('  ' + JSON.stringify(e));
      break;
    }
    case 'where':
      console.log(storeDir());
      console.log(memoryFile());
      break;
    default:
      console.log('usage: memoria decide|outcome <id>|open|recall <q>|observe|where  [--flags]');
  }
} catch (e) {
  console.error('error:', e.message);
  process.exit(1);
}
