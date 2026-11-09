import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Covers scripts/audit/findings-fold-staging.mjs — the script that replaced direct edits to
 * FINDINGS.md (see docs/audit/findings-staging/README.md). Every test runs against a throwaway
 * FINDINGS.md + staging dir, never the real ones.
 */

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "findings-fold-"));
  const findings = join(dir, "FINDINGS.md");
  const staging = join(dir, "findings-staging");
  mkdirSync(staging);
  writeFileSync(
    findings,
    "# FINDINGS — living issue log\n\n(intro paragraph.)\n\n## 2026-08-01 — [FINDING, P2] an existing entry\n\n> **kind:** `FINDING`\n\nbody.\n"
  );
  return { dir, findings, staging };
}

function run(staging: string, findings: string) {
  return execFileSync("node", ["scripts/audit/findings-fold-staging.mjs"], {
    env: { ...process.env, FINDINGS_STAGING_DIR: staging, FINDINGS_STAGING_TARGET: findings },
    encoding: "utf8",
  });
}

test("folds one staged file in right after the intro, before the existing entry", () => {
  const { dir, findings, staging } = setup();
  writeFileSync(
    join(staging, "2026-08-23-new-thing.md"),
    "## 2026-08-23 — [FINDING, P1 Test] a new finding\n\n> **kind:** `FINDING`\n\nbody.\n"
  );
  run(staging, findings);
  const out = readFileSync(findings, "utf8");
  rmSync(dir, { recursive: true, force: true });

  const newIdx = out.indexOf("## 2026-08-23");
  const oldIdx = out.indexOf("## 2026-08-01");
  assert.ok(newIdx > 0, "new entry missing from FINDINGS.md");
  assert.ok(newIdx < oldIdx, "new entry must land ABOVE the pre-existing one (newest-first)");
});

test("deletes staged files after a successful fold", () => {
  const { dir, findings, staging } = setup();
  writeFileSync(
    join(staging, "2026-08-23-cleanup.md"),
    "## 2026-08-23 — [FINDING, P3 Test] gets folded and removed\n\n> **kind:** `FINDING`\n\nbody.\n"
  );
  run(staging, findings);
  const remaining = readdirSync(staging);
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(remaining, [], "staged file should have been removed after folding");
});

test("folds multiple staged files newest-first by filename", () => {
  const { dir, findings, staging } = setup();
  writeFileSync(
    join(staging, "2026-08-22-older.md"),
    "## 2026-08-22 — [FINDING, P2 Test] older staged entry\n\n> **kind:** `FINDING`\n\nbody.\n"
  );
  writeFileSync(
    join(staging, "2026-08-23-newer.md"),
    "## 2026-08-23 — [FINDING, P2 Test] newer staged entry\n\n> **kind:** `FINDING`\n\nbody.\n"
  );
  run(staging, findings);
  const out = readFileSync(findings, "utf8");
  rmSync(dir, { recursive: true, force: true });

  const newerIdx = out.indexOf("## 2026-08-23 — [FINDING, P2 Test] newer");
  const olderIdx = out.indexOf("## 2026-08-22 — [FINDING, P2 Test] older");
  const existingIdx = out.indexOf("## 2026-08-01");
  assert.ok(
    newerIdx < olderIdx && olderIdx < existingIdx,
    "expected newest-staged, then older-staged, then the pre-existing entry, in that order"
  );
});

test("README.md in the staging dir is never treated as a finding", () => {
  const { dir, findings, staging } = setup();
  writeFileSync(join(staging, "README.md"), "not a finding, just the convention doc");
  const out = run(staging, findings);
  const remaining = readdirSync(staging);
  rmSync(dir, { recursive: true, force: true });
  assert.match(out, /No staged findings to fold/);
  assert.deepEqual(remaining, ["README.md"], "README.md must survive a fold run untouched");
});

test("refuses to fold a malformed entry, and does not delete anything", () => {
  const { dir, findings, staging } = setup();
  writeFileSync(join(staging, "2026-08-23-malformed.md"), "not a proper finding heading at all\n");
  assert.throws(() => run(staging, findings), /exit(ed)? with (non-zero|code)|Command failed/i);
  const remaining = readdirSync(staging);
  const untouched = readFileSync(findings, "utf8");
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(remaining, ["2026-08-23-malformed.md"], "a malformed staged file must survive a refused fold");
  assert.doesNotMatch(untouched, /not a proper finding heading/, "FINDINGS.md must stay untouched on refusal");
});

test("normalizes a kind-line-before-heading staged file to FINDINGS.md's heading-first convention", () => {
  // MEASURED 2026-08-28: this is the convention actually in use by the vast majority of real
  // staged findings — kind line first, then a plain '## Title' heading with no date prefix and no
  // bracket tag. The old guard rejected every one of them. Folding must not just ACCEPT this
  // shape — it must reorder to heading-first, or the kind line lands in the WRONG entry once
  // split by findings-hygiene.test.ts's \n(?=## ) boundary.
  const { dir, findings, staging } = setup();
  writeFileSync(
    join(staging, "2026-08-23-kind-first.md"),
    "> **kind:** `FINDING`\n\n## A finding staged kind-first\n\n| **Status** | FIXED |\n"
  );
  run(staging, findings);
  const out = readFileSync(findings, "utf8");
  rmSync(dir, { recursive: true, force: true });

  const headingIdx = out.indexOf("## A finding staged kind-first");
  const kindIdx = out.indexOf("> **kind:** `FINDING`", headingIdx);
  assert.ok(headingIdx > 0, "heading missing from FINDINGS.md");
  assert.ok(kindIdx > headingIdx, "kind line must land AFTER its own heading, not before it");
  // Also confirm it lands in the SAME entry block as the heading — i.e. before the NEXT '## '.
  const nextHeadingIdx = out.indexOf("\n## ", headingIdx + 1);
  assert.ok(nextHeadingIdx === -1 || kindIdx < nextHeadingIdx, "kind line escaped into a later entry");
});

test("a malformed file is skipped without blocking OTHER valid staged files in the same run", () => {
  // MEASURED 2026-08-28: the original all-or-nothing guard meant one bad staged file blocked
  // every other lane's already-correct finding from ever reaching FINDINGS.md — ~60 real files
  // sat un-folded for days because of this. A malformed file must be reported and skipped, not
  // allowed to take the whole batch down with it.
  const { dir, findings, staging } = setup();
  writeFileSync(join(staging, "2026-08-23-malformed.md"), "not a proper finding heading at all\n");
  writeFileSync(
    join(staging, "2026-08-23-valid.md"),
    "> **kind:** `FINDING`\n\n## A perfectly valid finding staged alongside a bad one\n\nbody.\n"
  );
  let out = "";
  try {
    run(staging, findings);
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  const foundText = readFileSync(findings, "utf8");
  const remaining = readdirSync(staging);
  rmSync(dir, { recursive: true, force: true });

  assert.match(
    foundText,
    /## A perfectly valid finding staged alongside a bad one/,
    "the valid file must still be folded even though a sibling file was malformed"
  );
  assert.deepEqual(remaining, ["2026-08-23-malformed.md"], "only the malformed file should survive");
  assert.match(out, /2026-08-23-malformed\.md/, "the malformed file must be named in the output");
});

test("a body using '## ' for its own sub-sections is folded with those sub-sections demoted to '### '", () => {
  // CORRECTED 2026-11-08 (5-engine live monitor sweep): this used to assert the OPPOSITE — that a
  // PR-style body with `## Root cause` / `## Fix` / `## Evidence` sub-sections at the SAME heading
  // level FINDINGS.md reserves for entry boundaries was rejected and left stuck in staging. Live
  // measurement the day this was corrected: 98 of 115 real staged files hit exactly this guard and
  // had been accumulating unfolded since 2026-09-07 — "left for a human pass" had become a silent
  // one-way trap. A staged file documents exactly one finding (the staging convention's own "one
  // file per finding" rule), so a second '## ' line is never a separate finding to split out; it's
  // always a structural sub-section, and FINDINGS.md's own 7000+ already-folded entries already use
  // '### ' for these same section names. Demoting instead of rejecting matches that existing
  // convention and actually unblocks the fold.
  const { dir, findings, staging } = setup();
  writeFileSync(
    join(staging, "2026-08-23-multi-heading.md"),
    "> **kind:** `FINDING`\n\n## The real finding title\n\nSummary.\n\n## Root cause\n\nSomething broke.\n\n## Fix\n\nFixed it.\n"
  );
  run(staging, findings);
  const foundText = readFileSync(findings, "utf8");
  const remaining = readdirSync(staging);
  rmSync(dir, { recursive: true, force: true });

  assert.match(foundText, /## The real finding title/, "the real heading must fold in");
  assert.match(foundText, /### Root cause/, "the sub-section must be demoted to '### ', not dropped");
  assert.match(foundText, /### Fix/, "the second sub-section must also be demoted to '### '");
  assert.doesNotMatch(foundText, /\n## Root cause/, "the demoted sub-section must not still be a '## '-level line");
  assert.deepEqual(remaining, [], "a well-formed multi-section finding must not be left stuck in staging");
});

test("a file titled with a bare '# ' (one hash) folds under its REAL title, not a sub-section", () => {
  // CORRECTED AGAIN, SAME DAY (2026-11-08): the first version of the demote-not-reject fix above
  // only recognized '## Title' as the real heading. Live measurement showed the actual majority
  // convention titles the entry with a bare '# Title' (one hash) — for those files the old fix's
  // `headingIdx` landed on the file's first STRUCTURAL SUB-SECTION instead (the first line
  // starting with literally '## '), silently folding the entry in under a useless title like
  // '## Root cause' while the real descriptive title (the '# ' line) was left as untagged prose
  // glued onto whichever entry preceded it — corruption, not just a missed fold. A dry run caught
  // 17 real entries doing exactly this before it reached `main`. This test pins the fix: the
  // file's first real heading, '#' OR '##', is always the title (normalized to '## '), and every
  // real heading after it is demoted to '### ', regardless of which hash count it started with.
  const { dir, findings, staging } = setup();
  writeFileSync(
    join(staging, "2026-08-23-h1-title.md"),
    "# The real, descriptive finding title\n\n> **kind:** `FINDING`\n\n## Root cause\n\nSomething broke.\n\n## Fix\n\nFixed it.\n"
  );
  run(staging, findings);
  const foundText = readFileSync(findings, "utf8");
  const remaining = readdirSync(staging);
  rmSync(dir, { recursive: true, force: true });

  assert.match(foundText, /## The real, descriptive finding title/, "the REAL title must become the '## ' entry heading");
  assert.doesNotMatch(foundText, /\n## Root cause/, "the sub-section must not usurp the title slot");
  assert.match(foundText, /### Root cause/, "the first sub-section must be demoted to '### '");
  assert.match(foundText, /### Fix/, "the second sub-section must also be demoted to '### '");
  // The kind line must land in the SAME entry as the real title, not glued onto the one before it.
  const titleIdx = foundText.indexOf("## The real, descriptive finding title");
  const kindIdx = foundText.indexOf("> **kind:** `FINDING`", titleIdx);
  assert.ok(titleIdx > 0 && kindIdx > titleIdx, "kind line must follow the real title, in the same entry");
  assert.deepEqual(remaining, [], "a well-formed '# '-titled finding must not be left stuck in staging");
});

test("a kind-first file whose real title lives in a table cell, not a heading, is left in staging", () => {
  // Live repro 2026-11-08, found right after the '# '-vs-'## ' fix: a kind line followed by a
  // `| Field | Value |` table whose own `**Title**` row carries the real title as a cell value —
  // the file's first real heading-shaped line is actually its first structural sub-section
  // (`## What broke`). Guessing that sub-section is the title would silently glue the real title
  // (the table) onto whichever entry precedes it once merged — the same corruption class the
  // '# '-vs-'## ' fix just corrected, via a different shape. This must stay unfolded, not guessed.
  const { dir, findings, staging } = setup();
  writeFileSync(
    join(staging, "2026-08-23-title-in-table.md"),
    "> **kind:** `FINDING`\n\n| Field | Value |\n| --- | --- |\n| **Title** | The real title lives here |\n\n## What broke\n\nSomething broke.\n"
  );
  let out = "";
  try {
    run(staging, findings);
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  const foundText = readFileSync(findings, "utf8");
  const remaining = readdirSync(staging);
  rmSync(dir, { recursive: true, force: true });

  assert.doesNotMatch(foundText, /## What broke/, "a sub-section must not be guessed as the title");
  assert.deepEqual(remaining, ["2026-08-23-title-in-table.md"], "the file must survive, unfolded");
  assert.match(out, /2026-08-23-title-in-table\.md/, "the offending file must be named in the output");
});

test("a '## ' heading inside a fenced code block does not count as a real sub-heading", () => {
  // Live repro 2026-09-17: a finding's Evidence section quoting a live product's own markdown
  // output (a normal, encouraged evidence pattern per this repo's PR write-up policy) inside a
  // ``` fence can legitimately contain real `## `-level headings (e.g. a quoted Ask Largo brief's
  // own "## Why this setup" section) — those must NOT be counted toward the multi-heading guard,
  // or a well-formed, single-real-heading finding is silently skipped forever, indistinguishable
  // from the genuine "body uses ## for its own sub-sections" defect the guard exists to catch.
  const { dir, findings, staging } = setup();
  writeFileSync(
    join(staging, "2026-08-23-quotes-a-heading.md"),
    "> **kind:** `FINDING`\n\n" +
      "## The real finding title\n\n" +
      "Evidence, a live brief excerpt:\n\n" +
      "```\n## Why this setup\nsome quoted content\n## Trade manager read\nmore quoted content\n```\n\n" +
      "Fix rationale.\n"
  );
  run(staging, findings);
  const out = readFileSync(findings, "utf8");
  const remaining = readdirSync(staging);
  rmSync(dir, { recursive: true, force: true });

  assert.match(out, /## The real finding title/, "the finding must fold despite the quoted headings inside its fence");
  assert.match(out, /## Why this setup/, "the quoted evidence content itself must survive, verbatim, inside the fold");
  assert.deepEqual(remaining, [], "a well-formed finding must not be left stuck in staging");
});

test("a real '## ' sub-heading OUTSIDE any fence is demoted, same as a fenced-quote false-positive is spared", () => {
  // Companion to the fence test above — proves the fence-awareness check still only exempts
  // FENCED '## ' lines from demotion/counting; an unfenced second heading still goes through the
  // (now corrected, 2026-11-08) demote-not-reject path rather than being silently left unfolded.
  const { dir, findings, staging } = setup();
  writeFileSync(
    join(staging, "2026-08-23-real-multi-heading.md"),
    "> **kind:** `FINDING`\n\n## The real finding title\n\n## Root cause\n\nSomething broke.\n"
  );
  run(staging, findings);
  const foundText = readFileSync(findings, "utf8");
  const remaining = readdirSync(staging);
  rmSync(dir, { recursive: true, force: true });

  assert.match(foundText, /## The real finding title/, "the real heading must fold in");
  assert.match(foundText, /### Root cause/, "the unfenced second heading must be demoted, not dropped");
  assert.deepEqual(remaining, [], "the file must not be left stuck in staging");
});

test("a clean staging directory is a no-op", () => {
  const { dir, findings, staging } = setup();
  const before = readFileSync(findings, "utf8");
  const out = run(staging, findings);
  const after = readFileSync(findings, "utf8");
  rmSync(dir, { recursive: true, force: true });
  assert.match(out, /No staged findings to fold/);
  assert.equal(after, before, "FINDINGS.md must be byte-identical when nothing is staged");
});
