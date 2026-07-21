import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDeskGap, gapFromPrice } from "./gap-proxy";

test("gapFromPrice: (price − prior)/prior × 100 at 3dp; null-safe", () => {
  assert.equal(gapFromPrice(7509, 7443.28), 0.883);
  assert.equal(gapFromPrice(7443.28, 7443.28), 0);
  assert.equal(gapFromPrice(100, null), null);
  assert.equal(gapFromPrice(0, 7443), null);
});

test("resolveDeskGap RTH: gap is FROZEN at the RTH open, not the live price", async () => {
  const prior = 7443.28;
  const open = 7500;
  // As spot moves through the session the gap must stay pinned to the open→prior dislocation.
  const atOpen = await resolveDeskGap({ spx_price: 7500, prior_close: prior, premarket: false, rth_open: open });
  const later = await resolveDeskGap({ spx_price: 7560, prior_close: prior, premarket: false, rth_open: open });
  assert.equal(atOpen.gap_pct, later.gap_pct); // the bug was these DIFFERING (gap drifted with price)
  assert.equal(atOpen.gap_source, "SPX");
  assert.equal(atOpen.gap_pct, gapFromPrice(open, prior)); // = the opening gap, not spx_change_pct
  assert.notEqual(later.gap_pct, gapFromPrice(7560, prior)); // and NOT the live change
});

test("resolveDeskGap RTH: falls back to spot only before the first bar prints (open null)", async () => {
  const g = await resolveDeskGap({ spx_price: 7510, prior_close: 7443.28, premarket: false, rth_open: null });
  assert.equal(g.gap_pct, gapFromPrice(7510, 7443.28));
  assert.equal(g.gap_source, "SPX");
});

test("resolveDeskGap RTH: null prior close → null gap (never fabricate)", async () => {
  const g = await resolveDeskGap({ spx_price: 7510, prior_close: null, premarket: false, rth_open: 7500 });
  assert.equal(g.gap_pct, null);
  assert.equal(g.gap_source, null);
});
