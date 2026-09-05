#!/usr/bin/env node
/**
 * Parse CLAUDE_ANSWERS_TO_CQ.md into a fix-queue ledger.
 * Usage: node scripts/blackout/parse-cq-fix-queue.mjs > .blackout-agent/CQ_FIX_QUEUE.md
 */
import { readFileSync, writeFileSync } from "node:fs";

const ANSWERS = readFileSync(".blackout-agent/CLAUDE_ANSWERS_TO_CQ.md", "utf8");
const CCQ = readFileSync(".blackout-agent/CURSOR_CHALLENGES_TO_CQ.md", "utf8");

/** CCQ-flagged actionable gaps (CQ id -> fix status on main @ batch-1 start). */
const ACTIONABLE = {
  "170": { gap: "Whop webhook route signature test", status: "FIXED", pr: "#3998" },
  "171": { gap: "validate:tool-agent:* CI wiring", status: "FIXED", pr: "#4007" },
  "183": { gap: "sitemap lastmod CI guard", status: "FIXED", pr: "#3995 + ci.yml" },
  "095": { gap: "internals_estimated UI badge (0 tsx consumers)", status: "FIXED_BATCH1", pr: "cursor/cq-fix-pass-batch1" },
  "173": { gap: "premium gate functional 403 test", status: "FIXED_BATCH1", pr: "cursor/cq-fix-pass-batch1" },
  "007": { gap: "email enumeration via isNew response", status: "FIXED_BATCH1", pr: "cursor/cq-fix-pass-batch1" },
  "003": { gap: "JWT fast-path tier downgrade window", status: "FIXED_BATCH2", pr: "cursor/cq-fix-pass-batch2" },
  "054": { gap: "evaluateVectorPickLiveStatus spot<=0 guard + test", status: "FIXED_BATCH2", pr: "cursor/cq-fix-pass-batch2" },
  "051": { gap: "vector offline audit scripts not in package.json", status: "FIXED_BATCH2", pr: "cursor/cq-fix-pass-batch2" },
  "083": { gap: "FlowTapeSummary missing per-desk as_of freshness", status: "FIXED_BATCH2", pr: "cursor/cq-fix-pass-batch2" },
};

const blocks = ANSWERS.split(/\n\*\*CQ-/);
const rows = [];
const counts = { PROVEN: 0, PARTIAL: 0, DISPROVEN: 0, UNKNOWN: 0 };

for (const block of blocks.slice(1)) {
  const id = block.match(/^(\d+)/)?.[1];
  const status = block.match(/\|\s*(PROVEN|PARTIALLY PROVEN|DISPROVEN|UNKNOWN)/)?.[1];
  if (!id || !status) continue;

  if (status === "PROVEN") counts.PROVEN++;
  else if (status === "PARTIALLY PROVEN") counts.PARTIAL++;
  else if (status === "DISPROVEN") counts.DISPROVEN++;
  else if (status === "UNKNOWN") counts.UNKNOWN++;

  const action = ACTIONABLE[id];
  let fixStatus;
  if (action) {
    fixStatus = action.status;
  } else if (status === "PROVEN" || status === "DISPROVEN") {
    fixStatus = "CLOSED";
  } else if (status === "UNKNOWN") {
    fixStatus = "CONFIRMED-UNKNOWN";
  } else {
    fixStatus = "CONFIRMED-PARTIAL";
  }

  rows.push({ id, status, fixStatus, gap: action?.gap ?? "" });
}

rows.sort((a, b) => Number(a.id) - Number(b.id));

const now = new Date().toISOString();
let md = `# CQ Fix Queue — Cursor → Claude cross-exam closure

**Generated:** ${now}  
**Source:** \`CLAUDE_ANSWERS_TO_CQ.md\` (218 answers) + \`CURSOR_CHALLENGES_TO_CQ.md\` (CCQ-001–023)

## Summary

| Answer class | Count | Fix disposition |
|--------------|-------|-----------------|
| PROVEN | ${counts.PROVEN} | CLOSED (no code change) |
| DISPROVEN | ${counts.DISPROVEN} | CLOSED (premise invalid) |
| PARTIALLY PROVEN | ${counts.PARTIAL} | ${counts.PARTIAL} CONFIRMED-PARTIAL; ${Object.values(ACTIONABLE).filter((a) => a.status.startsWith("FIX")).length} with queued/fixed code gaps |
| UNKNOWN | ${counts.UNKNOWN} | CONFIRMED-UNKNOWN (sandbox-limited) |

## CCQ-actionable gaps

| CQ | Gap | Status | PR |
|----|-----|--------|-----|
`;

for (const [id, a] of Object.entries(ACTIONABLE).sort((x, y) => Number(x[0]) - Number(y[0]))) {
  md += `| CQ-${id.padStart(3, "0")} | ${a.gap} | ${a.status} | ${a.pr} |\n`;
}

md += `
## Per-CQ ledger

| CQ | Answer | Fix status | Notes |
|----|--------|------------|-------|
`;

for (const r of rows) {
  const note = r.gap ? r.gap : "";
  md += `| CQ-${r.id.padStart(3, "0")} | ${r.status.replace("PARTIALLY PROVEN", "PARTIAL")} | ${r.fixStatus} | ${note} |\n`;
}

md += `
---

**Process:** Cursor opens small \`cursor/*\` fix PRs; Claude GitHub Approve @ HEAD required before merge (HARD MERGE GATE).
`;

const out = ".blackout-agent/CQ_FIX_QUEUE.md";
writeFileSync(out, md);
console.log(`Wrote ${out} (${rows.length} CQs)`);
console.log(JSON.stringify(counts));
