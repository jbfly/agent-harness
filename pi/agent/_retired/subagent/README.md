# subagent pi extension

Installed from Pi's upstream `examples/extensions/subagent`, with local model
choices adjusted for this machine.

## Commands

- `/agents` lists user-level subagents.
- `/agents project` lists project-local subagents for a trusted project.
- `/agents both` lists both, with project agents overriding same-name user agents.

## Tool

The extension registers the `subagent` tool.

Modes:

- single: `{ "agent": "scout", "task": "..." }`
- parallel: `{ "tasks": [{ "agent": "scout", "task": "..." }, ...] }`
- chain: `{ "chain": [{ "agent": "scout", "task": "..." }, ...] }`

The default scope is user agents in `~/.pi/agent/agents`. Project agents in
`.pi/agents` require `agentScope: "project"` or `"both"`.

## Agents

User agents installed in `~/.pi/agent/agents`:

- `scout`: read-heavy codebase reconnaissance, `openai-codex/gpt-5.4-mini`
- `planner`: implementation planning, `openai-codex/gpt-5.4-mini`
- `reviewer`: read-only code review, `openai-codex/gpt-5.4-mini`
- `worker`: implementation work, `openai-codex/gpt-5.5`

## Prompt templates

Installed in `~/.pi/agent/prompts`:

- `/scout-and-plan <task>`
- `/implement <task>`
- `/implement-and-review <task>`
