#!/bin/sh
# Back up the hand-authored pi harness config into agent-harness/pi/.
#
# Curated ALLOWLIST — only code/config that is safe to version-control. It does NOT
# copy secrets (auth.json, trust.json), sessions, logs, caches, node_modules, or the
# git-cloned packages (those are reproducible via `pi install`). Re-run any time.

set -eu
SRC="$HOME/.pi/agent"
DEST="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/pi/agent"
mkdir -p "$DEST"

EX="--exclude=node_modules --exclude=.git --exclude=*.bak* --exclude=*.sqlite --exclude=__pycache__"

have_rsync=0
command -v rsync >/dev/null 2>&1 && have_rsync=1

sync_dir() {
  d=$1
  [ -d "$SRC/$d" ] || return 0
  mkdir -p "$DEST/$d"
  if [ "$have_rsync" = 1 ]; then
    rsync -a --delete $EX "$SRC/$d/" "$DEST/$d/"
  else
    rm -rf "$DEST/$d"; mkdir -p "$DEST/$d"
    cp -a "$SRC/$d/." "$DEST/$d/"
    find "$DEST/$d" -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null || true
    find "$DEST/$d" -name '*.bak*' -delete 2>/dev/null || true
  fi
  printf '  synced %s/\n' "$d"
}

# Hand-authored directories.
for d in extensions workflows agents prompts _retired; do sync_dir "$d"; done

# Safe single files (no secrets).
for f in settings.json models.json; do
  [ -f "$SRC/$f" ] && cp -p "$SRC/$f" "$DEST/$f" && printf '  synced %s\n' "$f"
done

printf 'pi config backed up to %s\n' "$DEST"
printf 'NOTE: secrets (auth.json/trust.json), sessions, caches, node_modules, and git: packages are intentionally excluded.\n'
