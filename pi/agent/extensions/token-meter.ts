/**
 * token-meter — a live input/output token counter in pi's footer.
 *
 * Sums the real `usage` on each finished assistant message; for a message that's
 * still streaming it estimates output from text length so the number climbs, then
 * snaps to the real value when the turn ends. Shows ↑input ↓output (+ ⚡cache $cost).
 *
 * IMPORTANT: a captured ctx goes STALE after a session resume/reload, and touching
 * it then throws. Because update() runs on a timer, every ctx access is guarded so
 * a stale ctx is dropped (and re-acquired from the next session event) instead of
 * crashing pi.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface Totals {
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
}

const TICK_MS = 200;

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return String(Math.round(n));
}

function textOf(msg: { content?: Array<{ type?: string; text?: string }> }): string {
  return (msg.content ?? [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

function totalsForBranch(ctx: ExtensionContext): Totals {
  const t: Totals = { input: 0, output: 0, cacheRead: 0, cost: 0 };
  let branch: unknown[];
  try {
    branch = ctx.sessionManager.getBranch();
  } catch {
    return t;
  }
  for (const entry of branch) {
    const e = entry as {
      type?: string;
      message?: { role?: string; content?: Array<{ type?: string; text?: string }>; usage?: Record<string, unknown> };
    };
    if (e?.type !== "message" || e.message?.role !== "assistant") continue;
    const u = e.message.usage as
      | { input?: number; output?: number; cacheRead?: number; cost?: { total?: number } }
      | undefined;
    if (u && (u.output ?? 0) > 0) {
      t.input += u.input ?? 0;
      t.output += u.output ?? 0;
      t.cacheRead += u.cacheRead ?? 0;
      t.cost += u.cost?.total ?? 0;
    } else {
      t.output += Math.ceil(textOf(e.message).length / 4); // streaming estimate
    }
  }
  return t;
}

export default function tokenMeter(pi: ExtensionAPI): void {
  let ctxRef: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastText: string | undefined;

  function update(): void {
    const ctx = ctxRef;
    if (!ctx) return;
    // The hasUI getter throws if the ctx is stale (session was replaced/reloaded).
    try {
      if (!ctx.hasUI) return;
    } catch {
      ctxRef = undefined; // drop the stale ctx; a session event will re-attach a fresh one
      return;
    }
    try {
      const t = totalsForBranch(ctx);
      const theme = ctx.ui.theme;
      let text = theme.fg("accent", `↑${fmt(t.input)}`) + " " + theme.fg("muted", `↓${fmt(t.output)}`);
      if (t.cacheRead) text += " " + theme.fg("dim", `⚡${fmt(t.cacheRead)}`);
      if (t.cost) text += " " + theme.fg("dim", `$${t.cost.toFixed(2)}`);
      if (text === lastText) return;
      lastText = text;
      ctx.ui.setStatus("token-meter", text);
    } catch {
      /* transient mid-replacement state; ignore */
    }
  }

  function attach(ctx: ExtensionContext): void {
    ctxRef = ctx;
    lastText = undefined;
    update();
    if (!timer) timer = setInterval(update, TICK_MS);
  }

  pi.on("session_start", async (_e, ctx) => attach(ctx));
  pi.on("session_tree", async (_e, ctx) => attach(ctx));
  pi.on("before_agent_start", async (_e, ctx) => attach(ctx));
}
