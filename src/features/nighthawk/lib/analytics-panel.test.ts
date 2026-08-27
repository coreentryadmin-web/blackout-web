import { test } from "node:test";
import assert from "node:assert/strict";
import { winRateByTier, sessionPnlCurve, latestSessionDate } from "./analytics-panel";
import type { ZeroDteRecordPlay } from "@/lib/zerodte/record";

function play(overrides: Partial<ZeroDteRecordPlay>): ZeroDteRecordPlay {
  return {
    session_date: "2026-08-20",
    ticker: "SPX",
    direction: "long",
    flagged_at: "2026-08-20T14:35:00.000Z",
    flagged_et: "10:35",
    score: 70,
    conviction: null,
    plan_outcome: null,
    plan_pnl_pct: null,
    managed_outcome: "target",
    managed_pnl_pct: 40,
    managed_source: "engine",
    direction_hit: true,
    move_pct: 1.2,
    entry_context: null,
    tier: "A",
    ...overrides,
  };
}

test("winRateByTier: buckets by pinned tier, ignores untiered and ungraded rows", () => {
  const plays: ZeroDteRecordPlay[] = [
    play({ tier: "A", managed_pnl_pct: 40 }), // win
    play({ tier: "A", managed_pnl_pct: -50 }), // loss
    play({ tier: "B", managed_pnl_pct: 20 }), // win
    play({ tier: null, managed_pnl_pct: 90 }), // dropped — untiered
    play({ tier: "C", managed_pnl_pct: null, managed_outcome: null }), // dropped — ungraded
  ];
  const buckets = winRateByTier(plays);
  assert.equal(buckets.length, 3);
  const a = buckets.find((b) => b.tier === "A")!;
  assert.equal(a.n, 2);
  assert.equal(a.wins, 1);
  assert.equal(a.losses, 1);
  assert.equal(a.win_rate_pct, 50);
  const b = buckets.find((b) => b.tier === "B")!;
  assert.equal(b.n, 1);
  assert.equal(b.win_rate_pct, 100);
  const c = buckets.find((b) => b.tier === "C")!;
  assert.equal(c.n, 0);
  assert.equal(c.win_rate_pct, null);
  assert.equal(c.low_n, true);
});

test("winRateByTier: breakeven rows count toward n but not wins/losses", () => {
  const plays: ZeroDteRecordPlay[] = [play({ tier: "B", managed_pnl_pct: 0 })];
  const [, b] = winRateByTier(plays);
  assert.equal(b.n, 1);
  assert.equal(b.wins, 0);
  assert.equal(b.losses, 0);
  assert.equal(b.breakeven, 1);
  assert.equal(b.win_rate_pct, 0); // breakeven counts in the decided denominator, per record.ts parity
});

test("sessionPnlCurve: only the LATEST session date, sorted, running sum", () => {
  const plays: ZeroDteRecordPlay[] = [
    play({ session_date: "2026-08-19", ticker: "OLD", managed_pnl_pct: 999 }),
    play({ session_date: "2026-08-20", ticker: "B", flagged_at: "2026-08-20T15:00:00.000Z", managed_pnl_pct: -10 }),
    play({ session_date: "2026-08-20", ticker: "A", flagged_at: "2026-08-20T14:00:00.000Z", managed_pnl_pct: 30 }),
  ];
  const curve = sessionPnlCurve(plays);
  assert.equal(curve.length, 2);
  assert.equal(curve[0].ticker, "A"); // earlier flagged_at first
  assert.equal(curve[0].cumulative_pct, 30);
  assert.equal(curve[1].ticker, "B");
  assert.equal(curve[1].cumulative_pct, 20); // 30 + (-10)
  assert.ok(curve.every((p) => p.seq >= 1));
});

// Cursor review, PR #2989: the panel captioned the curve "Today's session P&L" regardless of
// whether the latest session in `plays` actually IS today — a stale pre-market/holiday payload
// would mislabel a prior day's plays as today's. latestSessionDate() is the helper the panel
// now compares against record.window.through to decide the caption; this pins its own math.
test("latestSessionDate: returns the max session_date, or null when empty", () => {
  const plays: ZeroDteRecordPlay[] = [
    play({ session_date: "2026-08-19" }),
    play({ session_date: "2026-08-20" }),
    play({ session_date: "2026-08-18" }),
  ];
  assert.equal(latestSessionDate(plays), "2026-08-20");
  assert.equal(latestSessionDate([]), null);
});

test("sessionPnlCurve: empty input and all-ungraded session both return []", () => {
  assert.deepEqual(sessionPnlCurve([]), []);
  assert.deepEqual(
    sessionPnlCurve([play({ managed_pnl_pct: null, managed_outcome: null })]),
    []
  );
});
