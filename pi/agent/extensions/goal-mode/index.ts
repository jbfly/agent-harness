import { complete, type Api, type Message, type Model, type UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

type GoalStatus = "active" | "paused" | "achieved";

type GoalState = {
	status: GoalStatus;
	objective: string;
	createdAt: number;
	updatedAt: number;
	completedAt?: number;
	turns: number;
	tokens: number;
	maxTurns?: number;
	maxMinutes?: number;
	lastReason?: string;
	lastNext?: string;
	evaluatorModel?: string;
};

type StoredGoalState = GoalState | { status: "none" };

type Verdict = {
	complete: boolean;
	reason: string;
	next?: string;
	confidence?: "low" | "medium" | "high";
};

const SAVE_TYPE = "goal-mode";
const MESSAGE_TYPE = "goal-mode";
const DEFAULT_MAX_TURNS = 50;
const DEFAULT_MAX_MINUTES = 240;
const MAX_CONTEXT_BYTES = 60000;

function now(): number {
	return Date.now();
}

function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function trimOneLine(text: string, max = 120): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function textFromMessage(message: Message): string {
	const anyMessage = message as any;
	const content = anyMessage.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const part of content) {
		if (part?.type === "text") parts.push(part.text ?? "");
		else if (part?.type === "toolCall") {
			let args = "";
			try {
				args = JSON.stringify(part.arguments ?? {}).slice(0, 1200);
			} catch {
				args = "{}";
			}
			parts.push(`[tool call: ${part.name ?? "unknown"} ${args}]`);
		}
	}
	return parts.join("\n").trim();
}

function collectConversationEvidence(ctx: ExtensionContext, extraMessages: Message[] = []): string {
	const entries = ctx.sessionManager.getBranch();
	const chunks: string[] = [];

	for (const entry of entries.slice(-80)) {
		if (entry.type !== "message") continue;
		const message = (entry as any).message as Message;
		const role = (message as any).role ?? "message";
		const tool = (message as any).toolName ? ` ${(message as any).toolName}` : "";
		const text = textFromMessage(message);
		if (!text) continue;
		chunks.push(`### ${role}${tool}\n${text}`);
	}

	for (const message of extraMessages) {
		const role = (message as any).role ?? "message";
		const tool = (message as any).toolName ? ` ${(message as any).toolName}` : "";
		const text = textFromMessage(message);
		if (!text) continue;
		chunks.push(`### ${role}${tool}\n${text}`);
	}

	let result = chunks.join("\n\n");
	while (Buffer.byteLength(result, "utf8") > MAX_CONTEXT_BYTES && chunks.length > 1) {
		chunks.shift();
		result = chunks.join("\n\n");
	}
	return result;
}

function extractAssistantText(message: Message): string {
	return textFromMessage(message).trim();
}

function parseVerdict(raw: string): Verdict {
	const trimmed = raw.trim();
	if (!trimmed) throw new Error("Evaluator returned empty output");

	const candidates = [trimmed];
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) candidates.push(fenced[1].trim());
	const object = raw.match(/\{[\s\S]*\}/);
	if (object) candidates.push(object[0]);

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as Record<string, unknown>;
			return {
				complete: parsed.complete === true,
				reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : raw.trim(),
				next: typeof parsed.next === "string" ? parsed.next.trim() : undefined,
				confidence:
					parsed.confidence === "low" || parsed.confidence === "medium" || parsed.confidence === "high"
						? parsed.confidence
						: undefined,
			};
		} catch {
			// keep trying
		}
	}

	throw new Error(`Evaluator returned non-JSON output: ${trimmed.slice(0, 500)}`);
}

function parseSetArgs(input: string): { objective: string; maxTurns?: number; maxMinutes?: number } {
	const tokens = input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
	const rest: string[] = [];
	let maxTurns: number | undefined = DEFAULT_MAX_TURNS;
	let maxMinutes: number | undefined = DEFAULT_MAX_MINUTES;

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i].replace(/^"|"$/g, "");
		const next = tokens[i + 1]?.replace(/^"|"$/g, "");
		if ((token === "--max-turns" || token === "-t") && next) {
			maxTurns = Number.parseInt(next, 10);
			i++;
			continue;
		}
		if ((token === "--max-minutes" || token === "-m") && next) {
			maxMinutes = Number.parseInt(next, 10);
			i++;
			continue;
		}
		if (token === "--no-limit") {
			maxTurns = undefined;
			maxMinutes = undefined;
			continue;
		}
		rest.push(tokens[i]);
	}

	return {
		objective: rest.join(" ").trim(),
		maxTurns: Number.isFinite(maxTurns) && maxTurns! > 0 ? maxTurns : undefined,
		maxMinutes: Number.isFinite(maxMinutes) && maxMinutes! > 0 ? maxMinutes : undefined,
	};
}

function buildGoalKickoff(goal: GoalState): string {
	return [
		"/goal is active in this pi session.",
		"",
		"Goal condition:",
		goal.objective,
		"",
		"Work toward this condition autonomously. Use a checkpoint loop: plan the next small step, act, verify, and report evidence. Surface the exact command output, test result, file count, or other proof needed by the condition. If blocked by missing credentials, unavailable services, or a user-only decision, say BLOCKED and explain the blocker. If you believe the condition is satisfied, show the final verification evidence and say GOAL_READY_FOR_EVALUATION.",
	].join("\n");
}

function buildGoalContinuation(goal: GoalState, verdict: Verdict): string {
	return [
		"Continue the active /goal run.",
		"",
		"Goal condition:",
		goal.objective,
		"",
		"Evaluator says the condition is not met yet.",
		`Reason: ${verdict.reason}`,
		verdict.next ? `Suggested next step: ${verdict.next}` : undefined,
		"",
		"Take the next useful checkpoint. Run or quote verification evidence. Stop only if blocked by something that requires the user.",
	]
		.filter(Boolean)
		.join("\n");
}

async function selectEvaluatorModel(ctx: ExtensionContext): Promise<Model<Api>> {
	const candidates: Array<[string, string]> = [
		["openai-codex", "gpt-5.4-mini"],
		["openai-codex", "gpt-5.3-codex-spark"],
		["anthropic", "claude-haiku-4-5"],
	];

	for (const [provider, id] of candidates) {
		const model = ctx.modelRegistry.find(provider, id);
		if (!model) continue;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (auth.ok) return model as Model<Api>;
	}

	if (ctx.model) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (auth.ok) return ctx.model as Model<Api>;
	}

	throw new Error("No authenticated model is available for /goal evaluation");
}

async function evaluateGoal(ctx: ExtensionContext, goal: GoalState, extraMessages: Message[] = []): Promise<Verdict> {
	const model = await selectEvaluatorModel(ctx);
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) throw new Error(auth.ok ? `No API key for ${model.provider}/${model.id}` : auth.error);

	const evidence = collectConversationEvidence(ctx, extraMessages);
	const userMessage: UserMessage = {
		role: "user",
		content: [
			"Evaluate whether the active goal condition is satisfied by the transcript evidence.",
			"",
			"Goal condition:",
			goal.objective,
			"",
			`Turns evaluated so far: ${goal.turns}`,
			"",
			"Transcript evidence:",
			evidence || "(no evidence)",
		].join("\n"),
		timestamp: now(),
	};

	const response = await complete(
		model,
		{
			systemPrompt: [
				"You are a strict completion evaluator for an autonomous coding-agent goal loop.",
				"Return only JSON with this shape: {\"complete\": boolean, \"reason\": string, \"next\": string, \"confidence\": \"low\"|\"medium\"|\"high\"}.",
				"Mark complete=true only when the transcript contains explicit evidence that the goal condition is met. Do not accept assertions without evidence. If tests, builds, lint, screenshots, or file counts are required, the transcript must show the relevant result. You cannot run tools or inspect files yourself.",
				"If the condition is not met, explain the gap and propose one concrete next step.",
			].join("\n"),
			messages: [userMessage],
		},
		{ apiKey: auth.apiKey, headers: auth.headers, temperature: 0, maxTokens: 800 },
	);

	goal.evaluatorModel = `${model.provider}/${model.id}`;
	return parseVerdict(extractAssistantText(response));
}

export default function goalModeExtension(pi: ExtensionAPI): void {
	let goal: GoalState | undefined;
	let evaluating = false;

	function persist(): void {
		pi.appendEntry<StoredGoalState>(SAVE_TYPE, goal ?? { status: "none" });
	}

	function updateUi(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (!goal) {
			ctx.ui.setStatus("goal-mode", undefined);
			ctx.ui.setWidget("goal-mode", undefined);
			return;
		}

		const elapsed = formatDuration(now() - goal.createdAt);
		const label = goal.status === "active" ? `◎ goal ${goal.turns}` : goal.status === "paused" ? "Ⅱ goal" : "✓ goal";
		const color = goal.status === "active" ? "accent" : goal.status === "paused" ? "warning" : "success";
		ctx.ui.setStatus("goal-mode", ctx.ui.theme.fg(color, `${label} ${elapsed}`));

		const lines = [
			ctx.ui.theme.fg(color, `/goal ${goal.status} · ${goal.turns}${goal.maxTurns ? `/${goal.maxTurns}` : ""} turns · ${elapsed}`),
			ctx.ui.theme.fg("dim", `  ${trimOneLine(goal.objective, 150)}`),
		];
		if (goal.lastReason) lines.push(ctx.ui.theme.fg("dim", `  eval: ${trimOneLine(goal.lastReason, 150)}`));
		ctx.ui.setWidget("goal-mode", lines, { placement: "belowEditor" });
	}

	function restore(ctx: ExtensionContext): void {
		goal = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== SAVE_TYPE) continue;
			const data = (entry as any).data as StoredGoalState | undefined;
			if (!data || data.status === "none") goal = undefined;
			else goal = data;
		}
		updateUi(ctx);
	}

	function sendGoalPrompt(ctx: ExtensionContext, prompt: string): void {
		if (ctx.isIdle()) pi.sendUserMessage(prompt);
		else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	}

	function goalReport(): string {
		if (!goal) return "No active /goal.";
		const elapsed = formatDuration(now() - goal.createdAt);
		return [
			`/goal ${goal.status}`,
			`condition: ${goal.objective}`,
			`elapsed: ${elapsed}`,
			`turns: ${goal.turns}${goal.maxTurns ? `/${goal.maxTurns}` : ""}`,
			goal.maxMinutes ? `time limit: ${goal.maxMinutes}m` : undefined,
			goal.evaluatorModel ? `evaluator: ${goal.evaluatorModel}` : undefined,
			goal.lastReason ? `last reason: ${goal.lastReason}` : undefined,
			goal.lastNext ? `next: ${goal.lastNext}` : undefined,
		]
			.filter(Boolean)
			.join("\n");
	}

	function postReport(): void {
		pi.sendMessage({ customType: MESSAGE_TYPE, content: goalReport(), display: true });
	}

	async function pause(ctx: ExtensionContext, reason?: string): Promise<void> {
		if (!goal) return;
		goal.status = "paused";
		goal.updatedAt = now();
		if (reason) goal.lastReason = reason;
		persist();
		updateUi(ctx);
		ctx.ui.notify(reason ? `/goal paused: ${reason}` : "/goal paused", "warning");
	}

	pi.registerMessageRenderer(MESSAGE_TYPE, (message, _options, theme) => {
		const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content, null, 2);
		return new Text(`${theme.fg("accent", "goal")}\n${theme.fg("dim", content)}`, 0, 0);
	});

	pi.registerCommand("goal", {
		description: "Run an autonomous goal loop until a verifiable condition is met",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const input = args.trim();
			const lower = input.toLowerCase();

			if (!input || lower === "status" || lower === "show") {
				updateUi(ctx);
				postReport();
				return;
			}

			if (["clear", "stop", "off", "reset", "none", "cancel"].includes(lower)) {
				goal = undefined;
				persist();
				updateUi(ctx);
				ctx.ui.notify("/goal cleared", "info");
				return;
			}

			if (lower === "pause") {
				await pause(ctx);
				return;
			}

			if (lower === "resume") {
				if (!goal) {
					ctx.ui.notify("No goal to resume", "warning");
					return;
				}
				goal.status = "active";
				goal.updatedAt = now();
				persist();
				updateUi(ctx);
				sendGoalPrompt(ctx, buildGoalContinuation(goal, { complete: false, reason: "Goal resumed by user." }));
				return;
			}

			if (goal?.status === "active" && ctx.hasUI) {
				const ok = await ctx.ui.confirm("Replace active /goal?", `Current: ${goal.objective}\n\nNew: ${input}`);
				if (!ok) return;
			}

			const parsed = parseSetArgs(input);
			if (!parsed.objective) {
				ctx.ui.notify("Usage: /goal [--max-turns N] [--max-minutes N] <verifiable condition>", "warning");
				return;
			}

			goal = {
				status: "active",
				objective: parsed.objective,
				createdAt: now(),
				updatedAt: now(),
				turns: 0,
				tokens: 0,
				maxTurns: parsed.maxTurns,
				maxMinutes: parsed.maxMinutes,
			};
			persist();
			updateUi(ctx);
			sendGoalPrompt(ctx, buildGoalKickoff(goal));
		},
	});

	pi.on("before_agent_start", async (event) => {
		if (!goal || goal.status !== "active") return;
		return {
			systemPrompt:
				event.systemPrompt +
				`\n\nActive /goal condition: ${goal.objective}\nWork in checkpoints. Surface evidence that the evaluator can inspect. If complete, show the final check output and say GOAL_READY_FOR_EVALUATION. If blocked, say BLOCKED and explain exactly what user action is needed.`,
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!goal || goal.status !== "active" || evaluating) return;

		goal.turns += 1;
		for (const message of event.messages as Message[]) {
			const usage = (message as any).usage;
			if (usage?.totalTokens) goal.tokens += usage.totalTokens;
		}

		if (goal.maxTurns && goal.turns >= goal.maxTurns) {
			await pause(ctx, `max turns reached (${goal.maxTurns})`);
			return;
		}
		if (goal.maxMinutes && now() - goal.createdAt >= goal.maxMinutes * 60_000) {
			await pause(ctx, `max minutes reached (${goal.maxMinutes})`);
			return;
		}

		evaluating = true;
		try {
			ctx.ui.setStatus("goal-mode", ctx.ui.theme.fg("accent", `◎ goal eval ${goal.turns}`));
			const verdict = await evaluateGoal(ctx, goal, event.messages as Message[]);
			goal.lastReason = verdict.reason;
			goal.lastNext = verdict.next;
			goal.updatedAt = now();

			if (verdict.complete) {
				goal.status = "achieved";
				goal.completedAt = now();
				persist();
				updateUi(ctx);
				ctx.ui.notify(`/goal achieved: ${trimOneLine(verdict.reason, 180)}`, "info");
				postReport();
				return;
			}

			persist();
			updateUi(ctx);
			sendGoalPrompt(ctx, buildGoalContinuation(goal, verdict));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await pause(ctx, `evaluator failed: ${message}`);
		} finally {
			evaluating = false;
		}
	});

	pi.on("session_start", async (_event, ctx) => restore(ctx));
	pi.on("session_tree", async (_event, ctx) => restore(ctx));
	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("goal-mode", undefined);
		ctx.ui.setWidget("goal-mode", undefined);
	});
}
