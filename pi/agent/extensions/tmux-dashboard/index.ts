import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text, Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const TOOL_TIMEOUT_MS = 5000;
const CAPTURE_MAX_LINES = 400;
const CAPTURE_MAX_BYTES = 30 * 1024;
const WIDGET_REFRESH_MS = 15000;
const MESSAGE_TYPE = "tmux-dashboard";

type TmuxRow = Record<string, string>;

type ExecCtx = ExtensionContext | ExtensionCommandContext;

type NewPaneParams = {
	command?: string;
	label?: string;
	cwd?: string;
	direction?: "right" | "down";
	percent?: number;
	target?: string;
	select?: boolean;
	keepOpen?: boolean;
};

type NewWindowParams = {
	command?: string;
	name?: string;
	cwd?: string;
	target?: string;
	select?: boolean;
	keepOpen?: boolean;
};

function tmuxSocketArgs(): string[] {
	const tmuxEnv = process.env.TMUX;
	if (!tmuxEnv) return [];
	const socketPath = tmuxEnv.split(",", 1)[0];
	return socketPath ? ["-S", socketPath] : [];
}

function currentPaneTarget(): string | undefined {
	return process.env.TMUX_PANE || undefined;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function keepOpenCommand(command: string): string {
	const script = [
		"set -o pipefail",
		command,
		"code=$?",
		"printf '\\n[pi tmux] command exited with code %s. Press Enter to close. ' \"$code\"",
		"read -r _",
		"exit \"$code\"",
	].join("\n");
	return `bash -lc ${shellQuote(script)}`;
}

function truncateText(text: string, maxLines = CAPTURE_MAX_LINES, maxBytes = CAPTURE_MAX_BYTES): { text: string; truncated: boolean } {
	const bytes = Buffer.byteLength(text, "utf8");
	const lines = text.split(/\r?\n/);
	let output = lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
	let truncated = lines.length > maxLines || bytes > maxBytes;

	while (Buffer.byteLength(output, "utf8") > maxBytes) {
		const next = output.slice(Math.ceil(output.length * 0.1));
		if (next.length === output.length) break;
		output = next;
		truncated = true;
	}

	if (truncated) {
		output = `[tmux output truncated to last ${maxLines} lines / ${Math.round(maxBytes / 1024)} KiB]\n` + output;
	}
	return { text: output, truncated };
}

function parseRows(stdout: string, columns: string[]): TmuxRow[] {
	return stdout
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const parts = line.split("\t");
			const row: TmuxRow = {};
			columns.forEach((column, index) => {
				row[column] = parts[index] ?? "";
			});
			return row;
		});
}

function isTruthyTmux(value: string | undefined): boolean {
	return value === "1" || value === "on" || value === "yes" || value === "true";
}

function paneLine(pane: TmuxRow): string {
	const active = isTruthyTmux(pane.active) ? "*" : " ";
	const managed = isTruthyTmux(pane.managed) ? " managed" : "";
	const label = pane.label ? ` ${pane.label}` : "";
	const title = pane.title ? ` · ${pane.title}` : "";
	return `${active} ${pane.session}:${pane.window_index}.${pane.pane_index} ${pane.pane_id}${managed}${label} · ${pane.window_name} · ${pane.command} · ${pane.path}${title}`;
}

function windowLine(win: TmuxRow): string {
	const active = isTruthyTmux(win.active) ? "*" : " ";
	const managed = isTruthyTmux(win.managed) ? " managed" : "";
	const label = win.label ? ` ${win.label}` : "";
	return `${active} ${win.session}:${win.index} ${win.window_id}${managed}${label} · ${win.name} · panes=${win.panes}`;
}

function sessionLine(session: TmuxRow): string {
	const grouped = isTruthyTmux(session.grouped) ? ` group=${session.group}` : "";
	return `${session.name} · windows=${session.windows} · attached=${session.attached}${grouped}`;
}

function firstWord(value: string | undefined, fallback: string): string {
	const word = value?.trim().split(/\s+/, 1)[0];
	return word && word.length > 0 ? word : fallback;
}

export default function tmuxDashboardExtension(pi: ExtensionAPI): void {
	let widgetEnabled = true;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let activeCtx: ExtensionContext | undefined;

	async function tmux(args: string[], ctx?: ExecCtx, timeout = TOOL_TIMEOUT_MS): Promise<string> {
		const result = await pi.exec("tmux", [...tmuxSocketArgs(), ...args], {
			timeout,
			signal: ctx?.signal,
		});
		if (result.code !== 0) {
			const stderr = result.stderr.trim();
			const stdout = result.stdout.trim();
			throw new Error(stderr || stdout || `tmux exited with code ${result.code}`);
		}
		return result.stdout;
	}

	async function currentInfo(ctx?: ExecCtx): Promise<TmuxRow> {
		const target = currentPaneTarget();
		const format = [
			"#{socket_path}",
			"#{session_name}",
			"#{session_group}",
			"#{window_index}",
			"#{window_name}",
			"#{pane_index}",
			"#{pane_id}",
			"#{pane_current_path}",
			"#{pane_current_command}",
		].join("\t");
		const args = ["display-message", "-p"];
		if (target) args.push("-t", target);
		args.push(format);
		const rows = parseRows(await tmux(args, ctx), [
			"socket",
			"session",
			"group",
			"window_index",
			"window_name",
			"pane_index",
			"pane_id",
			"path",
			"command",
		]);
		return rows[0] ?? {};
	}

	async function listSessions(ctx?: ExecCtx): Promise<TmuxRow[]> {
		const format = ["#{session_name}", "#{session_windows}", "#{session_attached}", "#{session_group}", "#{session_grouped}"].join("\t");
		return parseRows(await tmux(["list-sessions", "-F", format], ctx), ["name", "windows", "attached", "group", "grouped"]);
	}

	async function listWindows(ctx?: ExecCtx, target?: string): Promise<TmuxRow[]> {
		const format = [
			"#{session_name}",
			"#{window_index}",
			"#{window_id}",
			"#{window_name}",
			"#{window_active}",
			"#{window_panes}",
			"#{@pi_managed}",
			"#{@pi_label}",
		].join("\t");
		const args = ["list-windows"];
		if (target) args.push("-t", target);
		args.push("-F", format);
		return parseRows(await tmux(args, ctx), ["session", "index", "window_id", "name", "active", "panes", "managed", "label"]);
	}

	async function listPanes(ctx?: ExecCtx, target?: string, scope: "window" | "session" = "session"): Promise<TmuxRow[]> {
		const format = [
			"#{session_name}",
			"#{window_index}",
			"#{window_name}",
			"#{pane_index}",
			"#{pane_id}",
			"#{pane_active}",
			"#{pane_current_path}",
			"#{pane_current_command}",
			"#{pane_title}",
			"#{@pi_managed}",
			"#{@pi_label}",
		].join("\t");
		const args = ["list-panes"];
		if (scope === "session") args.push("-s");
		if (target) args.push("-t", target);
		args.push("-F", format);
		return parseRows(await tmux(args, ctx), [
			"session",
			"window_index",
			"window_name",
			"pane_index",
			"pane_id",
			"active",
			"path",
			"command",
			"title",
			"managed",
			"label",
		]);
	}

	async function managedPanes(ctx?: ExecCtx): Promise<TmuxRow[]> {
		// Keep the dashboard local to the tmux window that contains this pi pane.
		// `list-panes -s` walks every window in the session.
		const panes = await listPanes(ctx, currentPaneTarget(), "window");
		return panes.filter((pane) => isTruthyTmux(pane.managed));
	}

	async function buildReport(ctx: ExecCtx | undefined, scope: string, target?: string): Promise<string> {
		const targetForWorkspace = target || currentPaneTarget();
		const lines: string[] = [];
		const current = await currentInfo(ctx);
		lines.push(
			`current: ${current.session}:${current.window_index}.${current.pane_index} ${current.pane_id} · ${current.window_name} · ${current.path}`,
		);

		if (scope === "sessions" || scope === "all") {
			lines.push("", "sessions:");
			for (const session of await listSessions(ctx)) lines.push(`  ${sessionLine(session)}`);
		}

		if (scope === "windows" || scope === "current" || scope === "all") {
			lines.push("", "windows:");
			for (const win of await listWindows(ctx, targetForWorkspace)) lines.push(`  ${windowLine(win)}`);
		}

		if (scope === "panes" || scope === "current" || scope === "all") {
			lines.push("", "panes:");
			for (const pane of await listPanes(ctx, targetForWorkspace)) lines.push(`  ${paneLine(pane)}`);
		}

		if (scope === "managed") {
			lines.push("", "pi-managed panes in current window:");
			const panes = await managedPanes(ctx);
			if (panes.length === 0) lines.push("  none");
			for (const pane of panes) lines.push(`  ${paneLine(pane)}`);
		}

		return lines.join("\n");
	}

	async function paneManaged(target: string, ctx?: ExecCtx): Promise<boolean> {
		const out = await tmux(["display-message", "-p", "-t", target, "#{@pi_managed}"], ctx);
		return isTruthyTmux(out.trim());
	}

	async function requireManagedOrConfirm(action: string, target: string, ctx: ExecCtx): Promise<void> {
		if (await paneManaged(target, ctx)) return;
		if (!ctx.hasUI) throw new Error(`${action} refused: ${target} is not a pi-managed pane`);
		const ok = await ctx.ui.confirm(
			`tmux ${action}: unmanaged pane`,
			`Pane ${target} was not created by the pi tmux extension. Continue?`,
		);
		if (!ok) throw new Error(`${action} cancelled by user`);
	}

	async function markPane(paneId: string, label: string, ctx?: ExecCtx): Promise<void> {
		await tmux(["set-option", "-p", "-t", paneId, "@pi_managed", "1"], ctx).catch(() => "");
		await tmux(["set-option", "-p", "-t", paneId, "@pi_label", label], ctx).catch(() => "");
		await tmux(["select-pane", "-t", paneId, "-T", label], ctx).catch(() => "");
	}

	async function markWindow(windowId: string, label: string, ctx?: ExecCtx): Promise<void> {
		await tmux(["set-window-option", "-t", windowId, "@pi_managed", "1"], ctx).catch(() => "");
		await tmux(["set-window-option", "-t", windowId, "@pi_label", label], ctx).catch(() => "");
	}

	async function createPane(params: NewPaneParams, ctx: ExecCtx): Promise<string> {
		const cwd = params.cwd || ctx.cwd;
		const label = params.label || firstWord(params.command, "pi-pane");
		const direction = params.direction ?? "right";
		const target = params.target || currentPaneTarget();
		const command = params.command?.trim();
		const args = ["split-window"];
		args.push(direction === "down" ? "-v" : "-h");
		if (!params.select) args.push("-d");
		args.push("-P", "-F", "#{pane_id}");
		if (params.percent && Number.isFinite(params.percent)) args.push("-l", `${Math.max(5, Math.min(95, Math.round(params.percent)))}%`);
		if (target) args.push("-t", target);
		args.push("-c", cwd);
		if (command) args.push(params.keepOpen ?? true ? keepOpenCommand(command) : command);

		const paneId = (await tmux(args, ctx)).trim();
		if (!paneId) throw new Error("tmux did not return a pane id");
		await markPane(paneId, label, ctx);
		await refreshUi(ctx).catch(() => undefined);
		return paneId;
	}

	async function createWindow(params: NewWindowParams, ctx: ExecCtx): Promise<{ windowId: string; paneId: string }> {
		const cwd = params.cwd || ctx.cwd;
		const name = params.name || firstWord(params.command, "pi");
		const command = params.command?.trim();
		const args = ["new-window"];
		if (!params.select) args.push("-d");
		args.push("-P", "-F", "#{window_id}\t#{pane_id}");
		if (params.target) args.push("-t", params.target);
		args.push("-n", name, "-c", cwd);
		if (command) args.push(params.keepOpen ?? true ? keepOpenCommand(command) : command);

		const [windowId, paneId] = (await tmux(args, ctx)).trim().split("\t");
		if (!windowId || !paneId) throw new Error("tmux did not return window and pane ids");
		await markWindow(windowId, name, ctx);
		await markPane(paneId, name, ctx);
		await refreshUi(ctx).catch(() => undefined);
		return { windowId, paneId };
	}

	function postReport(report: string): void {
		pi.sendMessage({ customType: MESSAGE_TYPE, content: report, display: true });
	}

	async function refreshUi(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) return;
		if (!process.env.TMUX) {
			ctx.ui.setStatus("tmux-dashboard", undefined);
			ctx.ui.setWidget("tmux-dashboard", undefined);
			return;
		}

		const current = await currentInfo(ctx);
		const managed = await managedPanes(ctx).catch(() => []);
		const session = current.group && current.group !== current.session ? `${current.group}/${current.session}` : current.session;
		ctx.ui.setStatus(
			"tmux-dashboard",
			ctx.ui.theme.fg("dim", `tmux ${session}:${current.window_index}.${current.pane_index} ${current.pane_id} m=${managed.length}`),
		);

		if (!widgetEnabled || managed.length === 0) {
			ctx.ui.setWidget("tmux-dashboard", undefined);
			return;
		}

		const lines = [ctx.ui.theme.fg("accent", `tmux managed panes (${managed.length})`)];
		for (const pane of managed.slice(0, 8)) {
			const label = pane.label || pane.title || pane.command || "pane";
			lines.push(
				ctx.ui.theme.fg(
					"dim",
					`  ${pane.pane_id} ${pane.session}:${pane.window_index}.${pane.pane_index} ${label} · ${pane.command} · ${pane.path}`,
				),
			);
		}
		if (managed.length > 8) lines.push(ctx.ui.theme.fg("dim", `  ... ${managed.length - 8} more`));
		ctx.ui.setWidget("tmux-dashboard", lines, { placement: "belowEditor" });
	}

	async function openMenu(ctx: ExecCtx): Promise<void> {
		if (!ctx.hasUI) return;
		if (!process.env.TMUX) {
			ctx.ui.notify("No TMUX environment found", "warning");
			return;
		}

		const choice = await ctx.ui.select("tmux", [
			"List current workspace",
			"List pi-managed panes",
			"New monitor pane",
			"New tmux window",
			"Capture a pane",
			"Kill a pi-managed pane",
			widgetEnabled ? "Hide managed-pane widget" : "Show managed-pane widget",
			"Refresh status",
		]);
		if (!choice) return;

		if (choice === "List current workspace") {
			postReport(await buildReport(ctx, "current"));
			return;
		}
		if (choice === "List pi-managed panes") {
			postReport(await buildReport(ctx, "managed"));
			return;
		}
		if (choice === "New monitor pane") {
			const command = await ctx.ui.input("Command for new tmux pane", "pytest -q");
			if (!command) return;
			const label = await ctx.ui.input("Pane label", firstWord(command, "monitor"));
			const direction = await ctx.ui.select("Split direction", ["right", "down"]);
			const paneId = await createPane({ command, label: label || undefined, direction: direction === "down" ? "down" : "right" }, ctx);
			ctx.ui.notify(`Created ${paneId}`, "info");
			return;
		}
		if (choice === "New tmux window") {
			const name = await ctx.ui.input("Window name", "monitor");
			if (!name) return;
			const command = await ctx.ui.input("Command for new tmux window", process.env.SHELL || "fish");
			const result = await createWindow({ name, command: command || undefined }, ctx);
			ctx.ui.notify(`Created ${result.windowId} ${result.paneId}`, "info");
			return;
		}
		if (choice === "Capture a pane") {
			const panes = await listPanes(ctx, currentPaneTarget());
			const selected = await ctx.ui.select("Capture pane", panes.map(paneLine));
			const paneId = selected?.match(/(%\d+)/)?.[1];
			if (!paneId) return;
			const output = await capturePane(paneId, 200, false, ctx);
			postReport(`capture ${paneId}:\n\n${output.text}`);
			return;
		}
		if (choice === "Kill a pi-managed pane") {
			const panes = await managedPanes(ctx);
			if (panes.length === 0) {
				ctx.ui.notify("No pi-managed panes", "info");
				return;
			}
			const selected = await ctx.ui.select("Kill managed pane", panes.map(paneLine));
			const paneId = selected?.match(/(%\d+)/)?.[1];
			if (!paneId) return;
			const ok = await ctx.ui.confirm("Kill tmux pane", `Kill ${paneId}?`);
			if (!ok) return;
			await tmux(["kill-pane", "-t", paneId], ctx);
			await refreshUi(ctx).catch(() => undefined);
			ctx.ui.notify(`Killed ${paneId}`, "info");
			return;
		}
		if (choice === "Hide managed-pane widget" || choice === "Show managed-pane widget") {
			widgetEnabled = !widgetEnabled;
			await refreshUi(ctx).catch(() => undefined);
			return;
		}
		if (choice === "Refresh status") {
			await refreshUi(ctx).catch((error) => ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"));
		}
	}

	async function capturePane(target: string, lines: number, alternateScreen: boolean, ctx?: ExecCtx): Promise<{ text: string; truncated: boolean }> {
		const start = Math.max(1, Math.min(5000, Math.round(lines || 200)));
		const args = ["capture-pane", "-p", "-J", "-t", target, "-S", `-${start}`];
		if (alternateScreen) args.splice(2, 0, "-a");
		return truncateText(await tmux(args, ctx, TOOL_TIMEOUT_MS), start, CAPTURE_MAX_BYTES);
	}

	pi.registerMessageRenderer(MESSAGE_TYPE, (message, _options, theme) => {
		const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content, null, 2);
		return new Text(`${theme.fg("accent", "tmux")}\n${theme.fg("dim", content)}`, 0, 0);
	});

	pi.registerTool({
		name: "tmux_list",
		label: "Tmux List",
		description: "List tmux sessions, windows, panes, or pi-managed panes. Managed panes are limited to the current tmux window. Uses the TMUX socket of the pane where pi is running.",
		promptSnippet: "Inspect tmux sessions, windows, panes, and pi-managed dashboard panes",
		promptGuidelines: [
			"Use tmux_list before tmux_capture, tmux_send_keys, or tmux_kill_pane to identify pane ids.",
			"Use tmux_new_pane when the user wants a dashboard pane for monitors, tests, logs, or long-running commands.",
		],
		parameters: Type.Object({
			scope: Type.Optional(StringEnum(["current", "sessions", "windows", "panes", "managed", "all"] as const)),
			target: Type.Optional(Type.String({ description: "tmux target. Defaults to the pane running pi." })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
			const scope = params.scope ?? "current";
			const report = await buildReport(ctx, scope, params.target);
			return { content: [{ type: "text", text: report }], details: { scope, target: params.target } };
		},
	});

	pi.registerTool({
		name: "tmux_capture",
		label: "Tmux Capture",
		description: "Capture recent text from a tmux pane. Output is truncated to the requested line count and 30 KiB.",
		promptSnippet: "Capture recent text from a tmux pane",
		parameters: Type.Object({
			target: Type.String({ description: "Pane id or tmux target, for example %48." }),
			lines: Type.Optional(Type.Number({ description: "Recent lines to capture. Default 200. Max 5000." })),
			alternateScreen: Type.Optional(Type.Boolean({ description: "Capture alternate screen content for full-screen TUIs." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const output = await capturePane(params.target, params.lines ?? 200, params.alternateScreen ?? false, ctx);
			return { content: [{ type: "text", text: output.text }], details: { target: params.target, truncated: output.truncated } };
		},
	});

	pi.registerTool({
		name: "tmux_new_pane",
		label: "Tmux New Pane",
		description: "Create a pi-managed tmux split pane in the current workspace for monitors, logs, tests, or an interactive shell. New panes are marked @pi_managed=1.",
		promptSnippet: "Create a pi-managed split pane for monitors, tests, logs, or shells",
		promptGuidelines: [
			"Use tmux_new_pane instead of bash for long-running watch, tail, server, or test-monitor commands when the user wants a project dashboard.",
			"tmux_new_pane creates pi-managed panes. It is safe to later use tmux_send_keys or tmux_kill_pane on those panes.",
		],
		parameters: Type.Object({
			command: Type.Optional(Type.String({ description: "Shell command to run. Omit for the user's shell." })),
			label: Type.Optional(Type.String({ description: "Short pane label." })),
			cwd: Type.Optional(Type.String({ description: "Start directory. Defaults to pi's current project cwd." })),
			direction: Type.Optional(StringEnum(["right", "down"] as const)),
			percent: Type.Optional(Type.Number({ description: "Pane size percent, 5-95." })),
			target: Type.Optional(Type.String({ description: "Target pane to split. Defaults to the pane running pi." })),
			select: Type.Optional(Type.Boolean({ description: "Select the new pane. Default false, so pi keeps focus." })),
			keepOpen: Type.Optional(Type.Boolean({ description: "Keep pane open after command exits. Default true for commands." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const paneId = await createPane(params, ctx);
			return {
				content: [{ type: "text", text: `Created pi-managed tmux pane ${paneId}` }],
				details: { paneId, ...params },
			};
		},
	});

	pi.registerTool({
		name: "tmux_new_window",
		label: "Tmux New Window",
		description: "Create a pi-managed tmux window in the current workspace. The first pane is marked @pi_managed=1.",
		promptSnippet: "Create a pi-managed tmux window for a project dashboard or scratch workspace",
		parameters: Type.Object({
			command: Type.Optional(Type.String({ description: "Shell command to run. Omit for the user's shell." })),
			name: Type.Optional(Type.String({ description: "Window name." })),
			cwd: Type.Optional(Type.String({ description: "Start directory. Defaults to pi's current project cwd." })),
			target: Type.Optional(Type.String({ description: "Target session/window. Defaults to current session." })),
			select: Type.Optional(Type.Boolean({ description: "Select the new window. Default false." })),
			keepOpen: Type.Optional(Type.Boolean({ description: "Keep pane open after command exits. Default true for commands." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await createWindow(params, ctx);
			return {
				content: [{ type: "text", text: `Created pi-managed tmux window ${result.windowId} with pane ${result.paneId}` }],
				details: { ...result, ...params },
			};
		},
	});

	pi.registerTool({
		name: "tmux_send_keys",
		label: "Tmux Send Keys",
		description: "Send literal text or tmux key names to a pane. Unmanaged panes require interactive confirmation.",
		parameters: Type.Object({
			target: Type.String({ description: "Target pane id, for example %99." }),
			text: Type.Optional(Type.String({ description: "Literal text to send." })),
			keys: Type.Optional(Type.Array(Type.String(), { description: "tmux key names, for example C-c or Enter." })),
			enter: Type.Optional(Type.Boolean({ description: "Send Enter after text/keys." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			await requireManagedOrConfirm("send-keys", params.target, ctx);
			if (!params.text && (!params.keys || params.keys.length === 0) && !params.enter) {
				throw new Error("tmux_send_keys needs text, keys, or enter=true");
			}
			if (params.text) await tmux(["send-keys", "-t", params.target, "-l", params.text], ctx);
			if (params.keys && params.keys.length > 0) await tmux(["send-keys", "-t", params.target, ...params.keys], ctx);
			if (params.enter) await tmux(["send-keys", "-t", params.target, "Enter"], ctx);
			return { content: [{ type: "text", text: `Sent keys to ${params.target}` }], details: { target: params.target } };
		},
	});

	pi.registerTool({
		name: "tmux_kill_pane",
		label: "Tmux Kill Pane",
		description: "Kill a tmux pane. Unmanaged panes require interactive confirmation.",
		parameters: Type.Object({
			target: Type.String({ description: "Target pane id, for example %99." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			await requireManagedOrConfirm("kill-pane", params.target, ctx);
			await tmux(["kill-pane", "-t", params.target], ctx);
			await refreshUi(ctx).catch(() => undefined);
			return { content: [{ type: "text", text: `Killed ${params.target}` }], details: { target: params.target } };
		},
	});

	pi.registerCommand("tmux", {
		description: "Open tmux dashboard controls",
		handler: async (_args, ctx) => openMenu(ctx),
	});

	pi.registerCommand("tmux-refresh", {
		description: "Refresh tmux status and managed-pane widget",
		handler: async (_args, ctx) => {
			await refreshUi(ctx);
			ctx.ui.notify("tmux status refreshed", "info");
		},
	});

	pi.registerCommand("tmux-pane", {
		description: "Create a pi-managed tmux pane: /tmux-pane <command>",
		handler: async (args, ctx) => {
			const command = args.trim() || (await ctx.ui.input("Command for new tmux pane", "pytest -q"));
			if (!command) return;
			const paneId = await createPane({ command, label: firstWord(command, "monitor") }, ctx);
			ctx.ui.notify(`Created ${paneId}`, "info");
		},
	});

	pi.registerCommand("tmux-window", {
		description: "Create a pi-managed tmux window: /tmux-window [name] :: [command]",
		handler: async (args, ctx) => {
			const [rawName, ...commandParts] = args.split("::");
			const name = rawName.trim() || (await ctx.ui.input("Window name", "monitor"));
			if (!name) return;
			const command = commandParts.join("::").trim() || undefined;
			const result = await createWindow({ name, command }, ctx);
			ctx.ui.notify(`Created ${result.windowId} ${result.paneId}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("t"), {
		description: "Open tmux dashboard controls",
		handler: async (ctx) => {
			await openMenu(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		activeCtx = ctx;
		await refreshUi(ctx).catch(() => undefined);
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = setInterval(() => {
			if (activeCtx) void refreshUi(activeCtx).catch(() => undefined);
		}, WIDGET_REFRESH_MS);
	});

	pi.on("agent_end", async (_event, ctx) => {
		await refreshUi(ctx).catch(() => undefined);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
		activeCtx = undefined;
		ctx.ui.setStatus("tmux-dashboard", undefined);
		ctx.ui.setWidget("tmux-dashboard", undefined);
	});
}
