/**
 * tmux-namer — name the tmux window after the pi session, like Claude Code.
 *
 * On session start: names the window after the project folder. On the first user
 * message: renames immediately to the first couple of words, then asks a cheap
 * model for a tight 1-2 word title and applies that when it returns. No-op outside tmux.
 */

import { execFile } from "node:child_process";
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TITLE_MODEL = "gpt-5.4-mini"; // cheap; just summarizes one line
const SYS_PROMPT =
  "You write ultra-short tmux window titles. Given a user's request, reply with a 1-2 word, " +
  "lowercase title, max 14 characters, no punctuation or quotes — just the word(s). " +
  "Examples: invoice hunt, odoo audit, token meter, pi config, bank recon.";

function renameTmuxWindow(name: string): void {
  const pane = process.env.TMUX_PANE;
  if (!process.env.TMUX || !pane) return;
  const clean = name.replace(/[\r\n\t]+/g, " ").trim().slice(0, 40) || "pi";
  execFile("tmux", ["set-window-option", "-t", pane, "automatic-rename", "off"], () => {
    execFile("tmux", ["rename-window", "-t", pane, clean], () => {});
  });
}

function sanitizeTitle(raw: string): string | undefined {
  const t = raw
    .toLowerCase()
    .replace(/["'`.,:;!?()\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 2)
    .join(" ")
    .slice(0, 16)
    .trim();
  return t || undefined;
}

function firstWords(text: string): string {
  return text.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ").slice(0, 24);
}

function firstUserText(ctx: ExtensionContext): string | undefined {
  let branch: unknown[];
  try {
    branch = ctx.sessionManager.getBranch();
  } catch {
    return undefined;
  }
  for (const entry of branch) {
    const e = entry as { type?: string; message?: { role?: string; content?: Array<{ type?: string; text?: string }> } };
    if (e?.type !== "message" || e.message?.role !== "user") continue;
    const txt = (e.message.content ?? [])
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join(" ")
      .trim();
    if (txt) return txt;
  }
  return undefined;
}

async function modelTitle(ctx: ExtensionContext, text: string): Promise<string | undefined> {
  try {
    const { complete } = await import("@earendil-works/pi-ai");
    const model = ctx.modelRegistry.find("openai-codex", TITLE_MODEL) ?? ctx.model;
    if (!model) return undefined;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return undefined;
    const resp = await complete(
      model,
      { systemPrompt: SYS_PROMPT, messages: [{ role: "user", content: [{ type: "text", text: text.slice(0, 2000) }], timestamp: Date.now() }] },
      { apiKey: auth.apiKey, headers: auth.headers },
    );
    const out = (resp.content ?? [])
      .filter((c: { type?: string }) => c?.type === "text")
      .map((c: { text?: string }) => c.text ?? "")
      .join(" ");
    return sanitizeTitle(out);
  } catch {
    return undefined;
  }
}

export default function tmuxNamer(pi: ExtensionAPI): void {
  let titled = false;

  pi.on("session_start", async (_e, _ctx) => {
    titled = false;
    renameTmuxWindow(basename(process.cwd()));
  });

  pi.on("before_agent_start", async (_e, ctx) => {
    if (titled) return;
    const txt = firstUserText(ctx);
    if (!txt) return;
    titled = true;
    renameTmuxWindow(firstWords(txt)); // instant fallback
    void modelTitle(ctx, txt).then((t) => {
      if (t) renameTmuxWindow(t); // upgrade when the model answers
    });
  });
}
