# agent-harness

One source of truth for how my AI agents write and work — shared across every harness
(codex, pi, hermes, Claude Code, and whatever comes next), and portable enough to hand to
someone else (e.g. Anna) by cloning and running one script.

The problem this solves: each harness reads its operating instructions from a different file,
so the same rules end up copied into many places and drift apart. Here the rules live **once**;
the installer wires them into each harness's expected location with symlinks (or, for pi, a
shell wrapper). Change a rule in one file and every harness picks it up.

## Layout

```
profiles/
  house-style.md   # the global voice + working rules. The important one.
  seth-mode.md     # an opt-in terse register for code/systems writing (off by default)
install.sh         # idempotent, cross-platform installer
install-ponytail.sh # idempotent installer for the upstream Ponytail skill/plugin
AGENTS.md          # this repo's own short pointer
```

## Install

```sh
git clone <this repo> ~/git/agent-harness   # or wherever
sh ~/git/agent-harness/install.sh
sh ~/git/agent-harness/install-ponytail.sh   # optional: lazy senior dev skill/plugin
exec fish   # (or open a new shell) so the pi wrapper loads
```

Re-run `install.sh` any time — it's idempotent and backs up any real file it replaces to
`<file>.bak.<timestamp>`. It only touches harnesses that are actually installed.

## What it wires

| Harness | How it gets the house style |
|---|---|
| codex   | `~/.codex/AGENTS.md` → symlink to `~/.config/agents/house-style.md` |
| Claude  | one `@import` line appended to `~/.claude/CLAUDE.md` |
| pi      | a fish function (and a POSIX `pi-wrapper.sh`) that passes `--append-system-prompt ~/.config/agents/house-style.md` |
| hermes  | reads workspace `AGENTS.md` automatically; add the import to `~/.hermes/SOUL.md` for the global voice |

`~/.config/agents/` is the neutral runtime path everything points at, so harness configs never
reference the git checkout directly.

## The three scopes

This repo holds only the **global** layer. The full picture:

1. **Global** (every project, every harness) — `profiles/house-style.md`, installed here.
2. **Exceptional Spirits** (all `es-*` repos, shared with Anna) — accounting-for-non-accountants
   rules and the brand glossary live in the `es-ai-ops` repo, inherited by every ES project.
3. **Per-project** — each repo's own `AGENTS.md` for its specific state and workflow.

A project's `AGENTS.md` should carry only what's specific to that project; the global voice and
the ES rules come from layers 1 and 2.

## Adding a harness later

Add one case to `install.sh` pointing the new tool's instruction file at
`~/.config/agents/house-style.md`. Nothing else changes.

## Ponytail

`install-ponytail.sh` installs the upstream [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) adapters:

| Harness | Install path |
|---|---|
| pi | `pi install git:github.com/DietrichGebert/ponytail` |
| codex | `codex plugin marketplace add …` + `codex plugin add ponytail@ponytail` |
| Claude Code | `claude plugin marketplace add …` + `claude plugin install ponytail@ponytail` |

Ponytail defaults to `full` mode. Start a new session after installing; use `/ponytail off` or say `normal mode` to disable it for a session.

## seth-mode

`profiles/seth-mode.md` is a separate, opt-in writing register (Seth's terse kernel/Plan 9
style) for code and systems writing. It is never a default. In pi: `/seth on`.
