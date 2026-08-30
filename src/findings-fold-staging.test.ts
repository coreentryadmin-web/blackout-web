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

test("a body using '## ' for its own sub-sections is skipped, not fragmented into fake entries", () => {
  // MEASURED 2026-08-28: 10 of 109 real staged files write a PR-style body with `## Root cause` /
  // `## Fix` / `## Evidence` sub-sections at the SAME heading level FINDINGS.md reserves for
  // entry boundaries. entries()/splitEntries() split on every '## ' line, so folding one of these
  // in raw fragments a single finding into several headless sub-"entries" that fail "every entry
  // declares a kind" (the real kind tag only follows the file's own first heading).
  const { dir, findings, staging } = setup();
  writeFileSync(
    join(staging, "2026-08-23-multi-heading.md"),
    "> **kind:** `FINDING`\n\n## The real finding title\n\nSummary.\n\n## Root cause\n\nSomething broke.\n\n## Fix\n\nFixed it.\n"
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

  assert.doesNotMatch(foundText, /## The real finding title/, "a multi-heading file must not be folded in raw");
  assert.deepEqual(remaining, ["2026-08-23-multi-heading.md"], "the multi-heading file must survive, unfolded");
  assert.match(out, /2026-08-23-multi-heading\.md/, "the offending file must be named in the output");
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
