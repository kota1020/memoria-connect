// memoria screen — capture "what the user is doing right now" into a self-updating memo
// Ladder per window: ① visible-window metadata → ② AX tree text → ③ screenshot + OCR
// Everything is written locally under $MEMORIA_HOME/screen (default ~/.memoria/screen).
// macOS only. Requires the compiled helpers in ./bin (see build.sh) and the
// Accessibility + Screen Recording permissions (see README).
import { execFile, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
const run = promisify(execFile)
const dir = path.dirname(fileURLToPath(import.meta.url))
const BIN = (n) => path.join(dir, 'bin', n)
const HOME = process.env.MEMORIA_HOME || path.join(homedir(), '.memoria')
const OUT = path.join(HOME, 'screen')
mkdirSync(OUT, { recursive: true, mode: 0o700 })
const MEMO = path.join(OUT, 'current-activity.md')
const LOG = path.join(OUT, 'activity-log.jsonl')  // append-only history of change points

const BROWSERS = {
  'Google Chrome': 'tell application "Google Chrome" to return URL of active tab of front window',
  'Brave Browser': 'tell application "Brave Browser" to return URL of active tab of front window',
  'Microsoft Edge': 'tell application "Microsoft Edge" to return URL of active tab of front window',
  'Safari': 'tell application "Safari" to return URL of front document',
  'Arc': 'tell application "Arc" to return URL of active tab of front window',
  'Dia': 'tell application "Dia" to return URL of active tab of front window',
}
const TERMINAL_RE = /Ghostty|iTerm|Terminal|Alacritty|kitty|WezTerm/i
// Optional: a shell command whose stdout describes what your terminal is doing
// (e.g. a terminal-manager CLI). Used for terminal windows instead of AX/OCR.
const TERMINAL_CMD = process.env.MEMORIA_TERMINAL_CMD || ''

async function tryRun(cmd, args, timeout = 4000) {
  try { return (await run(cmd, args, { timeout, maxBuffer: 4e6 })).stdout.trim() } catch { return '' }
}
async function urlFor(app) { return BROWSERS[app] ? tryRun('osascript', ['-e', BROWSERS[app]], 1500) : '' }

async function contentFor(w) {
  if (TERMINAL_CMD && TERMINAL_RE.test(w.app)) {
    try {
      const t = execSync(TERMINAL_CMD, { timeout: 3000, maxBuffer: 4e6 }).toString().trim()
      if (t) return { src: 'terminal', text: t }
    } catch {}
  }
  const ax = await tryRun(BIN('axread'), [String(w.pid), String(w.x), String(w.y)])
  if (ax && ax.replace(/[·\s]/g, '').length >= 12) return { src: 'AX', text: ax }
  const tmp = path.join(tmpdir(), `memoria-screen-${w.num}.png`)
  await tryRun('screencapture', ['-x', '-o', '-l', String(w.num), tmp], 3000)
  const ocr = await tryRun(BIN('ocrimg'), [tmp], 8000)
  if (ocr) return { src: 'OCR', text: ocr }
  return { src: '-', text: '' }
}

const WIN_PER_DISP = 4
async function snapshot() {
  const out = await tryRun(BIN('win'), [], 4000)
  if (!out) return []
  const { displays, windows, idleSeconds = 0 } = JSON.parse(out)
  // Windows arrive front-to-back; take the top N per display, front window first.
  const byDisp = {}
  for (const w of windows) (byDisp[w.display] = byDisp[w.display] || []).push(w)
  const rows = []
  for (const d of displays) {
    const ws = (byDisp[d.index] || []).slice(0, WIN_PER_DISP)
    if (!ws.length) { rows.push({ label: d.label, app: '(empty)', title: '', url: '', src: '-', z: 9999, text: '', others: [] }); continue }
    const front = ws[0]
    const [url, content] = await Promise.all([urlFor(front.app), contentFor(front)])
    const others = ws.slice(1).map(w => ({ app: w.app, title: w.title }))
    rows.push({ label: d.label, app: front.app, title: front.title, url, z: front.z ?? 9999, ...content, others })
  }
  for (const row of rows) row.idle = Number(idleSeconds) || 0
  return rows
}

const TL_MAX = 30
const timeline = []
let lastActivityLogAt = 0
const sigOf = (rows) => rows.map(r => `${r.label}:${r.app}|${r.title}|${r.url}|${r.src === 'terminal' ? r.text : ''}|${r.idle >= 120 ? 'idle' : 'active'}|${(r.others || []).map(o => o.app + o.title).join(',')}`).join(' ‖ ')

function writeMemo(rows) {
  const excerpt = (t) => (t.length > 700 ? t.slice(0, 700) + '…' : t)
  const now = rows.map(r =>
    `### ${r.label}: ${r.app}${r.title ? ` — ${r.title}` : ''} (frontmost)\n` +
    (r.url ? `URL: ${r.url}\n` : '') +
    (r.text ? `${r.src === 'terminal' ? 'terminal' : `screen[${r.src}]`}: ${excerpt(r.text)}` : 'screen: (no content)') +
    (r.others && r.others.length ? `\nother windows on this display: ${r.others.map(o => `${o.app}${o.title ? ` "${o.title}"` : ''}`).join(' / ')}` : '')
  ).join('\n\n')
  const tl = timeline.slice(-12).map(t =>
    `- ${t.at ? t.at.toTimeString().slice(0, 5) + ' ' : ''}${t.rows.map(r => `${r.label}=${r.app}${r.src === 'terminal' ? `(${r.text.split(' | ')[0]})` : r.title ? `(${r.title})` : ''}`).join(' / ')}`).join('\n')
  writeFileSync(MEMO,
`# Current activity (memoria screen · self-updating)
_What is on screen right now (${rows.length} display(s), top ${WIN_PER_DISP} windows each, frontmost first). Windows in other macOS Spaces are not visible to the API. An LLM reads this to understand the user's recent activity._
_To the LLM: for "what was I doing just now / N minutes ago" questions, answer **from this memo alone** (do not dig through logs). Timeline times are local. Dig only when asked for detail that is not here._

## On screen right now (frontmost = what the user is actually looking at)
${now}

## Recent timeline (change points only; older entries forgotten)
${tl || '- (no changes yet)'}
`)
}

let n = 0
const SAMPLES = Number(process.env.SAMPLES ?? 4)
const INTERVAL = Number(process.env.INTERVAL ?? 2000)
async function tick() {
  try {
    const rows = await snapshot()
    if (rows.length) {
      const s = sigOf(rows)
      const changed = !timeline.length || timeline[timeline.length - 1].sig !== s
      if (changed) {
        timeline.push({ sig: s, rows, at: new Date() }); if (timeline.length > TL_MAX) timeline.shift()
      }
      if (changed || Date.now() - lastActivityLogAt >= 5 * 60 * 1000) {
        const at = new Date().toISOString()
        const compact = rows.map(r => ({ mon: r.label, app: r.app, title: r.title, url: r.url, src: r.src, z: r.z ?? 9999, idle: Math.round(r.idle || 0), ctx: r.text || '' }))
        try { appendFileSync(LOG, JSON.stringify({ at, rows: compact }) + '\n') } catch {}
        lastActivityLogAt = Date.now()
      }
      writeMemo(rows)
    }
  } catch {}
  n++
  if (SAMPLES === 0 || n < SAMPLES) setTimeout(tick, INTERVAL)
  else process.stdout.write(readFileSync(MEMO, 'utf8'))
}
tick()
