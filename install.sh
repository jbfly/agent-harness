#!/bin/sh
# agent-harness installer — wire the canonical agent config into each harness.
# Idempotent, POSIX, cross-platform (Linux + macOS). Safe to re-run any time.
#
# It makes the canonical profiles available at ~/.config/agents/ (a stable,
# harness-neutral path) and then points each installed harness at them:
#   codex   ->  ~/.codex/AGENTS.md   symlinked to house-style.md
#   claude  ->  ~/.claude/CLAUDE.md  imports house-style.md (one @line)
#   pi      ->  a fish function + a POSIX shell function that append house-style.md
#   hermes  ->  prints guidance (it reads workspace AGENTS.md + global SOUL.md)
#
# Existing REAL files are backed up to <file>.bak.<timestamp> before relinking.
# Existing symlinks that already point at the right place are left alone.

set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROFILES="$REPO_DIR/profiles"
XDG="${XDG_CONFIG_HOME:-$HOME/.config}/agents"
STAMP=$(date +%Y%m%d%H%M%S)

ok()   { printf '  ok    %s\n' "$*"; }
skip() { printf '  skip  %s\n' "$*"; }
warn() { printf '  warn  %s\n' "$*"; }

# Move a real file/dir aside; leave symlinks alone.
backup_if_real() {
  if [ -e "$1" ] && [ ! -L "$1" ]; then
    mv "$1" "$1.bak.$STAMP"
    warn "backed up $1 -> $1.bak.$STAMP"
  fi
}

# Idempotent symlink: link SRC DEST
link() {
  _src=$1; _dest=$2
  if [ -L "$_dest" ] && [ "$(readlink "$_dest")" = "$_src" ]; then
    skip "$_dest -> $_src"
    return
  fi
  mkdir -p "$(dirname "$_dest")"
  backup_if_real "$_dest"
  ln -sf "$_src" "$_dest"
  ok "$_dest -> $_src"
}

printf '%s\n' "agent-harness: installing from $REPO_DIR"

# 1) neutral runtime location everything else points at
mkdir -p "$XDG"
link "$PROFILES/house-style.md" "$XDG/house-style.md"
link "$PROFILES/seth-mode.md"   "$XDG/seth-mode.md"

# 2) codex — global AGENTS.md
if [ -d "$HOME/.codex" ]; then
  link "$XDG/house-style.md" "$HOME/.codex/AGENTS.md"
else
  skip "codex not present (~/.codex)"
fi

# 3) claude — global CLAUDE.md import line
if [ -d "$HOME/.claude" ]; then
  _md="$HOME/.claude/CLAUDE.md"
  _import="@$XDG/house-style.md"
  if [ -f "$_md" ] && grep -qF "$_import" "$_md"; then
    skip "claude already imports house-style"
  else
    printf '%s\n' "$_import" >> "$_md"
    ok "appended import to $_md"
  fi
else
  skip "claude not present (~/.claude)"
fi

# 4) pi — no global prompt file; wrap the binary (the flag takes a PATH)
if [ -d "$HOME/.pi" ]; then
  if command -v fish >/dev/null 2>&1; then
    _fish="${XDG_CONFIG_HOME:-$HOME/.config}/fish/functions/pi.fish"
    mkdir -p "$(dirname "$_fish")"
    cat > "$_fish" <<EOF
# Managed by agent-harness. Appends the shared house style to every pi run.
function pi --wraps pi
    set -l style "$XDG/house-style.md"
    if test -f \$style
        command pi --append-system-prompt \$style \$argv
    else
        command pi \$argv
    end
end
EOF
    ok "wrote fish wrapper $_fish"
  fi
  _posix="$XDG/pi-wrapper.sh"
  cat > "$_posix" <<EOF
# Managed by agent-harness. For bash/zsh: add  . "$_posix"  to your rc file.
pi() {
  if [ -f "$XDG/house-style.md" ]; then
    command pi --append-system-prompt "$XDG/house-style.md" "\$@"
  else
    command pi "\$@"
  fi
}
EOF
  ok "wrote POSIX pi wrapper $_posix (source it for bash/zsh)"
else
  skip "pi not present (~/.pi)"
fi

# 5) hermes — reads workspace AGENTS.md automatically; global voice goes in SOUL.md
if [ -d "$HOME/.hermes" ]; then
  warn "hermes: add the line '@$XDG/house-style.md' (or paste its text) into ~/.hermes/SOUL.md for the global voice"
else
  skip "hermes not present (~/.hermes)"
fi

printf '%s\n' "done. Start a new shell (or 'exec fish') so the pi wrapper loads."
