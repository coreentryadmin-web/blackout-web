import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildExpectedVsRealized } from "./meridian-analytics-core";

const root = process.cwd();
const ENRICH = readFileSync(join(root, "src/lib/meridian/meridian-earnings-enrich.ts"), "utf8");
const LOAD = readFileSync(join(root, "src/lib/meridian/meridian-earnings-event-load.ts"), "utf8");
const TABS = readFileSync(
  join(root, "src/features/meridian/components/MeridianEarningsTabs.tsx"),
  "utf8"
);

/**
 * TWO SIDES THAT DESCRIBED DIFFERENT EVENTS. Both live on prod 2026-08-21 22:19Z.
 *
 *   SMTC  print 2026-08-25, four days AHEAD
 *         "Realized -4.41% vs ~25.6% implied (0.17x)"  verdict: under
 *         25.6% is the UPCOMING print; -4.41% is 2026-05-26, a different quarter.
 *
 *   BJ    printed that morning
 *         "Realized +2.6% vs ~0.2% implied (13x)"      verdict: over
 *         0.2% is a live post-print quote from an expiry that died that afternoon.
 *         Against BJ's real pre-print implied, 2.6% is UNDER — the verdict is inverted.
 */
describe("the exact live cases no longer produce a verdict", () => {
  test("SMTC — next week's implied against last quarter's reaction", () => {
    const out = buildExpectedVsRealized(25.6, -4.41, false);
    assert.equal(out.ratio, null, "no ratio across two different prints");
    assert.equal(out.verdict, "unknown");
    assert.equal(out.realized_move_pct, -4.41, "the reaction is real and still published");
    assert.match(out.headline!, /Last print realized -4\.41%/);
    assert.equal(out.headline!.includes("implied"), false, "the two numbers must not sit side by side");
    assert.equal(out.headline!.includes("×"), false);
  });

  test("BJ — a post-print live quote, which used to invert the verdict", () => {
    const out = buildExpectedVsRealized(0.2, 2.6, false);
    assert.equal(out.ratio, null);
    assert.notEqual(out.verdict, "over", "13x 'over' was the defect");
    assert.equal(out.verdict, "unknown");
    assert.match(out.headline!, /Last print realized \+2\.6%/);
  });

  test("the ratio and verdict still work when the two sides DO describe one print", () => {
    // Not disabled — gated. A pre-print implied compared to that print's reaction is the whole
    // point of the card, and it must keep working the moment the data exists.
    const over = buildExpectedVsRealized(4, 8, true);
    assert.equal(over.ratio, 2);
    assert.equal(over.verdict, "over");
    assert.match(over.headline!, /Realized \+8% vs ~4% implied \(2×\)/);
    assert.equal(buildExpectedVsRealized(8, 2, true).verdict, "under");
    assert.equal(buildExpectedVsRealized(8, 8, true).verdict, "inline");
  });

  test("a missing side is still unknown regardless of the flag", () => {
    for (const same of [true, false]) {
      assert.equal(buildExpectedVsRealized(null, 3, same).verdict, "unknown");
      assert.equal(buildExpectedVsRealized(3, null, same).verdict, "unknown");
    }
    // Same-print with no implied has nothing to compare AND nothing to attribute, so it says
    // nothing. Cross-event with no implied still holds a real reaction — see the deliberate
    // behaviour change below.
    assert.equal(buildExpectedVsRealized(null, 3, true).headline, null);
    assert.match(buildExpectedVsRealized(null, 3, false).headline!, /Last print realized \+3%/);
  });

  test("sign is preserved on the realized-only headline — direction is the read", () => {
    assert.match(buildExpectedVsRealized(1, -0.5, false).headline!, /realized -0\.5%/);
    assert.match(buildExpectedVsRealized(1, 0.5, false).headline!, /realized \+0\.5%/);
  });
});

describe("a cross-event block does not CARRY the implied it must not be paired with", () => {
  test("expected_move_pct is dropped, not passed through", () => {
    // Withholding the ratio was not enough. The banner rebuilt the pairing from a forward implied,
    // so the number itself has to go: PDD shipped "Last print realized -2.35%" (2026-05-27) above
    // "Implied ~9.2% into print" (into 2026-08-24).
    const out = buildExpectedVsRealized(9.2, -2.35, false);
    assert.equal(out.expected_move_pct, null, "9.2 belongs to a different print");
    assert.equal(out.same_event, false);
    assert.equal(out.realized_move_pct, -2.35, "the reaction survives — it is a real measurement");
  });

  test("a same-print block keeps its implied and says so", () => {
    const out = buildExpectedVsRealized(5, 4.5, true);
    assert.equal(out.expected_move_pct, 5);
    assert.equal(out.same_event, true);
    assert.equal(out.ratio, 0.9);
  });

  test("same_event is set on every branch, including the missing-side one", () => {
    assert.equal(buildExpectedVsRealized(null, 3, true).same_event, true);
    assert.equal(buildExpectedVsRealized(3, null, true).same_event, true);
    assert.equal(buildExpectedVsRealized(null, null, false).same_event, false);
  });

  test("cross-event with NO implied on either side still publishes the reaction", () => {
    // BEHAVIOUR CHANGE, deliberate. This previously returned headline null, because the
    // missing-implied guard ran first — so XPEV/DKS/SMTC showed nothing at all despite holding a
    // settled, sourced reaction. The reaction does not need an implied to be true.
    const out = buildExpectedVsRealized(null, -1.56, false);
    assert.equal(out.expected_move_pct, null);
    assert.match(out.headline!, /Last print realized -1\.56%/);
  });

  test("cross-event with no reaction has nothing to say", () => {
    assert.equal(buildExpectedVsRealized(9.2, null, false).headline, null);
  });
});

describe("no path feeds the pack's FORWARD implied into this block", () => {
  test("the enrichment builder passes the print's own captured implied, alone", () => {
    assert.match(ENRICH, /const priorImplied = lastPrint\?\.expected_move_pct \?\? null;/);
    assert.equal(
      /priorImplied \?\? expectedMovePct/.test(ENRICH),
      false,
      "the pack's forward move must not be a fallback for a per-print implied"
    );
    assert.match(ENRICH, /priorImplied != null/);
  });

  test("the realized side is the REACTION, not the anchor session alone", () => {
    // A post-close print reprices on the next session. INTU's last print reads -1.67% by session
    // and -20.02% by reaction; the enrichment path served the -1.67% whenever the patch path
    // early-returned for want of a chain-IV move.
    assert.match(ENRICH, /lastPrint\?\.reaction_pct \?\? lastPrint\?\.session_change_pct \?\? null/);
  });

  test("the no-op patch that took pack.expected_move_pct is gone", () => {
    assert.equal(LOAD.includes("patchMeridianEnrichmentExpectedMove"), false);
    assert.equal(LOAD.includes("meridian-earnings-event-load-core"), false);
  });

  test("the banner reads its sub-line from the block, never from the pack", () => {
    const banner = TABS.slice(TABS.indexOf("expected_vs_realized?.headline"));
    const block = banner.slice(0, banner.indexOf("analyst_revisions"));
    assert.equal(
      /sub=\{[\s\S]*?pack\.expected_move_pct/.test(block),
      false,
      "pack.expected_move_pct is the UPCOMING print's implied — it cannot sub a last-print headline"
    );
    assert.match(block, /same_event\s*\?\s*"Expected vs realized"\s*:\s*"Last print reaction"/);
  });

  test("the flag is REQUIRED — a forgotten argument cannot silently re-enable the defect", () => {
    const CORE = readFileSync(join(root, "src/lib/meridian/meridian-analytics-core.ts"), "utf8");
    assert.match(CORE, /sameEvent: boolean\n\): ExpectedVsRealized/);
    assert.equal(/sameEvent: boolean = /.test(CORE), false, "no default value");
    assert.equal(/sameEvent\?: boolean/.test(CORE), false, "not optional");
  });
});
