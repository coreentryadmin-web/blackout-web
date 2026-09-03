#!/usr/bin/env node
/**
 * Collect SPX platform backlog items for autonomous Cloud Agent dispatch.
 * Reads unchecked tasks from docs/ops/SPX-PLATFORM-BACKLOG.md.
 *
 * Outputs JSON: { generated_at, fingerprint, count, items[] }
 *
 * Usage:
 *   node scripts/spx-collect-backlog-items.mjs
 *   node scripts/spx-collect-backlog-items.mjs --pretty
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pretty = process.argv.includes("--pretty");
const backlogPath = join(process.cwd(), "docs/ops/SPX-PLATFORM-BACKLOG.md");

/** @typedef {{ id: string, priority: 'P0'|'P1'|'P2', source: string, title: string, detail: string }} BacklogItem */

/** @type {BacklogItem[]} */
const items = [];

function add(priority, source, id, title, detail) {
  items.push({ id, priority, source, title, detail: String(detail).slice(0, 500) });
}

function parseBacklogMarkdown(src) {
  const lines = src.split("\n");
  let currentPriority = "P1";
  let currentSection = "backlog";

  for (const raw of lines) {
    const line = raw.trim();
    if (/^##\s+P0/i.test(line)) currentPriority = "P0";
    else if (/^##\s+P1/i.test(line)) currentPriority = "P1";
    else if (/^##\s+P2/i.test(line)) currentPriority = "P2";
    else if (/^##\s+/.test(line)) currentSection = line.replace(/^##\s+/, "").toLowerCase();

    const open = line.match(/^- \[ \]\s+(.+)$/);
    if (!open) continue;
    const body = open[1].trim();
    const id = createHash("sha1").update(body).digest("hex").slice(0, 10);
    add(currentPriority, currentSection, `backlog:${id}`, body, body);
  }
}

try {
  const src = readFileSync(backlogPath, "utf8");
  parseBacklogMarkdown(src);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  add("P0", "backlog", "backlog:file-missing", "SPX platform backlog file missing", msg);
}

const fingerprint = createHash("sha256")
  .update(items.map((i) => `${i.priority}:${i.id}`).join("|"))
  .digest("hex")
  .slice(0, 12);

const payload = {
  generated_at: new Date().toISOString(),
  fingerprint,
  count: items.length,
  items,
};

if (pretty) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(JSON.stringify(payload));
}

process.exit(items.length > 0 ? 1 : 0);
