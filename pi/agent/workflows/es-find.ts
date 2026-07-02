// es-find.ts — search the Exceptional Spirits catalogs in parallel for a vendor,
// invoice reference, or phrase, and return consolidated hits. READ-ONLY.
//
//   /workflow es-find "Example Distillery INV-0123"
//   /workflow es-find "Example Distillery"
//
// Tiered: the two searchers run on a cheaper model (FAST) since they mostly drive
// sqlite; the consolidation runs on SMART. The catalogs are local sqlite (bash +
// sqlite3, no MCP), so each searcher absorbs a big DB and returns only the matches.

import { SMART, FAST } from "./_models.ts";

export const meta = {
  name: "es-find",
  description: "Search the Exceptional Spirits mailbox + evidence catalogs in parallel for a vendor, invoice ref, or phrase, and return the consolidated matches. Read-only; touches no live system.",
  phases: [{ title: "Search" }, { title: "Consolidate" }],
};

const MAILBOX = '"$HOME/git/es-365/state/mailbox-catalog/catalog.sqlite"';
const MAILBOX_ALT = '"$HOME/Exceptional Spirits Agent Exchange/40-agent-catalogs/mailbox-catalog.sqlite"';
const EVIDENCE = '"$HOME/git/es-odoo/data/evidence-cache.sqlite3"';
const EVIDENCE_ALT = '"$HOME/Exceptional Spirits Agent Exchange/40-agent-catalogs/evidence-cache.sqlite3"';

export default async function run(api) {
  const q = (api.args || "").trim().replace(/^["']|["']$/g, "");
  if (!q) return { summary: 'Usage: /workflow es-find "<vendor / invoice ref / phrase>"' };

  api.phase("Search");
  const searchers = [
    `Search the es-365 mailbox metadata catalog for: ${q}\n` +
      `It is a sqlite DB at ${MAILBOX} (fallback ${MAILBOX_ALT}). Use bash + sqlite3, read-only.\n` +
      `Useful tables: messages(received_at, sender_address, subject, has_attachments, message_id), ` +
      `attachments(name, message_id), message_tokens(token, message_id), ` +
      `attachment_accounting_candidates(score, attachment_name, categories_json, message_id).\n` +
      `Run a few targeted queries: subject LIKE, sender_address LIKE, message_tokens.token LIKE, ` +
      `attachments.name LIKE. Return the strongest matching rows (date | sender | subject | ref | message_id). ` +
      `If nothing matches, say so plainly.`,
    `Search the es-odoo evidence cache for: ${q}\n` +
      `Prefer: cd "$HOME/git/es-odoo" && python3 scripts/evidence_db.py search '${q}'\n` +
      `Or sqlite3 over the DB at ${EVIDENCE} (fallback ${EVIDENCE_ALT}); tables include source_files, ` +
      `email_messages, open_items, bank_lines, evidence_items, plus the FTS index search_fts. Read-only.\n` +
      `Return the matching source files / emails / open items with their reference and file path. ` +
      `If nothing matches, say so plainly.`,
  ];
  const hits = await api.parallel(
    searchers.map((p, i) => () =>
      api.agent(p, { label: `search:${i === 0 ? "mail" : "evidence"}`, phase: "Search", model: FAST, tools: ["bash", "read"] })
    )
  );

  api.phase("Consolidate");
  const summary = await api.agent(
    `Consolidate these search results for "${q}" into one short, readable findings note.\n\n` +
      hits.filter(Boolean).map((h, i) => `Source ${i + 1}:\n${h}`).join("\n\n---\n\n") +
      `\n\nLead with how many solid matches were found and the single most relevant one. List matches ` +
      `as a short table (date | where it lives | who | reference). Plain language; name brands, not ` +
      `database fields. Note clearly what was NOT found. This is read-only evidence for a human to act ` +
      `on — propose no Odoo changes. Return markdown prose.`,
    { label: "consolidate", phase: "Consolidate", model: SMART }
  );
  return { summary };
}
