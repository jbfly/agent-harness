// research.ts — answer an open question by fanning out several focused readers,
// then synthesizing one clear answer. General-purpose (not ES-specific).
//
//   /workflow research "how does the evidence_db.py build pipeline work end to end?"
//   /workflow research "what changed in the reconciliation scripts this week?"
//
// The fan-out absorbs the heavy reading in isolated subagents (keeps the main
// window clean); only the synthesis returns. Readers on FAST, synthesis on SMART.

import { SMART, FAST } from "./_models.ts";

export const meta = {
  name: "research",
  description: "Answer an open question by fanning out focused readers across angles, then synthesizing one clear, cited answer. Read-only.",
  phases: [{ title: "Investigate" }, { title: "Synthesize" }],
};

export default async function run(api) {
  const q = (api.args || "").trim().replace(/^["']|["']$/g, "");
  if (!q) return { summary: 'Usage: /workflow research "<question>"' };

  api.phase("Investigate");
  const angles = [
    `Investigate, read-only: ${q}\nFocus on the PRIMARY sources — the actual code, files, or data that answer this. Quote exact paths, names, and snippets. Return just what you found.`,
    `Investigate, read-only: ${q}\nFocus on CONTEXT and how the pieces connect — surrounding files, callers, configs, docs. Return concise notes with paths.`,
    `Investigate, read-only: ${q}\nFocus on EDGE CASES, caveats, and anything that contradicts the obvious answer. What would surprise someone? Return concise notes.`,
  ];
  const findings = await api.parallel(
    angles.map((p, i) => () =>
      api.agent(p, { label: `read:${i + 1}`, phase: "Investigate", model: FAST, tools: ["bash", "read"] })
    )
  );

  api.phase("Synthesize");
  const summary = await api.agent(
    `Answer this question: ${q}\n\n` +
      `Findings from the readers:\n${findings.filter(Boolean).join("\n\n---\n\n")}\n\n` +
      `Synthesize ONE clear answer in the house style: bottom line first (1-2 plain sentences), ` +
      `then the supporting detail with evidence (file:line, exact names, quotes). Note where the ` +
      `readers disagreed or left gaps. Plain English; define jargon on first use. Return markdown prose.`,
    { label: "synthesize", phase: "Synthesize", model: SMART }
  );
  return { summary };
}
