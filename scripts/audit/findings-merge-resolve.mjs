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
 * keeping both sides of each yields:
 *
 *     ## heading A
 *     ## heading B          <- B's heading
 *     > kind / table header <- ONE copy, now belonging to B
 *     | ...body A...        <- A's body, filed under B's heading
 *     | ...body B...
 *
 * Two findings become one heading with two bodies, and A's evidence is now attributed to B. The
 * file still parses, `findings-hygiene.test.ts` still passes (every heading has a kind line and an
 * outcome), and the corruption is invisible until someone reads it and believes the wrong thing.
 *
 * ── WHAT THIS DOES INSTEAD ───────────────────────────────────────────────────────────────────
 *
 * Splits all three merge stages into whole ENTRIES at `^## ` boundaries and takes a union:
 * everything OURS has, plus every entry THEIRS added relative to the merge BASE. An entry is
 * atomic — heading, kind line, table and trailing prose travel together or not at all — so the
 * attribution failure above is structurally impossible rather than merely avoided.
 *
 * Entries are keyed by heading text. An entry present in base and modified on both sides is left
 * to a human: this resolves APPEND collisions, which is what agent PRs produce, and refuses to
 * guess at genuine edits to the same finding.
 *
 * Usage:  node scripts/audit/findings-merge-resolve.mjs [path]
 * Exits 0 on success (file written, ready to `git add`), non-zero if it will not resolve.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = process.argv[2] || "docs/audit/FINDINGS.md";

/** Read one merge stage (1=base, 2=ours, 3=theirs), or null when the stage is absent. */
function stage(n) {
  try {
    return execFileSync("git", ["show", `:${n}:${FILE}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/**
 * Split into a preamble plus ordered entries.
 *
 * The preamble is everything before the first `## ` heading — the file's title and its standing
 * instructions, which are shared and must not be duplicated.
 */
function split(text) {
  const lines = text.split("\n");
  const firstHeading = lines.findIndex((l) => l.startsWith("## "));
  if (firstHeading < 0) return { preamble: text, entries: [] };

  const preamble = lines.slice(0, firstHeading).join("\n");
  const entries = [];
  // Heading text alone is NOT a unique key — this file really does carry repeated headings (two,
  // as of 2026-08-21). Keying on text alone made `find` compare a heading's FIRST occurrence
  // against a later one and report both as edited on both sides, when neither had changed at all.
  // Disambiguating by occurrence keeps duplicates distinct without requiring the file be cleaned up
  // first.
  const seen = new Map();
  let current = null;
  for (const line of lines.slice(firstHeading)) {
    if (line.startsWith("## ")) {
      if (current) entries.push(current);
      const heading = line.trim();
      const nth = (seen.get(heading) ?? 0) + 1;
      seen.set(heading, nth);
      current = { key: `${heading}\u0000#${nth}`, heading, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) entries.push(current);
  return { preamble, entries };
}

const base = stage(1);
const ours = stage(2);
const theirs = stage(3);

if (!ours || !theirs) {
  console.error(`${FILE}: not in a conflicted merge state (missing stage 2 or 3).`);
  process.exit(1);
}

const b = base ? split(base) : { preamble: "", entries: [] };
const o = split(ours);
const t = split(theirs);

const baseKeys = new Set(b.entries.map((e) => e.key));
const ourKeys = new Set(o.entries.map((e) => e.key));

// Entries THEIRS added that we do not already have. Order preserved from theirs.
const added = t.entries.filter((e) => !baseKeys.has(e.key) && !ourKeys.has(e.key));

// An entry both sides changed is a real edit collision, not an append. Refuse rather than guess.
const baseText = new Map(b.entries.map((e) => [e.key, e.lines.join("\n")]));
const contested = t.entries.filter((e) => {
  if (!baseKeys.has(e.key) || !ourKeys.has(e.key)) return false;
  const ourEntry = o.entries.find((x) => x.key === e.key);
  const theirChanged = e.lines.join("\n") !== baseText.get(e.key);
  const ourChanged = ourEntry && ourEntry.lines.join("\n") !== baseText.get(e.key);
  return theirChanged && ourChanged;
});

if (contested.length > 0) {
  console.error(`${FILE}: ${contested.length} entry/entries edited on BOTH sides — resolve by hand:`);
  for (const c of contested) console.error(`  ${c.heading.slice(0, 100)}`);
  process.exit(2);
}

if (added.length === 0) {
  writeFileSync(FILE, ours);
  console.log(`${FILE}: no new entries from theirs — kept ours.`);
  process.exit(0);
}

// Newest-first is this file's convention, and every appended entry is new, so theirs go directly
// after the preamble — ahead of ours only in file position, which carries no meaning beyond recency.
const merged = [...added, ...o.entries];
const body = merged.map((e) => e.lines.join("\n").replace(/\s+$/, "")).join("\n\n");

// THE PREAMBLE SEPARATOR IS LOAD-BEARING, AND ITS ABSENCE COMPOUNDS.
//
// `split()` builds the preamble with `join("\n")`, which does NOT leave a trailing newline. Writing
// `preamble + body` therefore glued the preamble's last line onto the first heading:
//
//     | **Status** | FIXED. |## 2026-08-21 — [FINDING, P1 SEO/CWV] Homepage desktop CLS 0.55 …
//
// A heading that is not at line start STOPS BEING AN ENTRY. `findings-hygiene.test.ts` splits on
// /\n(?=## )/ and never saw it, so the entry was absorbed into the one above — inheriting its kind
// tag and Status row — and every hygiene check stayed green, because they all operate on the parsed
// entry list and an entry that has ceased to exist trips none of them.
//
// It COMPOUNDED because this resolver re-reads its own output: a glued heading is no longer a `## `
// at line start, so the next run counts it as preamble and glues the next one on top. Four batch
// merges produced four invisible entries across three lanes before a lane agent noticed the
// rendering was garbage.
const preamble = o.preamble.replace(/\s*$/, "");
writeFileSync(FILE, `${preamble}\n\n${body}\n`);

// NO SILENT LOSS. Re-parse what was just written and assert the entry count. The defect above was
// invisible precisely because nothing counted — the file parsed 450 entries and should have parsed
// 454, and no check compared those numbers. This one does, and fails loudly rather than reporting a
// successful merge over a file it has damaged.
const written = readFileSync(FILE, "utf8");
const headingCount = written.split("\n").filter((l) => l.startsWith("## ")).length;
if (headingCount !== merged.length) {
  console.error(
    `${FILE}: REFUSING — wrote ${merged.length} entries but the file parses ${headingCount}. ` +
      `Entries have been glued or lost; the file is NOT safe to commit.`
  );
  process.exit(3);
}
console.log(`${FILE}: merged ${added.length} entry/entries from theirs (${o.entries.length} kept).`);
for (const a of added) console.log(`  + ${a.heading.slice(0, 100)}`);
