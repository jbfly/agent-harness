#!/bin/sh
# Install the Ponytail skill/plugin across supported local harnesses.
# Idempotent; safe to re-run. Uses the upstream adapters from:
#   https://github.com/DietrichGebert/ponytail

set -eu

PI_SOURCE="git:github.com/DietrichGebert/ponytail"
PLUGIN_SOURCE="https://github.com/DietrichGebert/ponytail.git"
PLUGIN_ID="ponytail@ponytail"
MARKETPLACE="ponytail"

ok()   { printf '  ok    %s\n' "$*"; }
skip() { printf '  skip  %s\n' "$*"; }
warn() { printf '  warn  %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

install_pi() {
  if ! have pi; then
    skip "pi not found"
    return
  fi

  if pi list 2>/dev/null | grep -qF "$PI_SOURCE"; then
    skip "pi already has $PI_SOURCE"
  else
    pi install "$PI_SOURCE"
    ok "installed Ponytail for pi"
  fi
}

install_codex() {
  if ! have codex; then
    skip "codex not found"
    return
  fi

  if codex plugin marketplace list 2>/dev/null | awk 'NR > 1 { print $1 }' | grep -qx "$MARKETPLACE"; then
    skip "codex marketplace already has $MARKETPLACE"
  else
    codex plugin marketplace add "$PLUGIN_SOURCE"
    ok "added Codex Ponytail marketplace"
  fi

  if codex plugin list --json 2>/dev/null | grep -Eq '"pluginId"[[:space:]]*:[[:space:]]*"ponytail@ponytail"'; then
    skip "codex already has $PLUGIN_ID"
  else
    codex plugin add "$PLUGIN_ID"
    ok "installed Ponytail for Codex"
  fi
}

install_claude() {
  if ! have claude; then
    skip "claude not found"
    return
  fi

  if claude plugin marketplace list 2>/dev/null | grep -Eq "^[[:space:]]*[❯>*-]?[[:space:]]*$MARKETPLACE([[:space:]]|$)"; then
    skip "claude marketplace already has $MARKETPLACE"
  else
    claude plugin marketplace add "$PLUGIN_SOURCE"
    ok "added Claude Ponytail marketplace"
  fi

  if claude plugin list --json 2>/dev/null | grep -Eq '"id"[[:space:]]*:[[:space:]]*"ponytail@ponytail"'; then
    skip "claude already has $PLUGIN_ID"
  else
    claude plugin install "$PLUGIN_ID"
    ok "installed Ponytail for Claude Code"
  fi
}

printf '%s\n' "agent-harness: installing Ponytail"
install_pi
install_codex
install_claude
printf '%s\n' "done. Restart/open new pi, codex, or Claude sessions so Ponytail hooks load."
