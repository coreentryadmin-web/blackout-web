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

test("a clean staging directory is a no-op", () => {
  const { dir, findings, staging } = setup();
  const before = readFileSync(findings, "utf8");
  const out = run(staging, findings);
  const after = readFileSync(findings, "utf8");
  rmSync(dir, { recursive: true, force: true });
  assert.match(out, /No staged findings to fold/);
  assert.equal(after, before, "FINDINGS.md must be byte-identical when nothing is staged");
});
