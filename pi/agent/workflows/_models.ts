// _models.ts — model tiers for the workflows.
//
// EDIT HERE to change which model each role uses. The leading underscore keeps this
// file from being registered as a workflow. Per-agent model selection works because
// the engine fork parses "provider/id" (github.com/jbfly/pi-workflow-engine).
//
// Format: "provider/id". When you go back to the cheap plan or want to experiment,
// swap these for opencode-go/deepseek-v4-flash, opencode/qwen3.6-plus, llama.cpp/<model>, etc.

export const SMART = "openai-codex/gpt-5.5";            // orchestrate, synthesize, hard reasoning
export const WORKER = "openai-codex/gpt-5.4";           // capable delegated work
export const FAST = "openai-codex/gpt-5.4-mini";        // bulk reading, simple extraction
export const BULK = "openai-codex/gpt-5.3-codex-spark"; // wide fan-out; metered on its own 5h/7d quota
