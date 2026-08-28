# memoria screen (macOS)

Turn "what the user is doing right now" into memory an LLM can read.

A tiny always-on watcher samples your displays every ~2 seconds and keeps one
self-updating markdown memo: the frontmost window per display, its actual
on-screen text (AX tree first, Vision OCR as fallback), the active browser URL,
and a timestamped timeline of recent change points. Inject that memo into any
agent's prompt and it answers "what was I just doing?" instantly — no digging.

Everything stays on your machine, under `$MEMORIA_HOME/screen`
(default `~/.memoria/screen`):

- `current-activity.md` — the live memo (overwritten every tick)
- `activity-log.jsonl` — append-only history of change points

## Install

```bash
cd screen
./build.sh              # compiles the helpers + the menu bar app
./install-launchd.sh    # starts at login; 👁 appears in the menu bar
```

Then grant **both** permissions in System Settings → Privacy & Security:

- **Accessibility** → MemoriaScreen (reads window text via the AX tree)
- **Screen & System Audio Recording** → MemoriaScreen (window titles + OCR fallback)

The menu bar eye tells you the truth at a glance:

| icon | meaning |
| ---- | ------- |
| 👁🟢 | watching, memo updating |
| 👁⚠️ | should be running but broken — process died, or the memo stopped updating (usually lost permissions) |
| 👁⚪️ | switched off by you |

> **Signing:** macOS ties these permissions to the binary's signature. Unsigned
> builds lose them on every rebuild. If you have a Developer ID:
> `CODESIGN_ID="Developer ID Application: You (TEAM)" ./build.sh`

## Feed it to your agent

`inject-context.sh` prints the memo wrapped in a tag, and prints nothing when
the memo is stale — wire it into your agent's prompt hook. For Claude Code,
add a `UserPromptSubmit` hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "/path/to/screen/inject-context.sh" }] }
    ]
  }
}
```

The memo itself carries the instruction that matters: *answer "what was I
doing" from this memo alone — don't dig.* Every agent that reads it behaves
the same way.

## Options (env)

| variable | default | meaning |
| -------- | ------- | ------- |
| `MEMORIA_HOME` | `~/.memoria` | where memo + log live |
| `INTERVAL` | `2000` | sample interval in ms |
| `MEMORIA_TERMINAL_CMD` | – | shell command whose stdout describes your terminal (used for terminal windows instead of AX/OCR — e.g. your terminal manager's CLI) |

Run it once in the foreground to check the output: `node watch.mjs` (prints
the memo after 4 samples).

## Privacy

The memo and log contain whatever is on your screen — treat the store as
sensitive (it is created `0700`). Nothing is uploaded anywhere; there is no
network code in this module. Pair it with the judgment layer in the repo root:
the watcher gives your agents *context*, `decide()/recall()` gives them
*judgment*, and both compound locally.
