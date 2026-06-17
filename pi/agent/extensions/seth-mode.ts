import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

type SethVariant = "full" | "docs";

type SavedState = {
	enabled?: boolean;
	variant?: SethVariant;
};

const SAVE_TYPE = "seth-mode";
const DEFAULT_ENABLED = false;
const DEFAULT_VARIANT: SethVariant = "full";

const SETH_PROMPT =
	"IMPORTANT PAY ATTENTION WHEN WRITING ENGLISH: language in comments, specs, plans and other md files, etc should read like linux kernel mailing list posts, or OpenBSD man pages, or Plan 9 / Bell Labs papers and docs, with SQLite exactness.";

const FULL_MODE_SUFFIX =
	"Default to chatting with a similar vibe, but obviously, it's a chat not a doc.";

function buildPrompt(variant: SethVariant): string {
	return variant === "full" ? `${SETH_PROMPT} ${FULL_MODE_SUFFIX}` : SETH_PROMPT;
}

export default function sethModeExtension(pi: ExtensionAPI): void {
	let enabled = DEFAULT_ENABLED;
	let variant: SethVariant = DEFAULT_VARIANT;

	pi.registerFlag("seth", {
		description: "Start with Seth mode enabled",
		type: "boolean",
	});

	pi.registerFlag("seth-mode", {
		description: "Seth mode variant: full or docs",
		type: "string",
	});

	function updateStatus(ctx: ExtensionContext): void {
		if (enabled) {
			ctx.ui.setStatus("seth-mode", ctx.ui.theme.fg("accent", `seth:${variant}`));
			ctx.ui.setWidget("seth-mode", [ctx.ui.theme.fg("accent", `Seth mode: ${variant}`)]);
		} else {
			ctx.ui.setStatus("seth-mode", undefined);
			ctx.ui.setWidget("seth-mode", undefined);
		}
	}

	function persistState(): void {
		pi.appendEntry(SAVE_TYPE, { enabled, variant });
	}

	function restoreState(ctx: ExtensionContext): void {
		enabled = DEFAULT_ENABLED;
		variant = DEFAULT_VARIANT;

		const saved = ctx.sessionManager
			.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === SAVE_TYPE)
			.pop() as { data?: SavedState } | undefined;

		if (saved?.data) {
			enabled = saved.data.enabled ?? enabled;
			variant = saved.data.variant ?? variant;
		}

		const flagVariant = pi.getFlag("seth-mode");
		if (flagVariant === "full" || flagVariant === "docs") {
			variant = flagVariant;
			enabled = true;
		}

		if (pi.getFlag("seth") === true) {
			enabled = true;
		}

		updateStatus(ctx);
	}

	function setState(nextEnabled: boolean, nextVariant: SethVariant, ctx: ExtensionContext): void {
		enabled = nextEnabled;
		variant = nextVariant;
		persistState();
		updateStatus(ctx);
	}

	function showStatus(ctx: ExtensionContext): void {
		const state = enabled ? `enabled (${variant})` : `disabled (default mode: ${variant})`;
		ctx.ui.notify(`Seth mode ${state}. Applies to subsequent turns in this chat.`, "info");
	}

	pi.registerCommand("seth", {
		description: "Toggle Seth technical writing mode",
		handler: async (args, ctx) => {
			const command = args?.trim().toLowerCase() ?? "";

			switch (command) {
				case "":
				case "toggle":
					setState(!enabled, variant, ctx);
					showStatus(ctx);
					return;
				case "on":
					setState(true, variant, ctx);
					showStatus(ctx);
					return;
				case "off":
					setState(false, variant, ctx);
					showStatus(ctx);
					return;
				case "full":
					setState(true, "full", ctx);
					showStatus(ctx);
					return;
				case "docs":
					setState(true, "docs", ctx);
					showStatus(ctx);
					return;
				case "show":
				case "status":
					showStatus(ctx);
					return;
				default:
					ctx.ui.notify("Usage: /seth [on|off|toggle|full|docs|show]", "warning");
			}
		},
	});

	pi.registerShortcut(Key.ctrlAlt("s"), {
		description: "Toggle Seth mode",
		handler: async (ctx) => {
			setState(!enabled, variant, ctx);
			showStatus(ctx);
		},
	});

	pi.on("before_agent_start", async (event) => {
		if (!enabled) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildPrompt(variant)}`,
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreState(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreState(ctx);
	});
}
