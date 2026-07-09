#!/usr/bin/env node
/**
 * Export P0/P1 findings from tool-agent NDJSON logs → ops action-items shape.
 * Merged by ops-auto-fix with ops:collect output.
 *
 * Usage: node scripts/tool-agents/export-action-items.mjs [--pretty]
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const pretty = process.argv.includes("--pretty");
const root = join(process.cwd(), "audit-output", "tool-agents");
const items = [];
const seen = new Set();

if (!existsSync(root)) {
  const empty = { generated_at: new Date().toISOString(), fingerprint: "none", count: 0, items: [] };
  console.log(JSON.stringify(empty, null, pretty ? 2 : 0));
  process.exit(0);
}

const cutoff = Date.now() - 60 * 60 * 1000;

for (const tool of readdirSync(root)) {
  const path = join(root, tool, "findings.ndjson");
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = new Date(row.ts).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    if (!["P0", "P1"].includes(row.severity)) continue;
    const id = `tool-agent:${tool}:${row.id ?? row.detail?.slice(0, 40)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      priority: row.severity,
      source: `tool-agent:${tool}`,
      title: `${tool}: ${row.id ?? "finding"}`,
      detail: row.detail ?? "",
    });
  }
}

const fingerprint = createHash("sha256")
  .update(items.map((i) => i.id).sort().join("|"))
  .digest("hex")
  .slice(0, 12);

const out = {
  generated_at: new Date().toISOString(),
  fingerprint,
  count: items.length,
  items,
};

console.log(JSON.stringify(out, null, pretty ? 2 : 0));
process.exit(items.length ? 1 : 0);
