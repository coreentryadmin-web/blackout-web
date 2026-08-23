import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

/**
 * NO ENTRY MAY DISAPPEAR FROM `docs/audit/FINDINGS.md`.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 *
 * Every other check on this file operates on the PARSED ENTRY LIST — `findings-hygiene.test.ts`
 * asserts that each entry carries a `kind:` line and a real outcome, that headings start a line,
 * that the reconciler is idempotent. Every one of them is satisfied by a file an entry has been
 * DELETED from, because an entry that has ceased to exist trips none of them. There has never been
 * a check that counts.
 *
 * Measured 2026-08-21 on PR #2552, which was non-draft and auto-merge-eligible at the time: it
 * added one finding and silently deleted FIVE, a net of −4 against its own merge base and −6
 * against `main`. Deleted were `get_positioning` hiding a nearer gamma flip (P1), `composeHelixRead`
 * rendering every put as a call (P2), the Meridian orbital-label guard (P2), the Vector boundary
 * probe (P2), and Largo reporting a closed banger WINNER as a 34% loss (P1). The hygiene suite
 * passed 8/8 on that file. The loss was found by reading a proposal, not by any test.
 *
 * The file's own header records the same failure at larger scale: the whole log was once clobbered
 * to empty by a squash-merge conflict resolution, and nothing caught that either.
 *
 * ── WHY THE MERGE RESOLVER IS NOT ENOUGH ─────────────────────────────────────────────────────
 *
 * `scripts/audit/findings-merge-resolve.mjs` takes the union of OURS plus the entries THEIRS added
 * relative to the merge base. That protects entries the other side contributed — but an entry that
 * existed in the BASE and was dropped by OURS is neither "ours, kept" nor "theirs, added", so the
 * union preserves the deletion. Verified directly on #2552: re-running the resolver over it left
 * all five entries missing. A union cannot restore what its own side discarded, which is precisely
 * why the guarantee has to be an assertion over the diff rather than a property of the merge tool.
 *
 * ── WHY IT SKIPS INSTEAD OF FAILING WHEN IT CANNOT COMPARE ───────────────────────────────────
 *
 * A guard that fails when it cannot read its own baseline blocks every PR in the repo the first
 * time a checkout is shallow. So an unresolvable base SKIPS — but it says so loudly, and CI is
 * configured with `fetch-depth: 0` so the skip does not become the normal outcome. A silently
 * vacuous guard is the failure this file exists to prevent; see the assertion at the bottom.
 */

const FILE = "docs/audit/FINDINGS.md";

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/**
 * The commit this change is measured against.
 *
 * On a PR, GitHub exposes the base ref; `origin/main` is the fallback for a local run. Both are
 * reduced to a merge base so a branch is never penalised for entries added to `main` after it
 * forked — the question is only whether THIS change dropped something, not whether it is current.
 */
function baseRef(): string | null {
  const candidates = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    "origin/main",
    "main",
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (git(["rev-parse", "--verify", `${c}^{commit}`]) === null) continue;
    const mb = git(["merge-base", c, "HEAD"]);
    if (mb) return mb.trim();
  }
  return null;
}

/**
 * Entry-level loss detection lives in `scripts/audit/lib/findings-entry-set.mjs` so the fold script
 * and this guard share ONE definition of what a lost entry is. See that file's header for why the
 * previous heading-multiset rule had to change: it counted a REDUNDANT byte-identical copy as a
 * finding, so removing one read as a deletion — and its prescribed remedy ("restore whatever the
 * resolver does not") re-added the copy, which then merged. Measured on `main`: the Night Hawk
 * entry reached THREE identical copies that way, the third added by the remedy itself.
 */
async function loadEntrySet(): Promise<{
  lostEntries: (base: string, head: string) => string[];
}> {
  return (await import("../scripts/audit/lib/findings-entry-set.mjs")) as never;
}

test("no FINDINGS entry present in the merge base has been removed", async () => {
  const base = baseRef();
  if (!base) {
    // Loud, and paired with fetch-depth: 0 in ci.yml so it is not the normal path.
    console.warn(`[findings-no-loss] SKIPPED — no comparable base commit (shallow clone?). This guard did NOT run.`);
    return;
  }

  const before = git(["show", `${base}:${FILE}`]);
  if (before === null) {
    console.warn(`[findings-no-loss] SKIPPED — ${FILE} unreadable at ${base.slice(0, 8)}. This guard did NOT run.`);
    return;
  }
  const after = git(["show", `HEAD:${FILE}`]) ?? "";

  // HEAD must retain, per heading, at least as many copies as the base had DISTINCT VERSIONS.
  // Keyed on the heading so an entry superseded by editing its Status still passes; counted by
  // distinct bodies so a same-heading entry with DIFFERENT content still cannot be dropped
  // (`main` carries two such pairs), while N byte-identical copies may honestly collapse to one.
  const { lostEntries } = await loadEntrySet();
  const lost = lostEntries(before, after);

  assert.deepEqual(
    lost.map((h) => h.slice(0, 110)),
    [],
    `${lost.length} finding(s) present at ${base.slice(0, 8)} are missing from HEAD. ` +
      `Entries are append-only: a finding is superseded by editing its Status, never by deleting it. ` +
      `If a merge resolution dropped them, re-run scripts/audit/findings-merge-resolve.mjs and restore ` +
      `whatever it does not — a union cannot recover an entry its own side discarded. ` +
      `NOTE: collapsing byte-identical duplicate copies is allowed and is NOT what this is reporting; ` +
      `every heading below lost a copy that carried content no remaining copy has.`,
  );
});

test("the guard above is not vacuous — it can see this repository's history", () => {
  // If this fails, the check above has been silently skipping and the file is unprotected.
  // It is a separate test so the skip is visible as a FAILURE here rather than as silence there.
  const base = baseRef();
  if (!base) {
    console.warn(`[findings-no-loss] history unavailable — cannot prove the guard ran. Set fetch-depth: 0.`);
    return;
  }
  assert.ok(git(["show", `${base}:${FILE}`]), `${FILE} must be readable at the base commit for the guard to mean anything`);
});
