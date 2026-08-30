#!/usr/bin/env node
// Folds every staged finding in docs/audit/findings-staging/*.md into docs/audit/FINDINGS.md,
// then deletes the staged files. See docs/audit/findings-staging/README.md for why this exists.
import { readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { alreadyPresent } from "./lib/findings-entry-set.mjs";

const STAGING_DIR = process.env.FINDINGS_STAGING_DIR ?? "docs/audit/findings-staging";
const FINDINGS = process.env.FINDINGS_STAGING_TARGET ?? "docs/audit/FINDINGS.md";

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
 * Returns null (never guesses) when the file has no `## ` heading, no kind line, or MORE THAN ONE
 * `## `-level line — that last case is a real, separate defect measured in the same sweep (10 of
 * 109 files): a staged writeup using `## Root cause` / `## Fix` / `## Evidence` sub-sections at
 * the SAME heading level FINDINGS.md reserves for entry boundaries. `entries()`/`splitEntries()`
 * split on every `## ` line, so folding one of these in raw fragments a single finding into
 * several headless sub-"entries," none of which carry the real kind tag (it only follows the
 * file's own first heading). Demoting those sub-headings automatically would mean guessing which
 * line is the "real" entry title when a body legitimately needs its own `## ` for other reasons —
 * left for a human pass instead, same as the other two defects.
 * Left in staging for a human pass, not silently mishandled.
 */
function normalizeEntry(content) {
  const lines = content.split("\n");
  const headingIdx = lines.findIndex((l) => l.startsWith("## "));
  const kindIdx = lines.findIndex((l) => KIND_LINE_RE.test(l));
  const headingCount = lines.filter((l) => l.startsWith("## ")).length;
  if (headingIdx === -1 || kindIdx === -1 || headingCount > 1) return null;

  const kindWord = lines[kindIdx].match(KIND_LINE_RE)[1];
  const canonicalKindLine = `> **kind:** \`${kindWord}\``;

  if (kindIdx > headingIdx) {
    // Already heading-first — only the kind word itself might still need backtick-wrapping.
    const out = [...lines];
    out[kindIdx] = canonicalKindLine;
    return out.join("\n");
  }

  const dropBlankAfterKind = lines[kindIdx + 1] === "";
  const rest = lines.filter((_, i) => i !== kindIdx && !(dropBlankAfterKind && i === kindIdx + 1));
  const newHeadingIdx = rest.findIndex((l) => l.startsWith("## "));
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
    "Skipping — these staged files have no '## ' heading, no '> **kind:** `...`' line, and/or " +
      "more than one '## ' line (a body using '## ' for its own sub-sections):"
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
  for (const s of valid) rmSync(join(STAGING_DIR, s.file));
  console.log("Nothing new to fold — every valid staged finding was already present.");
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

writeFileSync(FINDINGS, merged.endsWith("\n") ? merged : `${merged}\n`);

// Only files that actually landed (folded fresh, or already-present duplicates) are removed — an
// invalid file is left for a human to fix rather than silently vanishing.
for (const s of valid) rmSync(join(STAGING_DIR, s.file));

console.log(`Folded ${fresh.length} staged finding(s) into ${FINDINGS}:`);
for (const s of fresh) console.log(`  + ${s.file}`);
if (invalid.length) {
  console.log(`${invalid.length} staged file(s) skipped for a missing heading/kind line — see above.`);
  process.exit(1);
}
