#!/usr/bin/env node
/**
 * Resolve a `docs/audit/FINDINGS.md` merge conflict by taking the union of ENTRIES.
 *
 * ── WHY A TOOL AND NOT A MANUAL RESOLVE ──────────────────────────────────────────────────────
 *
 * Every agent PR appends a finding at the same anchor — directly under the RUN-LOG pointer — so
 * every pair of agent PRs conflicts here, always, regardless of what code they touch. With 30 PRs
 * in flight that is not an occasional merge annoyance; it is the single thing standing between the
 * fleet's output and `main`.
 *
 * ── WHY HUNK-LEVEL "KEEP BOTH" IS WRONG ──────────────────────────────────────────────────────
 *
 * The obvious resolution — keep both sides of each conflict hunk — corrupts the file, and does it
 * quietly. Two findings appended at the same anchor do not produce ONE conflict; they produce
 * SEVERAL, because the shared boilerplate between them (the `> **kind:** FINDING` line, the
 * `| Field | Detail |` table header) matches on both sides and git emits it as common context.
 * So the conflict splits into a heading hunk and a table-body hunk with shared lines between, and
 * keeping both sides of each yields two findings under ONE heading, with the first one's evidence
 * now attributed to the second. The file still parses, `findings-hygiene.test.ts` still passes, and
 * the corruption is invisible until someone reads it and believes the wrong thing.
 *
 * ── WHAT THIS DOES INSTEAD ───────────────────────────────────────────────────────────────────
 *
 * Splits all three merge stages into whole ENTRIES at `^## ` boundaries and takes a union:
 * everything OURS has, plus every entry THEIRS added relative to the merge BASE. An entry is
 * atomic — heading, kind line, table and trailing prose travel together or not at all — so the
 * attribution failure above is structurally impossible rather than merely avoided.
 *
 * The decision logic lives in `lib/findings-merge-core.mjs` so it can be unit-tested against
 * fixtures; this file is the git-stage plumbing around it. See that module for why an identical
 * edit on both sides is not a collision, and why input is repaired before it is split.
 *
 * Usage:  node scripts/audit/findings-merge-resolve.mjs [path]
 * Exits 0 on success (file written, ready to `git add`), non-zero if it will not resolve.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { resolveStages } from "./lib/findings-merge-core.mjs";

const FILE = process.argv[2] || "docs/audit/FINDINGS.md";

/** Read one merge stage (1=base, 2=ours, 3=theirs), or null when the stage is absent. */
function stage(n) {
  try {
    return execFileSync("git", ["show", `:${n}:${FILE}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

const base = stage(1);
const ours = stage(2);
const theirs = stage(3);

if (!ours || !theirs) {
  console.error(`${FILE}: not in a conflicted merge state (missing stage 2 or 3).`);
  process.exit(1);
}

const result = resolveStages({ base, ours, theirs });

if (result.contested.length > 0) {
  console.error(`${FILE}: ${result.contested.length} entry/entries edited on BOTH sides — resolve by hand:`);
  for (const c of result.contested) console.error(`  ${c.heading.slice(0, 100)}`);
  process.exit(2);
}

if (!result.ok) {
  console.error(
    `${FILE}: REFUSING — expected ${result.lost.expected} entries but the merged text parses ` +
      `${result.lost.got}. Entries have been glued or lost; the file is NOT safe to commit.`
  );
  process.exit(3);
}

writeFileSync(FILE, result.text);

if (result.repaired > 0) {
  // Loud, not silent: a repaired input means some OTHER branch is still carrying the damage.
  console.log(`${FILE}: repaired ${result.repaired} heading(s) that arrived fused onto a previous line.`);
}

if (result.added.length === 0) {
  console.log(`${FILE}: no new entries from theirs — kept ours.`);
  process.exit(0);
}

console.log(`${FILE}: merged ${result.added.length} entry/entries from theirs.`);
for (const a of result.added) console.log(`  + ${a.heading.slice(0, 100)}`);
