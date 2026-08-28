#!/bin/bash
# memoria screen — print the current-activity memo for LLM prompt injection.
# Wire this into your agent's prompt hook (e.g. Claude Code UserPromptSubmit)
# and every conversation starts with "what the user is doing right now".
# Prints nothing if the memo is stale (>10 min), so a dead watcher never
# injects outdated context.
MEMO="${MEMORIA_HOME:-$HOME/.memoria}/screen/current-activity.md"
if [ -f "$MEMO" ] && [ -z "$(find "$MEMO" -mmin +10 2>/dev/null)" ]; then
  echo "<memoria-screen current-activity>"
  cat "$MEMO"
  echo "</memoria-screen>"
fi
