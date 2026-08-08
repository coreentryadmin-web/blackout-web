import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Keeps FINDINGS.md answerable.
 *
 * It reached 351 entries / 1.1MB with 240 carrying no status at all — routine pass logs, negative
 * results and real findings all under identical formatting. While an open P1 is indistinguishable
 * from a finished chore, real findings sit: the BREAKOUT ranker measuring worse than random waited
 * a day for a decision while smaller work shipped around it.
 *
 * Reconciled 2026-08-08 by scripts/audit/findings-reconcile.mjs. These tests stop it rotting again.
 */

const FINDINGS = "docs/audit/FINDINGS.md";
const KINDS = ["FINDING", "NEGATIVE-RESULT", "OPS-NOTE"];

function entries(): { head: string; body: string }[] {
  const src = readFileSync(FINDINGS, "utf8");
  return src
    .split(/\n(?=## )/)
    .filter((b) => b.startsWith("## ") && !/^## How to read this file/.test(b))
    .map((b) => ({ head: b.split("\n")[0], body: b }));
}

test("every entry declares a kind", () => {
  const missing = entries().filter((e) => !/> \*\*kind:\*\* `[A-Z-]+`/.test(e.body));
  assert.deepEqual(
    missing.map((e) => e.head.slice(0, 90)),
    [],
    "entries without a kind tag — add one, or run scripts/audit/findings-reconcile.mjs"
  );
});

test("every declared kind is one of the known kinds", () => {
  const bad: string[] = [];
  for (const e of entries()) {
    const m = e.body.match(/> \*\*kind:\*\* `([A-Z-]+)`/);
    if (m && !KINDS.includes(m[1])) bad.push(`${m[1]} — ${e.head.slice(0, 70)}`);
  }
  assert.deepEqual(bad, [], `unknown kinds (allowed: ${KINDS.join(", ")})`);
});

test("routine pass logs do not live in FINDINGS.md", () => {
  // They belong in RUN-LOG.md. Mixing them back in is what made the file unreadable, and
  // CLAUDE.md already forbids docs-only PRs for GREEN audit logs.
  const leaked = entries().filter((e) => /all validators GREEN|Post-close fix agent/i.test(e.head));
  assert.deepEqual(
    leaked.map((e) => e.head.slice(0, 90)),
    [],
    "pass logs belong in docs/audit/RUN-LOG.md"
  );
});

test("the UNRECONCILED backlog is not silently growing", () => {
  // 273 entries were left UNRECONCILED by the 2026-08-08 pass — each needs checking against git
  // history and restamping. This pins the ceiling so the number can only go DOWN as they're
  // worked off. A new entry should ship with a real status, never as UNRECONCILED.
  const n = (readFileSync(FINDINGS, "utf8").match(/`UNRECONCILED`/g) ?? []).length;
  assert.ok(
    n <= 273,
    `UNRECONCILED count rose to ${n} (ceiling 273) — new entries must carry a real status, not UNRECONCILED`
  );
});
