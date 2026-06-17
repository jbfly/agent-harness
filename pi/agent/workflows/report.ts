// report.ts — investigate a question, then write a warm, plain-language report.
//
//   /workflow report "reconcile Anna's 2025 sheet against Odoo receivables"
//
// Tiered: the gatherers read on a cheaper model (FAST), the writer synthesizes on
// SMART. Each subagent's model + tool calls are logged to ~/.pi/agent/workflow-logs/.

import { SMART, FAST } from "./_models.ts";

export const meta = {
  name: "report",
  description: "Investigate a question, then write a clear, warm, plain-language report for a human reader.",
  phases: [{ title: "Gather" }, { title: "Write" }],
};

export default async function run(api) {
  const task = (api.args || "").trim().replace(/^["']|["']$/g, "");
  if (!task) return { summary: 'Usage: /workflow report "<what to report on>"' };

  api.phase("Gather");
  const angles = [
    `Gather the concrete facts needed to answer: ${task}. Quote exact numbers, dates, file paths, and sources. Read-only — change nothing. Return just the facts you found, with where each came from.`,
    `Find the supporting context and any caveats for: ${task}. What is uncertain, missing, or easy to get wrong? Read-only. Return concise notes.`,
  ];
  const facts = await api.parallel(
    angles.map((p, i) => () =>
      api.agent(p, { label: `gather:${i + 1}`, phase: "Gather", model: FAST, tools: ["bash", "read"] })
    )
  );

  api.phase("Write");
  const summary = await api.agent(
    `Write a report answering: ${task}\n\n` +
      `Facts gathered by the research agents:\n${facts.filter(Boolean).join("\n\n---\n\n")}\n\n` +
      `Write it in the house style: open with the bottom line in one or two plain sentences, then ` +
      `short labelled sections, then a clear "Next" line. Plain English for a smart non-accountant; ` +
      `define any accounting term on first use; name brands, not database fields; quote real numbers ` +
      `and their sources; state plainly what you could not verify. Return the report as markdown ` +
      `prose — this text IS the deliverable the user sees.`,
    { label: "write", phase: "Write", model: SMART }
  );
  return { summary };
}
