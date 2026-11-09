#!/usr/bin/env node
// Folds every staged finding in docs/audit/findings-staging/*.md into docs/audit/FINDINGS.md,
// then deletes the staged files. See docs/audit/findings-staging/README.md for why this exists.
import { readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { alreadyPresent } from "./lib/findings-entry-set.mjs";

const STAGING_DIR = process.env.FINDINGS_STAGING_DIR ?? "docs/audit/findings-staging";
const FINDINGS = process.env.FINDINGS_STAGING_TARGET ?? "docs/audit/FINDINGS.md";

// BUG FIX (2026-11-09, tooling): this script used to parse NO flags at all — `process.argv` was
// never read anywhere — so `--dry-run` (the universal CLI convention for "show me what would
// happen without writing anything") silently fell through to a REAL, full fold. A sibling agent
// ran `--dry-run` expecting a safe preview and instead deleted every OTHER concurrent lane's
// staged finding files and appended them all into FINDINGS.md (caught via `git status` and
// reverted before anything was pushed — see the staged finding for this fix for the live repro).
// Any unrecognized flag had the identical failure mode, not just `--dry-run` specifically, so this
// guards both: an unknown flag is now a loud, non-zero-exit error instead of a silent no-op, and
// `--dry-run` is now real — it runs the exact same discovery/parsing/validation below (so a
// malformed staged file is still caught) but performs NO filesystem write (no edit to FINDINGS.md,
// no deletion of any staged file), only prints what WOULD happen.
const KNOWN_FLAGS = new Set(["--dry-run"]);
const args = process.argv.slice(2);
const unknownFlags = args.filter((a) => a.startsWith("-") && !KNOWN_FLAGS.has(a));
if (unknownFlags.length) {
  console.error(
    `Unrecognized flag(s): ${unknownFlags.join(", ")}\n` +
      `This script only supports: ${[...KNOWN_FLAGS].join(", ")} (no flags at all = real fold).\n` +
      "Refusing to run rather than silently falling through to a real fold — see " +
      "docs/audit/findings-staging/README.md."
  );
  process.exit(1);
}
const DRY_RUN = args.includes("--dry-run");
if (DRY_RUN) console.log("[DRY RUN] previewing only — no files will be written or deleted.\n");

// Backticks around the kind word are OPTIONAL to match — `> **kind:** FINDING` (bare) is a real,
// common staged convention (23 files, 2026-08-25 through 2026-08-28) — but the canonical form
// this function emits always wraps it, because findings-hygiene.test.ts's own kind-detection
// regex (`/> \*\*kind:\*\* `[A-Z-]+`/`) requires the backticks and would fail a bare one.
const KIND_LINE_RE = /^> \*\*kind:\*\* `?([A-Z-]+)`?\s*$/;

/**
 * Normalizes a staged entry to FINDINGS.md's own convention — heading line first, backtick-wrapped
 * kind line after — regardless of how the staging author wrote it.
 *
 * MEASURED 2026-08-28: this script's original guard required a literal `## YYYY-MM-DD — [...]`
 * heading as the file's FIRST line, but every staged file actually in use (README.md's own
 * documented convention, and every real staged finding checked — 2026-08-25 through 2026-08-28,
 * ~80 files) puts `> **kind:** ...` BEFORE a plain `## Title` heading with no date prefix and no
 * bracket tag; a further 23 of those also wrote the kind word bare (`FINDING`, no backticks). The
 * guard rejected effectively all of them, and rejecting even ONE staged file made the script
 * refuse the ENTIRE batch (see the removed `bad.length` early-exit below) — so the fold step "the
 * coordinator does this routinely" (README.md) had not actually folded anything in for days:
 * findings-staging accumulated while FINDINGS.md stood still.
 *
 * The order matters beyond cosmetics: findings-hygiene.test.ts's entries() (and this repo's other
 * FINDINGS.md tooling, findings-entry-set.mjs's splitEntries()) both split the document on
 * `\n(?=## )` — text BEFORE a `## ` heading belongs to the PRECEDING entry's body, not the one
 * that heading starts. A kind line sitting ahead of its own heading is swallowed into whatever
 * entry precedes it once folded, and the new entry then fails "every entry declares a kind" the
 * moment it lands — a second, silent failure mode layered under the first. And a bare (unwrapped)
 * kind word fails that same hygiene check even when the order is already correct.
 *
 * Returns null (never guesses) when the file has no real heading line (`# ` or `## `) or no kind
 * line.
 *
 * CORRECTED 2026-11-08 (5-engine live monitor sweep): a staged writeup using `## Root cause` /
 * `## Fix` / `## Evidence` sub-sections at the SAME heading level FINDINGS.md reserves for entry
 * boundaries used to be rejected outright and left stuck in staging "for a human pass" — the
 * stated worry was that demoting those sub-headings would mean guessing which line is the "real"
 * entry title. That worry doesn't survive contact with this repo's own staging convention: a
 * staged file documents exactly ONE finding (issue-handling policy, "one file per finding"), so
 * there is never a legitimate case where a SECOND `## ` line in a staged file is a separate
 * finding that needs splitting out — it is always a PR-write-up-policy structural sub-section
 * (Root cause / Fix rationale / Evidence / Blast radius / Verify / Summary / ...), and the FIRST
 * real `## ` line is always the entry title. Measured live the day this was fixed: 98 of 115
 * staged files hit exactly this guard and had been accumulating unfolded since 2026-09-07 — the
 * "left for a human pass" fallback had, in practice, become a silent one-way trap, not a
 * safety valve. FINDINGS.md's own already-folded entries agree with the correction: it carries
 * 7000+ real `### ` sub-section lines using these exact titles, so demoting a staged file's
 * second-and-later `## ` lines to `### ` doesn't invent a new convention, it just applies the one
 * FINDINGS.md already has. `entries()`/`splitEntries()` only split on `## `, never `### `, so a
 * demoted sub-section can no longer fragment into a headless sub-"entry."
 *
 * BUG FIX (2026-09-17, Ask Largo standing mandate): the heading scan below used to count every
 * line starting with `## ` regardless of fenced-code-block state, so a finding whose EVIDENCE
 * section quotes a live product's own markdown output — a normal, encouraged pattern in this
 * repo's "PR write-up policy" (evidence = "live numbers, header captures... whatever actually
 * proved the bug") — got misidentified as "a body using `## ` for its own sub-sections" (the
 * genuine defect this guard exists to catch, see above) whenever that quoted output itself
 * contained real `## `-level headings. Live repro: two well-formed, single-real-heading Ask Largo
 * swing findings (2026-09-17-lane-rank-score-precision-mismatch.md,
 * 2026-09-17-watch-entry-geometry-duplication.md) each quote a live play-brief's own markdown
 * inside a ``` fence in their Evidence section (containing `## Why this setup` / `## Entry` /
 * etc.) — both silently never folded across multiple fold runs, indistinguishable from the
 * genuine 10-of-109 multi-heading defect without reading each skipped file by hand. `realLineMask`
 * marks every line NOT inside a ``` ... ``` fence (the fence delimiter line itself never counts as
 * heading/kind content either way); heading/kind detection below only looks at those.
 *
 * CORRECTED AGAIN, SAME DAY (2026-11-08): the first version of the "demote sub-sections" fix above
 * only recognized a `## ` line as the real title — but the actual majority convention in real
 * staged files (73 of 115 checked this run) titles the entry with a bare `# Title` (ONE hash), not
 * `## Title`. For those files `headingIdx` landed on the file's FIRST STRUCTURAL SUB-SECTION
 * instead (e.g. `## Root cause`), because that was the first line starting with literally `"## "` —
 * the real `# Title` line never matched at all. Caught before landing on `main`: a dry run folded
 * 17 real entries titled `## Summary` / `## Root cause` / `## What broke` / `## Symptom`, each with
 * its REAL descriptive title orphaned as untagged prose glued onto whichever entry preceded it
 * (entries()/splitEntries() split only on `## `, so a bare `# ` line starts nothing). That is
 * silent corruption, strictly worse than the original "leave it stuck in staging" failure mode this
 * whole function exists to improve on. Fixed by recognizing EITHER a `# ` or `## ` real line as the
 * title (whichever comes first), normalizing it to `## ` (FINDINGS.md's entry-boundary level), and
 * demoting every subsequent real `# `/`## ` line to `### ` — one rule now covers both conventions
 * actually in use instead of silently assuming the file always used the one the first attempt
 * checked by hand.
 */
function realLineMask(lines) {
  let inFence = false;
  return lines.map((l) => {
    if (l.trim().startsWith("```")) {
      inFence = !inFence;
      return false;
    }
    return !inFence;
  });
}

const HEADING_RE = /^#{1,2} /;

function findRealHeadingIdx(lines) {
  const mask = realLineMask(lines);
  return lines.findIndex((l, i) => mask[i] && HEADING_RE.test(l));
}

function normalizeEntry(content) {
  const lines = content.split("\n");
  const mask = realLineMask(lines);
  const headingIdx = lines.findIndex((l, i) => mask[i] && HEADING_RE.test(l));
  const kindIdx = lines.findIndex((l, i) => mask[i] && KIND_LINE_RE.test(l));
  if (headingIdx === -1 || kindIdx === -1) return null;

  // A kind-first file where everything between the kind line and the first real heading is NOT
  // blank (e.g. a table whose own `**Title**` row carries the real title as a cell value, never
  // as a heading line) means the "first real heading" found above is NOT the title — it's the
  // first thing that happens to look like one, typically the first structural sub-section. Caught
  // live 2026-11-08 right after the '# '-vs-'## ' fix above: `2026-11-08-cron-audit-weekend-eod-
  // suppress.md` opens with a kind line, then a `| Field | Value |` table carrying `**Title**` as
  // a row, then its first real heading is `## What broke` — a genuine sub-section, not the title.
  // Guessing "## What broke" is the title would have repeated the exact silent-corruption failure
  // the '# '-vs-'## ' fix just corrected, just via a different shape. Returning null here keeps
  // this one file (observed once in 115) in staging for a human pass rather than inventing a new
  // title-from-table-cell heuristic to cover a single sample.
  if (kindIdx < headingIdx && lines.slice(kindIdx + 1, headingIdx).some((l) => l.trim() !== "")) return null;

  // The file's own first real heading (whether written `# ` or `## `) becomes the entry-boundary
  // `## ` line; every real heading after it — same ambiguity, `# ` or `## ` — is a structural
  // sub-section and is demoted to `### `. Fenced-quoted heading-shaped lines are excluded by
  // `mask`, same as before.
  const demoted = lines.map((l, i) => {
    if (!mask[i] || !HEADING_RE.test(l)) return l;
    return l.replace(HEADING_RE, i === headingIdx ? "## " : "### ");
  });

  const kindWord = demoted[kindIdx].match(KIND_LINE_RE)[1];
  const canonicalKindLine = `> **kind:** \`${kindWord}\``;

  if (kindIdx > headingIdx) {
    // Already heading-first — only the kind word itself might still need backtick-wrapping.
    const out = [...demoted];
    out[kindIdx] = canonicalKindLine;
    return out.join("\n");
  }

  const dropBlankAfterKind = demoted[kindIdx + 1] === "";
  const rest = demoted.filter((_, i) => i !== kindIdx && !(dropBlankAfterKind && i === kindIdx + 1));
  const newHeadingIdx = findRealHeadingIdx(rest);
  return [...rest.slice(0, newHeadingIdx + 1), "", canonicalKindLine, ...rest.slice(newHeadingIdx + 1)].join("\n");
}

const files = readdirSync(STAGING_DIR)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort()
  .reverse(); // date-prefixed filenames — newest first, matching FINDINGS.md's own convention

if (files.length === 0) {
  console.log("No staged findings to fold.");
  process.exit(0);
}

const parsed = files.map((f) => {
  const raw = readFileSync(join(STAGING_DIR, f), "utf8").trimEnd();
  return { file: f, content: normalizeEntry(raw) };
});

// A malformed file is skipped, not a reason to refuse the whole batch — one bad staged file
// previously blocked every OTHER lane's valid, already-correct finding from ever reaching
// FINDINGS.md. It stays in staging (never deleted) so it can be fixed and folded on a later run.
const invalid = parsed.filter((p) => p.content === null);
if (invalid.length) {
  console.error(
    "Skipping — these staged files have no real heading line ('# ' or '## ') and/or no " +
      "'> **kind:** `...`' line:"
  );
  for (const v of invalid) console.error(`  ${v.file}`);
}

const valid = parsed.filter((p) => p.content !== null);
if (valid.length === 0) {
  console.log("Nothing valid to fold.");
  process.exit(invalid.length ? 1 : 0);
}

const src = readFileSync(FINDINGS, "utf8");

// IDEMPOTENCY. This script had no duplicate check at all, so folding the same staged entry twice
// appended a second byte-identical copy — and `findings-no-loss.test.ts` then forbade removing
// either, so copies only ever accumulated (measured on `main`: one entry reached THREE). A staged
// entry already present verbatim is skipped and its file still deleted, because the file's whole
// job is to get its content into FINDINGS.md and that content is already there. An entry whose body
// has legitimately CHANGED is not byte-identical, so it still folds.
const duplicates = valid.filter((s) => alreadyPresent(src, s.content));
const fresh = valid.filter((s) => !alreadyPresent(src, s.content));
if (duplicates.length) {
  console.log(`Skipping ${duplicates.length} staged finding(s) already present verbatim in ${FINDINGS}:`);
  for (const d of duplicates) console.log(`  = ${d.file}`);
}
if (fresh.length === 0) {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Nothing new to fold — would delete ${valid.length} duplicate staged file(s):`);
    for (const s of valid) console.log(`  = ${s.file}`);
  } else {
    for (const s of valid) rmSync(join(STAGING_DIR, s.file));
    console.log("Nothing new to fold — every valid staged finding was already present.");
  }
  process.exit(invalid.length ? 1 : 0);
}

const lines = src.split("\n");
const insertAt = lines.findIndex((l) => l.startsWith("## "));
if (insertAt === -1) {
  console.error(`Could not find an insertion point (no '## ' heading) in ${FINDINGS}`);
  process.exit(1);
}

const block = fresh.map((s) => s.content).join("\n\n") + "\n\n";
const before = lines.slice(0, insertAt).join("\n");
const after = lines.slice(insertAt).join("\n");
const merged = `${before}\n${block}${after}`;

if (DRY_RUN) {
  console.log(`[DRY RUN] Would fold ${fresh.length} staged finding(s) into ${FINDINGS}:`);
  for (const s of fresh) console.log(`  + ${s.file}`);
  console.log(`[DRY RUN] Would then delete ${valid.length} staged file(s) (folded + already-present duplicates):`);
  for (const s of valid) console.log(`  - ${s.file}`);
} else {
  writeFileSync(FINDINGS, merged.endsWith("\n") ? merged : `${merged}\n`);

  // Only files that actually landed (folded fresh, or already-present duplicates) are removed — an
  // invalid file is left for a human to fix rather than silently vanishing.
  for (const s of valid) rmSync(join(STAGING_DIR, s.file));

  console.log(`Folded ${fresh.length} staged finding(s) into ${FINDINGS}:`);
  for (const s of fresh) console.log(`  + ${s.file}`);
}
if (invalid.length) {
  console.log(`${invalid.length} staged file(s) skipped for a missing heading/kind line — see above.`);
  process.exit(1);
}
