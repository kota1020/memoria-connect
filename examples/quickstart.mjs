// Quickstart: run with `node examples/quickstart.mjs`
// Writes to a temp store so it won't touch your real ~/.memoria.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.MEMORIA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-demo-'));

const { decide, outcome, recall, observe } = await import('../src/index.mjs');
const { readJsonl, memoryFile } = await import('../src/store.mjs');

// 1) An agent records a decision the moment it makes one.
const id = decide({
  agent: 'growth-agent',
  decision: 'switch landing page to variant B',
  why: 'variant A had half the conversion rate',
  context: 'homepage-experiment',
  // optional: let the observer close this automatically once the KPI lands
  // outcomeSpec: { metric: 'kpi-file', path: '/tmp/kpi.json', field: 'cvr',
  //                baseline: 0.02, betterIsUp: true, margin: 0.1, afterHours: 72 },
});
console.log('recorded:', id);

// 2) Before the next related decision, recall what happened before.
console.log('recall:', recall('landing page conversion'));

// 3) When the result is known, close it — now it's a full triple.
outcome(id, { result: 'conversion +40%', verdict: 'win' });

// 4) An observer pass closes anything that became measurable (none here).
console.log('observe:', observe({ records: readJsonl(memoryFile()) }));
