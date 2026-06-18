# pi-workflow-engine fork

pi loads the workflow engine from a fork, set in `~/.pi/agent/settings.json`:

```
"git:github.com/jbfly/pi-workflow-engine"
```

The fork = **upstream `master` (latest release) + one self-contained patch**. As of
2026-06-18 the base is **v0.8.0** and the single patch is the on-disk activity log.

## The one patch — per-subagent activity logs on disk (for `/wlogs`)

New file `src/agent-log.ts` + four best-effort logger calls in `src/agent-runner.ts`
(`runAgent`). Each run writes `~/.pi/agent/workflow-logs/<timestamp>/<NN>-<label>.log`
with the model, every tool call **with its arguments**, the agent's text, and the final
output (colorized). The `/wlogs` extension opens these as a tmux dashboard. Tail one live:

```sh
tail -f ~/.pi/agent/workflow-logs/$(ls -t ~/.pi/agent/workflow-logs | head -1)/*.log
```

The graft points in `agent-runner.ts` (all wrapped in try/catch — logging can never break a run):
1. `import { createAgentLogger, modelDisplay } from "./agent-log.ts";`
2. `let logger: ReturnType<typeof createAgentLogger> | undefined;` before the inner `try`.
3. After `resolveAgentModel(...)`: `logger = createAgentLogger(rc, label, rowId); logger?.header(modelDisplay(model, opts.model), prompt);`
4. On success: capture the `timeSync` result, `logger?.append(...); logger?.finalize("done", result);`, then `return result;`
5. In `catch`: `logger?.finalize("failed", error...);`

### What used to be here (now upstream, dropped from the fork)
The old fork also carried a **cross-provider per-agent model** fix. That landed upstream
via PR #12 and was hardened further in #14 (`resolveAgentModel` accepts `provider/id` for
any provider and throws on not-found). Upstream's version supersedes ours, so it's gone.
The old fork tip is preserved on branch `archive/pre-v0.8.0`.

## Staying current with upstream releases (the recipe)

The fork has both remotes: `origin` (jbfly fork) and `upstream` (timbrinded). When upstream
cuts a release, replay the one patch on top of it:

```sh
cd ~/git/pi-workflow-engine
git fetch upstream --tags
git rebase upstream/master           # replays the activity-log commit onto the new release
# if it conflicts, it's only the graft points in agent-runner.ts — keep both sides
npm install && npm run typecheck && bun test    # expect: 151+ pass, typecheck clean
git push origin master --force-with-lease

# point pi's installed clone at the new master:
cd ~/.pi/agent/git/github.com/jbfly/pi-workflow-engine
git fetch origin && git reset --hard origin/master
# restart pi to load it
```

`bun` is required only for the test suite (`curl -fsSL https://bun.sh/install | bash`).
The engine has no runtime `dependencies` — pi provides `@earendil-works/*` at load time —
so there's nothing else to install in the clone.

## Files here (reference snapshots)
- `agent-log.ts` — the activity-log module (source of truth is the fork).
- `agent-runner.patched.ts` — a snapshot of the patched runner, for diffing if a rebase
  goes sideways.

## If you ever want to drop the fork entirely
Once you no longer need the on-disk logs, `pi install npm:pi-workflow-engine` returns you to
the plain upstream package (which already has the model fix + usage-cost reporting).
