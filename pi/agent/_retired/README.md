# Retired pi components

Moved out of pi's load path on 2026-06-16 in favour of the pi-workflow-engine
(`git:github.com/jbfly/pi-workflow-engine`) as the single multi-agent path.

## What's here and why

- `subagent/` — the home-grown subagent extension. It spawned child `pi` processes per
  agent. The forked engine now does the same fan-out (and per-agent model selection across
  any provider), so this is redundant. dynamax on/off is the new "use subagents or not" switch.
- `prompts/implement.md`, `prompts/implement-and-review.md`, `prompts/scout-and-plan.md` —
  these slash-prompts drove the subagent tool, so they'd break without it. Retired with it.

## Still in place (intentionally)

- `~/.pi/agent/agents/*.md` (worker/scout/planner/reviewer) — only read by the subagent
  extension, so now inert. Left in place as a reference; safe to delete later.
- `goal-mode` extension — kept; it's the autonomous-loop capability the engine doesn't have.

## Restore

```sh
mv ~/.pi/agent/_retired/subagent ~/.pi/agent/extensions/subagent
mv ~/.pi/agent/_retired/prompts/*.md ~/.pi/agent/prompts/
```
Then restart pi.

## Replacement

The `/implement` flow can be reimplemented as a workflow in `~/.pi/agent/workflows/`
(scout → plan → implement → review, with per-agent model tiers) if you want it back as a
single `/workflow implement "..."` command. Ask and it can be authored.
