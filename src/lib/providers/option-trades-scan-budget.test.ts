import test from "node:test";
import assert from "node:assert/strict";

import { shouldStopContractScan } from "./option-trades-scan-budget";

// ── THE DEADLINE INSIDE THE FAN-OUT (2026-08-18) ─────────────────────────────────────────────
// The per-contract scan is sequential by design (rate-limiter paced), so its cost is up to
// MAX_CONTRACTS x MAX_PAGES_PER_CONTRACT = 80 serialized round trips — and it pays that cost
// precisely when the chain is BUSY, because a busy contract fills both pages. Measured live through
// the served endpoint: every ticker with a real 0DTE expiry breached the caller's 25s deadline
// (SPY/QQQ/NVDA/META/AMD all `timed out after 25000ms`), while TSLA — no 0DTE expiry, quiet
// fallback — answered in 2.4s. The caller's race is all-or-nothing and threw away every contract
// already scanned; this rule stops the scan instead and keeps them.

test("a scan under budget keeps going", () => {
  assert.equal(shouldStopContractScan(5, 3_000, 15_000), false);
});

test("a scan at or past its budget stops", () => {
  assert.equal(shouldStopContractScan(5, 15_000, 15_000), true, "at the budget counts as spent");
  assert.equal(shouldStopContractScan(5, 20_000, 15_000), true);
});

test("THE INVARIANT: the first contract always runs, however small the budget", () => {
  // A budget that returns zero contracts is the caller's empty-timeout failure moved one layer
  // down — it would look like a fix while changing nothing a member can see.
  for (const budget of [1, 0.5, 15_000]) {
    assert.equal(
      shouldStopContractScan(0, 999_999, budget),
      false,
      `budget ${budget} must still scan one contract`
    );
  }
});

test("an unusable budget does NOT throttle the scan", () => {
  // A bad env value must degrade to the old (complete) behaviour, not silently cut every result
  // down to a single contract — a wrong number should be visible as slowness, not as missing data.
  for (const budget of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      shouldStopContractScan(10, 60_000, budget as number),
      false,
      `budget ${String(budget)} must not stop the scan`
    );
  }
});

test("an unusable elapsed reading never stops the scan either", () => {
  // Defensive: a clock that reads backwards must not truncate a scan that has actually done no work.
  assert.equal(shouldStopContractScan(10, Number.NaN, 15_000), false);
  assert.equal(shouldStopContractScan(10, -5, 15_000), false);
});

test("the rule is monotone in elapsed time — it never un-stops", () => {
  // Once the budget is spent it stays spent; a rule that flickered would scan an unbounded number
  // of extra contracts on a noisy clock.
  const budget = 10_000;
  let stopped = false;
  for (let elapsed = 0; elapsed <= 20_000; elapsed += 500) {
    const now = shouldStopContractScan(3, elapsed, budget);
    if (stopped) assert.equal(now, true, `un-stopped at ${elapsed}ms`);
    stopped = now;
  }
  assert.equal(stopped, true, "must have stopped by the end of the sweep");
});
