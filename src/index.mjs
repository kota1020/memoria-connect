// memoria-connect — a drop-in memory + judgment layer for AI agents.
// Connect any agent in one import: it records "decision + why + outcome" to a
// local store, recalls the relevant past before the next decision, and closes
// outcomes automatically. Ships zero personal data — everything lives in the
// consumer's own store ($MEMORIA_HOME || ~/.memoria).

export { decide, outcome, listOpen, VERDICTS } from './judgment.mjs';
export { recall } from './recall.mjs';
export { observe, PROBES } from './observe.mjs';
export { storeDir, memoryFile, openFile } from './store.mjs';
