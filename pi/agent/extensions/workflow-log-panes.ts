/**
 * workflow-log-panes — open the latest workflow run's agent logs as a tmux dashboard.
 *
 * `/wlogs` (or ctrl+alt+l) splits a 25%-wide column on the right and tails the
 * first agent's log there, then stacks each remaining agent's log below it — a
 * live dashboard of what every subagent is doing. Reads the logs written by the
 * forked engine into ~/.pi/agent/workflow-logs/<run>/.
 */

import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const LOG_ROOT = join(homedir(), ".pi", "agent", "workflow-logs");

function tmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, (err, stdout) => (err ? reject(err) : resolve((stdout || "").trim())));
  });
}

/** Newest run dir by mtime (handles clock-skew better than lexical sort). */
async function latestRunDir(): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(LOG_ROOT);
  } catch {
    return undefined;
  }
  let best: { name: string; mtime: number } | undefined;
  for (const name of names) {
    try {
      const s = await stat(join(LOG_ROOT, name));
      if (s.isDirectory() && (!best || s.mtimeMs > best.mtime)) best = { name, mtime: s.mtimeMs };
    } catch {
      /* skip */
    }
  }
  return best?.name;
}

async function openDashboard(ctx: ExtensionContext): Promise<void> {
  const pane = process.env.TMUX_PANE;
  if (!process.env.TMUX || !pane) {
    ctx.ui.notify("Not inside tmux — can't open log panes", "warning");
    return;
  }
  const run = await latestRunDir();
  if (!run) {
    ctx.ui.notify("No workflow runs logged yet", "info");
    return;
  }
  const dir = join(LOG_ROOT, run);
  const logs = (await readdir(dir)).filter((f) => f.endsWith(".log")).sort();
  if (logs.length === 0) {
    ctx.ui.notify(`No agent logs in ${run}`, "info");
    return;
  }

  const n = logs.length;
  let anchor = pane; // first split goes right of pi; later splits stack below the previous right pane
  for (let i = 0; i < n; i++) {
    const path = join(dir, logs[i]);
    const cmd = `printf '── %s ──\\n' ${shq(logs[i])}; tail -n 200 -F ${shq(path)}`;
    let args: string[];
    if (i === 0) {
      // right-hand column, 25% of the window width
      args = ["split-window", "-h", "-p", "25", "-d", "-P", "-F", "#{pane_id}", "-t", pane, cmd];
    } else {
      // split the previous right pane so all stripes end up equal height: the new
      // pane takes (n-i)/(n-i+1) of the target, leaving the target at 1/n.
      const pct = Math.round((100 * (n - i)) / (n - i + 1));
      args = ["split-window", "-v", "-p", String(pct), "-d", "-P", "-F", "#{pane_id}", "-t", anchor, cmd];
    }
    try {
      anchor = await tmux(args);
    } catch (e) {
      ctx.ui.notify(`tmux split failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      return;
    }
  }
  // Return focus to the pi pane (the splits used -d so focus shouldn't have moved,
  // but make it explicit).
  await tmux(["select-pane", "-t", pane]).catch(() => {});
  ctx.ui.notify(`Opened ${logs.length} log pane(s) for ${run}`, "info");
}

/** Minimal single-quote shell escaping for the tmux command string. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export default function workflowLogPanes(pi: ExtensionAPI): void {
  pi.registerCommand("wlogs", {
    description: "Open the latest workflow run's agent logs as a tmux dashboard",
    handler: (_args, ctx) => openDashboard(ctx),
  });
  pi.registerShortcut("ctrl+alt+l", {
    description: "Open workflow agent logs as tmux panes",
    handler: (ctx) => openDashboard(ctx),
  });
}
