# Alpha agent activity: keep-awake, attention bar, usage keepalive

How alpha knows an AI agent is working, so it (a) doesn't suspend mid-task and
(b) shows agent state in DankBar. Cross-harness because **every harness must
report activity the same way** — codex, pi, hermes, and Claude Code.

## The shared signal: heartbeat files

Agents write JSON heartbeats to `~/.local/state/alpha-agent-activity/<harness>-<pid>.json`
via `~/.local/bin/alpha-agent-activity mark <harness> <event> [cwd]`.
A recent non-stop event = "actively working". `Stop`/`Notification`/`Error`/
`needs-attention` events = idle/attention, not active.

Two independent consumers read these:

| Consumer | What it does | TTL |
|---|---|---|
| `alpha-work inhibit-watch` (`alpha-agent-inhibit.service`) | holds a `systemd-inhibit --what=idle:sleep` block while any agent is active → **stops alpha suspending** | 900s |
| `alpha-agent-attention-json` → DankBar `alphaAgentAttention` widget | shows running/stopped agent windows in the bar | 180s |

## Per-harness wiring (the part that drifts)

Each harness must emit heartbeats **and** be in the watch lists. Two lists must
include the harness's *process command name* (what `tmux` reports as
`pane_current_command`):
- `~/.local/bin/alpha-work` → `agent_commands=(codex pi hermes claude)`
- `~/.local/bin/alpha-agent-attention-json` → `AGENT_COMMANDS = {"codex","pi","hermes","claude"}`

| Harness | Process comm | How it heartbeats |
|---|---|---|
| codex | `codex` | codex hooks → `alpha-agent-activity mark codex …` |
| pi | `pi` | pi extension events |
| hermes | `hermes` | hooks |
| **Claude Code** | `claude` | `~/.claude/settings.json` hooks: `PostToolUse`, `UserPromptSubmit`, `Stop` run `alpha-agent-activity mark claude <event>` (guarded to `hostname = jbfly-alpha` so it's a no-op on moon) |

**Claude Code was missing from all of this** (added 2026-06-23): not in either
watch list, no hooks. Symptoms — alpha suspended mid-session while driving via
Claude, and the attention bar never showed Claude windows. Fix = the rows above.

Gotchas:
- The process comm must match exactly. Claude Code reports as `claude` (verify:
  `ps -eo comm,args | grep claude`).
- Hooks load at **session start** — editing `settings.json` doesn't affect a
  running session. For an in-flight session, hold a manual inhibitor:
  `systemd-inhibit --what=idle:sleep --who=me --why=working sleep 7200 &`.
- tmux window names are often generic (`fish`). `alpha-agent-attention-json`
  falls back to the **project dir basename** (`GENERIC_NAMES`) so the bar shows
  e.g. `linux-ops` instead of `fish`.

## Separate thing: 5-hour usage-window keepalive

Not about sleep — these start the rolling usage window on a schedule so the
quota is "warm". Units linked from `~/git/claudecode/keepalive/`:
`claude-keepalive.timer` + `codex-keepalive.timer` (every 5h; one `claude -p`
haiku ping / one codex-via-pi ping each). Enable:
`systemctl --user enable --now claude-keepalive.timer codex-keepalive.timer`.

## Live paths (source of truth; snapshots may lag)
- `~/.local/bin/alpha-work` (inhibit-watch, agent_commands)
- `~/.local/bin/alpha-agent-attention-json` (bar data; runs on alpha, moon ssh's to it)
- `~/.local/bin/alpha-agent-activity` (heartbeat writer)
- `~/.config/systemd/user/alpha-agent-inhibit.service`
- `~/.config/DankMaterialShell/plugins/alphaAgentAttention/` (DankBar widget)
- `~/.claude/settings.json` (Claude Code hooks)
