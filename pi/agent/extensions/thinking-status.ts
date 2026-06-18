/**
 * thinking-status — a delightful "working" indicator in pi's footer:
 *
 *     Elucidating… (2m 23s · ↓ 9.8k)
 *
 * On each user message a cheap model invents a whimsical gerund related to what
 * you asked; an elapsed timer ticks; and the streaming output token count rides the
 * `message_update` event (token-by-token). Clears when the agent loop ends.
 *
 * The gerund shimmers: a soft glow band sweeps left→right through its letters on a
 * fixed-time cycle (à la Claude Code), each character interpolated in 24-bit color
 * between a warm base and a brighter, faintly-cool highlight. The sweep is driven by
 * wall-clock elapsed (not the tick count) so it stays smooth even if a frame is late.
 *
 * Every ctx access is guarded: a captured ctx goes STALE after a session
 * resume/reload and throws on use, so we drop it rather than crash (a setInterval
 * doing this once took pi down — never again).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const GERUND_MODEL = "gpt-5.4-mini";
const GERUND_PROMPT =
  "Analyze this message and come up with a single positive, cheerful and delightful verb in " +
  "gerund form that's related to the message. Only include the word with no other text or " +
  "punctuation. The word should have the first letter capitalized. Add some whimsy and surprise " +
  "to entertain the user. Ensure the word is highly relevant to the user's message. Synonyms are " +
  "welcome, including obscure words. Be careful to avoid words that might look alarming or " +
  "concerning to the software engineer seeing it as a status notification, such as Connecting, " +
  "Disconnecting, Retrying, Lagging, Freezing, etc. NEVER use a destructive word, such as " +
  "Terminating, Killing, Deleting, Destroying, Stopping, Exiting, or similar. NEVER use a word " +
  "that may be derogatory, offensive, or inappropriate in a non-coding context, such as Penetrating.";

const TICK_MS = 80; // ~12.5fps — fast enough that the shimmer reads as fluid motion

// Shimmer: a glow band sweeps through the word. Warm base, brighter faintly-cool
// highlight — the warm↔cool contrast is the "complementary color" that appears to move.
const BASE_RGB: [number, number, number] = [186, 148, 112]; // warm tan
const GLOW_RGB: [number, number, number] = [232, 240, 255]; // bright, faintly cool
const BAND = 3.0; // glow half-width, in characters
const SWEEP_MS = 1500; // time for the glow centre to cross the whole word once
const GAP = BAND; // one band-width margin each side: the tail of one sweep hands off to
// the head of the next with no fully-dark frame — continuous motion, no stall.

function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

// Per-character 24-bit colour, with a glow centred at `center` (in character units).
function shimmerWord(word: string, elapsedMs: number): string {
  const len = word.length;
  const track = len + GAP * 2;
  const center = ((elapsedMs % SWEEP_MS) / SWEEP_MS) * track - GAP; // sweeps left→right, wraps
  let out = "";
  for (let i = 0; i < len; i++) {
    const intensity = smoothstep(1 - Math.abs(i - center) / BAND);
    const r = lerp(BASE_RGB[0], GLOW_RGB[0], intensity);
    const g = lerp(BASE_RGB[1], GLOW_RGB[1], intensity);
    const b = lerp(BASE_RGB[2], GLOW_RGB[2], intensity);
    out += `\x1b[38;2;${r};${g};${b}m${word[i]}`;
  }
  return out + "\x1b[39m"; // reset fg; the suffix sets its own colour
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(Math.round(n));
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function streamingTokens(msg: unknown): number {
  const m = msg as { content?: Array<{ type?: string; text?: string }>; usage?: { output?: number } } | undefined;
  if (m?.usage?.output) return m.usage.output;
  const text = (m?.content ?? [])
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
  return Math.ceil(text.length / 4);
}

export default function thinkingStatus(pi: ExtensionAPI): void {
  let ctxRef: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let startedAt = 0;
  let gerund: string | undefined;
  let outTokens = 0;
  let active = false;
  let lastStatus: string | undefined;

  function uiOk(ctx: ExtensionContext | undefined): ctx is ExtensionContext {
    if (!ctx) return false;
    try {
      return ctx.hasUI;
    } catch {
      ctxRef = undefined; // stale ctx; wait for a fresh one from an event
      return false;
    }
  }

  function render(): void {
    const ctx = ctxRef;
    if (!active || !uiOk(ctx)) return;
    try {
      const theme = ctx.ui.theme;
      const word = gerund ?? "Thinking";
      const elapsed = Date.now() - startedAt;
      const inner = outTokens > 0 ? `${fmtElapsed(elapsed)} · ↓${fmtTok(outTokens)}` : fmtElapsed(elapsed);
      const s = `${shimmerWord(word, elapsed)}${theme.fg("dim", "…")} ${theme.fg("dim", `(${inner})`)}`;
      if (s === lastStatus) return;
      lastStatus = s;
      // This is the built-in spinner/working row (where "Waiting" shows), not the footer.
      ctx.ui.setWorkingMessage(s);
    } catch {
      /* transient */
    }
  }

  function clear(): void {
    active = false;
    outTokens = 0;
    gerund = undefined;
    lastStatus = undefined;
    const ctx = ctxRef;
    if (!uiOk(ctx)) return;
    try {
      ctx.ui.setWorkingMessage(); // restore pi's default "Working" message
    } catch {
      /* ignore */
    }
  }

  async function makeGerund(ctx: ExtensionContext, prompt: string): Promise<void> {
    try {
      const { complete } = await import("@earendil-works/pi-ai");
      const model = ctx.modelRegistry.find("openai-codex", GERUND_MODEL) ?? ctx.model;
      if (!model) return;
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) return;
      const resp = await complete(
        model,
        { systemPrompt: GERUND_PROMPT, messages: [{ role: "user", content: [{ type: "text", text: prompt.slice(0, 2000) }], timestamp: Date.now() }] },
        { apiKey: auth.apiKey, headers: auth.headers },
      );
      const raw = (resp.content ?? [])
        .filter((c: { type?: string }) => c?.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("")
        .trim()
        .split(/\s+/)[0]
        ?.replace(/[^A-Za-z]/g, "");
      if (raw && active) {
        gerund = raw.charAt(0).toUpperCase() + raw.slice(1);
        render();
      }
    } catch {
      /* keep the default "Thinking" */
    }
  }

  pi.on("before_agent_start", async (event, ctx) => {
    ctxRef = ctx;
    if (!active) {
      active = true;
      startedAt = Date.now();
      outTokens = 0;
      gerund = undefined;
      const prompt = event && typeof (event as { prompt?: unknown }).prompt === "string" ? (event as { prompt: string }).prompt : "";
      if (prompt) void makeGerund(ctx, prompt);
    }
    render();
    if (!timer) timer = setInterval(render, TICK_MS);
  });

  pi.on("message_update", async (event, ctx) => {
    ctxRef = ctx;
    const t = streamingTokens((event as { message?: unknown })?.message);
    if (t > outTokens) outTokens = t; // monotonic; the 250ms timer re-renders (don't render per-token)
  });

  pi.on("agent_end", async (_e, ctx) => {
    ctxRef = ctx;
    clear();
  });
  pi.on("session_start", async (_e, ctx) => {
    ctxRef = ctx;
    clear();
  });
  pi.on("session_tree", async (_e, ctx) => {
    ctxRef = ctx;
    clear();
  });
}
