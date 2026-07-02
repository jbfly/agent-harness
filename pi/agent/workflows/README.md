# Custom pi workflows

Drop a `*.ts` file here and pi-workflow-engine registers it as `/workflow <name>`.
Files starting with `_` or `.` are ignored (so `_models.ts` is shared config, not a workflow).
Built-in names win collisions, so custom workflows have their own names.

## What's here

- **`report`** — investigate a question, then write a warm, plain-language report.
  `/workflow report "reconcile Anna's 2025 sheet vs Odoo receivables"`
- **`research`** — answer an open question by fanning out readers across angles, then synthesizing.
  `/workflow research "how does evidence_db.py build work end to end?"`
- **`es-find`** — parallel read-only search across the ES mailbox + evidence catalogs.
  `/workflow es-find "Example Distillery INV-0123"`
- **`es-verify`** — two independent skeptical verifiers check a claim about the books from
  read-only evidence, then a go/no-go. **Never writes to Odoo.**
  `/workflow es-verify "INV-0123 is fully settled"`

## Models & tiering

Model tiers live in `_models.ts` — **edit that one file** to change which model each role uses:
`SMART` (gpt-5.5) for synthesis/hard reasoning, `WORKER` (gpt-5.4), `FAST` (gpt-5.4-mini) for
bulk reading, `BULK` (gpt-5.3-codex-spark, own quota) for wide fan-out. Switch them to
opencode/deepseek/local when you want cheaper.

Per-agent models work because pi is running the **forked engine**
(`git:github.com/jbfly/pi-workflow-engine`), which parses `provider/id`. The stock npm engine
only honored Anthropic ids and silently fell back to the host model.

Each subagent's model + tool calls (with args) + output are logged to
`~/.pi/agent/workflow-logs/<run>/`. Watch live:
```fish
tail -f ~/.pi/agent/workflow-logs/(command ls -t ~/.pi/agent/workflow-logs | head -1)/*.log
```
(`command ls` dodges the eza alias.)

## dynamax vs explicit invocation

- `/workflow <name> "..."` runs a named workflow directly — always available.
- `dynamax` (one-shot token, or `/workflow:dynamax on`) lets the *main* agent spin up
  multi-agent workflows on its own. Off = single-threaded / token-thrifty.

## Adding a workflow

```ts
import { SMART, FAST } from "./_models.ts";
export const meta = { name: "thing", description: "...", phases: [{ title: "A" }] };
export default async function run(api) {
  api.phase("A");
  const parts = await api.parallel([ () => api.agent("do X", { model: FAST, tools: ["bash","read"] }) ]);
  const summary = await api.agent("synthesize: " + parts.join("\n"), { label: "write", model: SMART });
  return { summary }; // the engine renders `summary` verbatim as the result
}
```
`api`: `agent(prompt, opts)`, `parallel(thunks)`, `pipeline(...)`, `phase(title)`, `log(msg)`, `args`, `cwd`.
`opts`: `{ label, phase, model, thinkingLevel, tools, schema }`. With `schema` (typebox) the agent
returns structured data.
