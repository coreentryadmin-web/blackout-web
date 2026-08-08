import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  // Entries left UNRECONCILED by the 2026-08-08 pass each need checking against the code and
  // restamping. This pins the ceiling so the number can only go DOWN as they are worked off. A new
  // entry should ship with a real status, never as UNRECONCILED.
  //
  // Tighten this number whenever entries are genuinely resolved — a ratchet that is never lowered
  // is just a high-water mark. It has moved twice, both times downward and for a stated reason:
  //   273 -> 240  the reconciler read the outcome only from a `| **Status** |` row, missing the 34
  //               entries that record it in the heading (`## ... — FIXED`). A miscount, not work.
  //   240 -> 194  the 50 mid-flight "PR pending → CI → auto-merge" statuses were resolved against
  //               the tree by scripts/audit/findings-verify-stale.mjs, and the 10 batched SEO
  //               entries all shipped with a real outcome. Real work, real evidence.
  //   194 -> 129  65 entries cited a PR the GitHub API confirms is MERGED, resolved by
  //               scripts/audit/findings-resolve-prs.mjs. Each stamp names the PR and merge SHA.
  //   129 -> 71   76 entries record their outcome as PROSE (`**Status.** FIXED on …`), a third
  //               format statusOf() did not read. A reader bug, not a backlog.
  //    71 -> 59   findings-verify-stale.mjs learned that same prose format, exposing 18 more
  //               mid-flight statuses; 12 named a fix symbol that is present in the tree today and
  //               were restamped with it. The other 6 name no symbol and were left alone.
  //    59 -> 43   the heading reader was END-ANCHORED (`— FIXED$`), so a heading that QUALIFIES its
  //               outcome — `— FIXED (deploys AFTER close)`, `(P2, FIXED — full SPX audit)`,
  //               `RULED OUT on all six desk routes` — read as no outcome at all. 14 entries. The
  //               15th, `— FIXED (draft PR, HOLD)`, is deliberately NOT auto-read (see
  //               HEADING_NOT_AN_OUTCOME) and was stamped by hand against the tree.
  // Raising it to accommodate a new unreconciled entry is not one of the options.
  const n = (readFileSync(FINDINGS, "utf8").match(/`UNRECONCILED`/g) ?? []).length;
  assert.ok(
    n <= 43,
    `UNRECONCILED count rose to ${n} (ceiling 43) — new entries must carry a real status, not UNRECONCILED`
  );
});

test("a qualified heading outcome is read, a NEGATED one is not", () => {
  // The heading reader used to be end-anchored, which read `— FIXED` but not `— FIXED (why)`. The
  // anchor was also, by accident, the only thing keeping `[P1, NOT FIXED …]` from reading as FIXED.
  // Dropping it without HEADING_NOT_AN_OUTCOME would stamp a live P1 as resolved — the one failure
  // mode of this whole file that actually costs something. Pinned here so it cannot be re-broken.
  const cases: [string, boolean][] = [
    ["2026-01-01 — [P2] plain outcome — FIXED", false],
    ["2026-01-02 — [P2] parenthesised qualifier — FIXED (`x` deliberately NOT added)", false],
    ["2026-01-03 — [P2] inline tag form (P2, FIXED — full audit)", false],
    ["2026-01-04 — [P2] trailing prose RULED OUT on all six desk routes", false],
    ["2026-01-05 — [P1, NOT FIXED — flagged, architecturally significant] still open", true],
    ["2026-01-06 — [HIGH] shipped behind a hold — FIXED (draft PR, HOLD)", true],
    ["2026-01-07 — [P2] no outcome word at all", true],
  ];

  const dir = mkdtempSync(join(tmpdir(), "findings-heading-"));
  const f = join(dir, "FINDINGS.md");
  writeFileSync(f, cases.map(([h]) => `## ${h}\n\nSome body text describing the issue.\n`).join("\n"));
  execFileSync("node", ["scripts/audit/findings-reconcile.mjs", "--apply"], {
    env: { ...process.env, FINDINGS_RECONCILE_FINDINGS: f, FINDINGS_RECONCILE_RUNLOG: join(dir, "RUN-LOG.md") },
    encoding: "utf8",
  });
  const out = readFileSync(f, "utf8");
  rmSync(dir, { recursive: true, force: true });

  const blocks = out.split(/\n(?=## )/).filter((b) => b.startsWith("## ") && !/^## How to read/.test(b));
  const got = blocks.map((b) => [b.split("\n")[0].slice(3), /`UNRECONCILED`/.test(b)] as [string, boolean]);
  assert.deepEqual(got, cases, "a heading's outcome was read (or missed) differently than intended");
});

test("the reconciler is idempotent — a second --apply is a no-op", () => {
  // Not cosmetic. Two separate bugs made a second --apply corrupt the file: the injected tag lines
  // pushed content out of the classifier's 1500-char window (silently reclassifying entries it had
  // already tagged), and a .filter(Boolean) ate each block's trailing blank line, so every run
  // erased one separator until adjacent entries welded into a single line.
  //
  // Run against an UNTAGGED fixture, not the live file. The live FINDINGS.md is already tagged, so
  // the "already tagged" early return short-circuits the tagging path entirely and the test passes
  // even with the corruption restored — verified by reintroducing the bug.
  // Synthesize an untagged input from the REAL file by stripping the annotations this script adds.
  // A small hand-written fixture is not enough: the original corruption only reproduced at the real
  // file's scale and content (1500-char classifier window, the legend block, 335 entries). Mutation
  // -testing a toy fixture showed it passing against every one of the bugs this test exists to
  // catch — so the input has to be the real thing.
  const dir = mkdtempSync(join(tmpdir(), "findings-reconcile-"));
  const f = join(dir, "FINDINGS.md");
  const r = join(dir, "RUN-LOG.md");
  const untagged = readFileSync(FINDINGS, "utf8").replace(/^> \*\*(kind|status):\*\*.*\n/gm, "");
  writeFileSync(f, untagged);
  const env = { ...process.env, FINDINGS_RECONCILE_FINDINGS: f, FINDINGS_RECONCILE_RUNLOG: r };
  const run = () => execFileSync("node", ["scripts/audit/findings-reconcile.mjs", "--apply"], { env, encoding: "utf8" });

  const report1 = run();
  const pass1 = readFileSync(f, "utf8");
  const report2 = run();
  const pass2 = readFileSync(f, "utf8");
  rmSync(dir, { recursive: true, force: true });

  // Guard against a vacuous pass: the input must really have been untagged and really got tagged.
  assert.ok(!/> \*\*kind:\*\*/.test(untagged), "stripping failed — the fixture was already tagged, so nothing was exercised");
  assert.match(pass1, /> \*\*kind:\*\* `FINDING`/, "the reconciler did not tag the fixture");
  assert.match(pass1, /## How to read this file/, "the legend was dropped from the output");
  // Regenerating from scratch must reproduce the committed file's count. This is what covers the
  // heading-outcome rule: drop it and 34 entries whose fix is cited in their own body get flagged
  // as open work again, and this number jumps to 274.
  assert.equal(
    (pass1.match(/`UNRECONCILED`/g) ?? []).length,
    (readFileSync(FINDINGS, "utf8").match(/`UNRECONCILED`/g) ?? []).length,
    "regenerating FINDINGS.md from scratch produces a different UNRECONCILED count than the committed file"
  );
  assert.equal(pass2, pass1, "findings-reconcile.mjs --apply is not a fixed point — a re-run rewrote the file");

  // The REPORT must be stable too, not just the file. The classifier reads a 1500-char window, and
  // the tag lines it injects push real content out of that window — so a re-run reclassified
  // already-tagged entries (one NEGATIVE-RESULT became a FINDING). The file hid it, because tagged
  // blocks are passed through untouched; only the printed distribution moved. An audit tool that
  // reports a different answer each time it is run on the same data is worse than no tool.
  const distribution = (out: string) => out.slice(0, out.indexOf("APPLIED")).trim();
  assert.equal(
    distribution(report2),
    distribution(report1),
    "the reported classification changed between two runs over identical data"
  );
});
