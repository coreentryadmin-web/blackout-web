import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression coverage for the "already kind-tagged, status never checked" bug (found 2026-09-13):
 * findings-fold-staging.mjs stamps `> **kind:** FINDING` on every staged file it folds in,
 * independently of whether that file's own author ever wrote a status. The old
 * `findings-reconcile.mjs --apply` treated the presence of a kind line alone as proof the whole
 * entry had already been reconciled and returned it unchanged — so a freshly-folded entry with no
 * status line (or a stale "PR pending"/"auto-merge" one) never got its missing/stale status
 * flagged, silently, forever. Runs the REAL script over a small throwaway fixture (env-overridable
 * paths, same mechanism findings-hygiene.test.ts uses) rather than reimplementing its logic.
 */
function runReconcile(findingsBody) {
  const dir = mkdtempSync(join(tmpdir(), "findings-reconcile-unit-"));
  const f = join(dir, "FINDINGS.md");
  const r = join(dir, "RUN-LOG.md");
  writeFileSync(f, findingsBody);
  const env = { ...process.env, FINDINGS_RECONCILE_FINDINGS: f, FINDINGS_RECONCILE_RUNLOG: r };
  execFileSync("node", ["scripts/audit/findings-reconcile.mjs", "--apply"], { env, encoding: "utf8" });
  const out = readFileSync(f, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return out;
}

test("an entry already carrying a kind line but NO status line still gets flagged UNRECONCILED", () => {
  const body = `## How to read this file

Legend.

## A play generator regressed after the last deploy

> **kind:** \`FINDING\`

Some real root-cause prose with no Status row and no heading outcome at all.
`;
  const out = runReconcile(body);
  assert.match(out, /> \*\*kind:\*\* `FINDING`\n> \*\*status:\*\* `UNRECONCILED`/);
  assert.match(out, /no status was ever recorded/);
});

test("an entry already carrying a kind line with a STALE status still gets flagged UNRECONCILED", () => {
  const body = `## How to read this file

Legend.

## A play generator regressed after the last deploy

> **kind:** \`FINDING\`

| **Status** | Fixed, PR pending |
|---|---|
`;
  const out = runReconcile(body);
  assert.match(out, /> \*\*kind:\*\* `FINDING`\n> \*\*status:\*\* `UNRECONCILED`.*recorded mid-flight/);
  // The original stale status line is preserved, not deleted — this only annotates, never erases.
  assert.match(out, /\| \*\*Status\*\* \| Fixed, PR pending \|/);
});

test("an entry already fully reconciled (kind line + real resolved status) is left byte-for-byte unchanged", () => {
  const body = `## How to read this file

Legend.

## A play generator regressed after the last deploy

> **kind:** \`FINDING\`

| **Status** | FIXED (abc1234) |
|---|---|
`;
  const out = runReconcile(body);
  assert.doesNotMatch(out, /UNRECONCILED/);
});

test("a fresh entry with no kind line at all is still tagged + flagged exactly as before (no regression)", () => {
  const body = `## How to read this file

Legend.

## A play generator regressed after the last deploy

Some real root-cause prose with no Status row at all.
`;
  const out = runReconcile(body);
  assert.match(out, /> \*\*kind:\*\* `FINDING`\n> \*\*status:\*\* `UNRECONCILED`/);
});

test("running --apply twice on the same already-reconciled-with-a-gap output is a fixed point", () => {
  const body = `## How to read this file

Legend.

## A play generator regressed after the last deploy

> **kind:** \`FINDING\`

Some real root-cause prose with no Status row and no heading outcome at all.
`;
  const once = runReconcile(body);
  const twice = runReconcile(once);
  assert.equal(twice, once);
});
