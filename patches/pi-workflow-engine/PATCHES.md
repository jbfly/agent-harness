# pi-workflow-engine patches

Local patches to `pi-workflow-engine` (installed at
`~/.pi/agent/npm/node_modules/pi-workflow-engine/.pi/extensions/pi-workflow-engine/`).
They live in `node_modules`, so **`pi update` will revert them** — re-apply after an update,
or (better) fork the package and `pi install` from the fork (see bottom).

Patched against v0.7.0.

## Change 1 — per-agent model works for any provider

`src/agent-runner.ts`. The engine resolved `agent({model})` only against the `"anthropic"`
provider and silently fell back to the host model otherwise — so cross-provider tiering
(gpt-5.5 orchestrator + gpt-5.4-mini/spark workers) never worked.

Old:
```ts
const model = opts.model ? rc.modelRegistry.find("anthropic", opts.model) ?? rc.hostModel : rc.hostModel;
```
New (parse `provider/id`):
```ts
let model = rc.hostModel;
if (opts.model) {
  const slash = opts.model.indexOf("/");
  const found =
    slash > 0
      ? rc.modelRegistry.find(opts.model.slice(0, slash), opts.model.slice(slash + 1))
      : rc.modelRegistry.find("anthropic", opts.model);
  model = found ?? rc.hostModel;
}
```
Usage in a workflow: `agent(prompt, { model: "openai-codex/gpt-5.4-mini" })`.

## Change 2 — per-subagent activity logs on disk

New file `src/agent-log.ts` (copied here as `agent-log.ts`) + hooks in `src/agent-runner.ts`.
Each run writes `~/.pi/agent/workflow-logs/<timestamp>/<NN>-<label>.log` containing the model,
every tool call **with its arguments**, the agent's text, and the final output. Tail it live:

```sh
tail -f ~/.pi/agent/workflow-logs/$(ls -t ~/.pi/agent/workflow-logs | head -1)/*.log
```

Hooks added in `agent-runner.ts` (all best-effort, wrapped in try/catch so they can't break a run):
1. `import { createAgentLogger, modelDisplay } from "./agent-log.ts";`
2. `let logger: ReturnType<typeof createAgentLogger> | undefined;` declared before the `try`.
3. After model resolution: `logger = createAgentLogger(rc, label, rowId); logger?.header(modelDisplay(model, opts.model), prompt);`
4. In the `subscribe` callback: `logger?.append(activeSession.state.messages);`
5. On success: `logger?.append(...); logger?.finalize("done", result);`
6. In `catch`: `logger?.finalize("failed", error...);`

The full patched file is saved here as `agent-runner.patched.ts` for reference/diffing.

## Re-applying after `pi update`

1. `cp agent-log.ts <pkg>/src/agent-log.ts` (new file — safe to copy as-is).
2. Re-apply the `agent-runner.ts` edits above (diff against `agent-runner.patched.ts`).
3. Restart pi (or `/reload`).

## The durable fix: fork

To stop re-applying, fork `github.com/timbrinded/pi-workflow-engine`, commit these two changes,
and `pi install git:github.com/jbfly/pi-workflow-engine`. Then open a PR upstream for Change 1
(the provider bug is a clear fix everyone benefits from); Change 2 could go up too.
