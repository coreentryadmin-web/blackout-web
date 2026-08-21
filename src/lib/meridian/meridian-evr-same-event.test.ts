import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildExpectedVsRealized } from "./meridian-analytics-core";

const root = process.cwd();
const ENRICH = readFileSync(join(root, "src/lib/meridian/meridian-earnings-enrich.ts"), "utf8");
const PATCH = readFileSync(join(root, "src/lib/meridian/meridian-earnings-event-load-core.ts"), "utf8");

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
      assert.equal(buildExpectedVsRealized(null, 3, same).headline, null);
    }
  });

  test("sign is preserved on the realized-only headline — direction is the read", () => {
    assert.match(buildExpectedVsRealized(1, -0.5, false).headline!, /realized -0\.5%/);
    assert.match(buildExpectedVsRealized(1, 0.5, false).headline!, /realized \+0\.5%/);
  });
});

describe("both call sites pass the pre-print implied, or say they do not have it", () => {
  test("the enrichment builder prefers the print's OWN captured implied", () => {
    assert.match(ENRICH, /const priorImplied = lastPrint\?\.expected_move_pct \?\? null;/);
    assert.match(ENRICH, /priorImplied \?\? expectedMovePct \?\? null,[\s\S]{0,80}priorImplied != null/);
  });

  test("the patch path does the same", () => {
    assert.match(PATCH, /const priorImplied = lastPrint\?\.expected_move_pct \?\? null;/);
    assert.match(PATCH, /priorImplied != null/);
  });

  test("neither call site passes a bare live quote any more", () => {
    assert.equal(
      ENRICH.includes("buildExpectedVsRealized(\n    expectedMovePct ?? null,"),
      false,
      "today's live chain IV must not be the denominator on its own"
    );
  });

  test("the flag is REQUIRED — a forgotten argument cannot silently re-enable the defect", () => {
    const CORE = readFileSync(join(root, "src/lib/meridian/meridian-analytics-core.ts"), "utf8");
    assert.match(CORE, /sameEvent: boolean\n\): ExpectedVsRealized/);
    assert.equal(/sameEvent: boolean = /.test(CORE), false, "no default value");
    assert.equal(/sameEvent\?: boolean/.test(CORE), false, "not optional");
  });
});
