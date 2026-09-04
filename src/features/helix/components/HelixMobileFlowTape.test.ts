import test from "node:test";
import assert from "node:assert/strict";

import { dtePrintLabel } from "./HelixMobileFlowTape";

/**
 * REGRESSION: an already-expired print's DTE segment must not render a bare negative day count.
 *
 * Root cause: `HelixMobileFlowTape` computes `dte = flow.dte ?? daysToExpiry(flow.expiry)`. UW's
 * own `dte` field is frequently populated (so the `??` fallback to the CLAMPED `daysToExpiry()`
 * never fires) and goes NEGATIVE for a print reported after its contract's expiry has already
 * passed — `helix-flow-format.ts`'s `fmtIv` doc comment records a real observed instance
 * (`dte: -1`, SPY 2026-08-21 expiry). Before this fix the card rendered that raw value as
 * `${dte}d` — a bare "-1d" — in the SAME plain, unstyled `<span>` as any ordinary positive DTE,
 * with none of the highlighted ember treatment a same-day (0DTE) print gets one row up.
 */

test("REGRESSION: a negative (already-expired) DTE renders EXPIRED, not a bare negative number", () => {
  for (const dte of [-1, -3, -30, -365]) {
    const label = dtePrintLabel(dte);
    assert.equal(label.text, "EXPIRED", `dte ${dte} must not render as a bare negative day count`);
    assert.doesNotMatch(label.text, /^-\d/, `dte ${dte} rendered "${label.text}" — still looks like a raw negative number`);
    assert.equal(label.expired, true, `dte ${dte} must be flagged expired for the highlighted treatment`);
  }
});

test("a normal future DTE is unaffected — still the plain '<n>d' label", () => {
  for (const dte of [1, 5, 32, 365]) {
    const label = dtePrintLabel(dte);
    assert.equal(label.text, `${dte}d`);
    assert.equal(label.expired, false);
  }
});

// dte === 0 (same-day/0DTE) never reaches this function at the call site — the card hides the
// DTE segment entirely for is0dte and shows the "0DTE" ember badge in the signals row instead —
// but the helper itself should still behave sanely if ever called with 0 directly.
test("dte === 0 is not treated as expired", () => {
  const label = dtePrintLabel(0);
  assert.equal(label.text, "0d");
  assert.equal(label.expired, false);
});
