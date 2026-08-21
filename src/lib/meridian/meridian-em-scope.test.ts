import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expiryCoversPrint } from "./meridian-em-scope";
import { computeExpectedMove } from "@/features/vector/lib/vector-expected-move";

const INTEL = readFileSync(
  join(process.cwd(), "src/lib/meridian/meridian-earnings-intel.ts"),
  "utf8"
);

/**
 * A HEADLINE NUMBER WRONG BY ~90x, LABELLED `chain_iv`.
 *
 * MEASURED ON PROD 2026-08-21 21:50Z. PDD, printing 2026-08-24:
 *   served    expected_move_pct 0.1   expected_move_source "chain_iv"
 *   truth     ATM straddle 3.50 + 3.24 = 6.74 on spot 88.53  ->  7.6%
 *             (2026-08-28 chain, the expiry that covers the print; ATM IV 0.61-0.75)
 * Seven of eight high-impact names sampled read 0.1-0.4%.
 */
describe("the dead-expiry arithmetic, reproduced from the shipping engine", () => {
  const SPOT = 88.53;
  const ATM_IV = 0.66;
  const DAYS = 365;
  // The same floor `remainingYearsToExpiry` applies: a dead expiry keeps one minute of life
  // instead of being dropped. That is what converts "no answer" into "0.1%".
  const FLOOR_YEARS = 1 / (365 * 24 * 60);

  test("today's already-expired series reproduces the served 0.1 exactly", () => {
    const em = computeExpectedMove({ spot: SPOT, atmIv: ATM_IV, dteDays: FLOOR_YEARS * DAYS });
    assert.ok(em);
    assert.equal(Number((em!.movePct * 100).toFixed(1)), 0.1, "this is the number prod served");
  });

  test("the expiry that covers the print gives a plausible earnings move instead", () => {
    const dteDays = ((Date.parse("2026-08-28T20:00:00Z") - Date.parse("2026-08-21T21:50:00Z")) /
      (365 * 86_400_000)) * DAYS;
    const em = computeExpectedMove({ spot: SPOT, atmIv: ATM_IV, dteDays });
    assert.ok(em);
    const pct = Number((em!.movePct * 100).toFixed(1));
    assert.ok(pct > 5 && pct < 15, `covering expiry should imply a real earnings move, got ${pct}`);
    // Same order as the independently measured straddle (7.6%); ~90x the value prod published.
    assert.ok(pct / 0.1 > 50, "the error being fixed is two orders of magnitude, not a rounding");
  });
});

describe("a quote may only be published when its expiry spans the print", () => {
  test("an expiry on or after the print date qualifies", () => {
    assert.equal(expiryCoversPrint("2026-08-28", "2026-08-24"), true);
    assert.equal(expiryCoversPrint("2026-08-24", "2026-08-24"), true, "same day is covered");
  });

  test("the exact live failure is rejected — today's expiry against a print three days out", () => {
    assert.equal(expiryCoversPrint("2026-08-21", "2026-08-24"), false);
  });

  test("UNKNOWN IS NOT YES — an uncheckable quote is refused, not waved through", () => {
    // The failure mode is publishing a confident number wrong by two orders of magnitude, so a
    // quote that cannot say which chain it came from must not be published as the earnings move.
    for (const bad of [null, undefined, "", "soon", 20260828, "2026-8-28", "26-08-28", {}, []]) {
      assert.equal(expiryCoversPrint(bad as never, "2026-08-24"), false, `expiry=${String(bad)}`);
      assert.equal(expiryCoversPrint("2026-08-28", bad as never), false, `print=${String(bad)}`);
    }
  });
});

describe("the SIGNAL the report publishes is gated by the same rule", () => {
  // buildMeridianEarningsReport renders this as a "Vector expected move" pillar reading
  // `Chain IV ~<n>% · <expiry>`. It prints the expiry beside the number, so a non-covering quote
  // makes the panel display its own contradiction:
  //   PDD, printing 2026-08-24  ->  "Chain IV ~0.1% · 2026-08-21"   (measured on prod 22:10Z)
  const REPORT_CORE = readFileSync(
    join(process.cwd(), "src/lib/meridian/meridian-earnings-report-core.ts"),
    "utf8"
  );

  test("the pillar still prints its expiry next to the number — that is what makes it checkable", () => {
    assert.match(REPORT_CORE, /Chain IV ~\$\{input\.vector_move_pct\}%/);
    assert.match(REPORT_CORE, /input\.vector_expiry/);
    // …and it is still suppressed entirely when there is no quote, which is the behaviour the
    // gate reuses rather than inventing a new "unavailable" state.
    assert.match(REPORT_CORE, /if \(input\.vector_move_pct != null\)/);
  });

  test("a non-covering quote is not handed to the report at all", () => {
    assert.match(INTEL, /vectorCoversPrint && vectorEm\?\.movePct != null/);
  });

  test("the ungated signal value is gone", () => {
    assert.equal(
      INTEL.includes("const vector_move_pct =\n    vectorEm?.movePct != null ? Number((vectorEm.movePct * 100).toFixed(1)) : null;"),
      false,
      "the pillar must not be able to quote an expiry that cannot describe this print"
    );
  });
});

describe("the resolver is wired to the guard, and stops claiming chain_iv when it is not", () => {
  test("the vector fallback is gated on covering the print", () => {
    assert.match(INTEL, /expiryCoversPrint\(vectorEm\.expiry, input\.pack\.earnings_date\)/);
    assert.match(INTEL, /vectorCoversPrint \? Number\(\(vectorEm!\.movePct \* 100\)/);
  });

  test("the ungated fallback is gone", () => {
    assert.equal(
      INTEL.includes("(vectorEm?.movePct != null ? Number((vectorEm.movePct * 100).toFixed(1)) : null)"),
      false,
      "an unscoped weekly quote must not be able to become the earnings move"
    );
  });

  test("the SOURCE label follows the same gate — it cannot say chain_iv for a calendar figure", () => {
    // The old label said `chain_iv` whenever a vector quote merely EXISTED, even when the value
    // published came from the calendar. Provenance has to track what was actually used.
    const at = INTEL.indexOf("const expected_move_source");
    const block = INTEL.slice(at, INTEL.indexOf(";", INTEL.indexOf("calendar", at)));
    assert.match(block, /earningsEm != null \|\| vectorCoversPrint/);
    assert.equal(block.includes("vectorEm?.movePct != null"), false);
  });
});
