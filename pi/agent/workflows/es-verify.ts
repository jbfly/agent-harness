// es-verify.ts — evidence-gated verification of a claim about the books, for when
// accuracy matters before a sensitive change. Two independent, skeptical verifiers
// gather evidence read-only; a third synthesizes a go/no-go. NEVER writes to Odoo.
//
//   /workflow es-verify "INV-0284 from The Lost Explorer is fully settled"
//   /workflow es-verify "Loch Lomond FT A2025/151 (EUR 8,410.38) is still unpaid"
//
// Accuracy over cost: verifiers and synthesis run on SMART. All read-only.

import { SMART } from "./_models.ts";

export const meta = {
  name: "es-verify",
  description: "Independently verify a claim about the Exceptional Spirits books using read-only evidence (catalogs + reports), and return a go/no-go with citations. Never writes to Odoo.",
  phases: [{ title: "Verify" }, { title: "Decide" }],
};

const SOURCES =
  `Evidence sources (all read-only):\n` +
  `- es-odoo evidence cache: cd "$HOME/git/es-odoo" && python3 scripts/evidence_db.py search '<ref>' ` +
  `(or sqlite3 "$HOME/git/es-odoo/data/evidence-cache.sqlite3"; tables source_files, email_messages, ` +
  `open_items, bank_lines, evidence_items, FTS search_fts).\n` +
  `- es-365 mailbox catalog: sqlite3 "$HOME/git/es-365/state/mailbox-catalog/catalog.sqlite" ` +
  `(messages, attachments, message_tokens, attachment_accounting_candidates).\n` +
  `- es-odoo derived packs under data/*.json (e.g. live-reconciliation-pack.json) and docs/ reports.\n` +
  `Exchange-folder copies exist at "$HOME/Exceptional Spirits Agent Exchange/40-agent-catalogs/" as fallback.`;

export default async function run(api) {
  const claim = (api.args || "").trim().replace(/^["']|["']$/g, "");
  if (!claim) return { summary: 'Usage: /workflow es-verify "<claim about the books to check>"' };

  api.phase("Verify");
  const verifierPrompt = (lens) =>
    `Independently and skeptically verify this claim about the Exceptional Spirits books:\n"${claim}"\n\n` +
    `${SOURCES}\n\n` +
    `Approach (${lens}): gather the concrete evidence for and AGAINST the claim. Do not assume; default ` +
    `to "not proven" unless the evidence is explicit. Then state a verdict — CONFIRMED, REFUTED, or ` +
    `UNCERTAIN — and list the exact evidence behind it: invoice/PO refs, amounts, dates, payment refs, ` +
    `and the source (file path, Odoo record id, or email message_id). Read-only; do not propose or make ` +
    `any change.`;
  const verdicts = await api.parallel([
    () => api.agent(verifierPrompt("start from the source documents and invoice/OCR evidence"), { label: "verify:documents", phase: "Verify", model: SMART, tools: ["bash", "read"] }),
    () => api.agent(verifierPrompt("start from Odoo open items / reconciliation packs and bank lines"), { label: "verify:ledger", phase: "Verify", model: SMART, tools: ["bash", "read"] }),
  ]);

  api.phase("Decide");
  const summary = await api.agent(
    `Two independent verifiers checked this claim:\n"${claim}"\n\n` +
      verdicts.filter(Boolean).map((v, i) => `Verifier ${i + 1}:\n${v}`).join("\n\n---\n\n") +
      `\n\nProduce a go/no-go in the house style. Open with one plain sentence: is the claim CONFIRMED, ` +
      `REFUTED, or NOT PROVEN, and the headline number. Then: the evidence both verifiers agree on; any ` +
      `disagreement; and a **Gaps** section listing exactly what is still missing to be certain. End with ` +
      `the single safe next step. This is read-only evidence for a human decision — explicitly propose NO ` +
      `Odoo write. Return markdown prose.`,
    { label: "decide", phase: "Decide", model: SMART }
  );
  return { summary };
}
