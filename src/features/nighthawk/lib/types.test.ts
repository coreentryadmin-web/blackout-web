import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Source-scan convention matches nighthawk-pinning-contract.test.ts / db.test.ts /
// play-status-contract.test.ts: these raw-source-text assertions exist because the thing being
// pinned (a doc comment's prose dollar figure vs. an exported numeric constant) has no runtime
// behavior of its own to exercise — the only way to catch drift is to read both files' text.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("PlaybookPlay.entry_premium doc comment's dollar cap matches MAX_OPTION_PREMIUM_PER_SHARE", () => {
  // Regression for the exact drift class FINDINGS.md already recorded once (2026-10-24,
  // scripts/full-site-deep-audit.mjs's own stale `entry_premium > 20` literal) — that fix only
  // pinned the audit script against the constant, never this doc comment, so the type's TSDoc
  // kept quoting the pre-PR-N15 $20 cap for weeks after the real enforced ceiling was
  // deliberately raised to $35 (constants.ts: "Raised from $20 to $35 (PR-N15): the $20 cap
  // blocked every ATM option on stocks above ~$250, silently eliminating the strongest
  // institutional-flow names from the playbook"). Live confirmation the $35 cap is what's
  // actually enforced: GET /api/market/nighthawk/edition?date=2026-11-04 served a TLN play with
  // entry_premium:22.6, premium_cap_ok:true (22.6 > $20, <= $35) — proving this was purely a
  // stale doc comment, never a live enforcement defect.
  //
  // This test extracts the dollar figure quoted in each source directly via regex (never a
  // hand-copied literal on either side) so a FUTURE re-raise of the cap (e.g. $35 -> $50) fails
  // this test the moment constants.ts changes, until the doc comment is updated to match —
  // closing the recurring drift class, not just this one instance.
  const constantsSrc = read("src/features/nighthawk/lib/constants.ts");
  const constantMatch = constantsSrc.match(
    /export const MAX_OPTION_PREMIUM_PER_SHARE = (\d+);/
  );
  assert.ok(constantMatch, "MAX_OPTION_PREMIUM_PER_SHARE constant not found in constants.ts");
  const liveCapDollars = Number(constantMatch![1]);

  const typesSrc = read("src/features/nighthawk/lib/types.ts");
  const docCommentMatch = typesSrc.match(
    /\/\*\* Per-share option entry premium \(must be ≤ \$(\d+)[^)]*\)\.[\s\S]*?\*\/\s*\n\s*entry_premium\?: number;/
  );
  assert.ok(
    docCommentMatch,
    "PlaybookPlay.entry_premium doc comment not found in the expected shape in types.ts"
  );
  const docCommentDollars = Number(docCommentMatch![1]);

  assert.equal(
    docCommentDollars,
    liveCapDollars,
    `types.ts's entry_premium doc comment says $${docCommentDollars}, but the live enforced ` +
      `cap (constants.ts MAX_OPTION_PREMIUM_PER_SHARE) is $${liveCapDollars} — update the doc ` +
      `comment to match whenever the constant changes`
  );
});
