> **kind:** `FINDING`

## Stock/ETF after-hours change% anchored to the wrong prior close (Thermal QQQ, live report) — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Reported by** | Operator, live — "Thermal shows QQQ last close at 706.90, we closed today at 708.69" |
| **Severity** | P2 — visibly wrong percentage on every stock/ETF quote once cash RTH closes, not a crash |

### Root cause

`src/lib/providers/polygon.ts`'s `snapshotChangePctFromRow` (feeding `_rowToSnapshot`, which
backs `fetchStockSnapshot`/`fetchStockSnapshots` — the shared quote path for Thermal's
`resolveSpotSnapshot` REST fallback, `/api/market/quote`, and other stock/ETF spot consumers)
unconditionally trusted Polygon's own `todaysChangePerc` field (or derived from `day.c` vs
`prevDay.c` when absent).

Once cash RTH closes, Polygon's `day` bucket (a ticker's most-recently-completed session's OHLC)
freezes at the official close and does **not** keep tracking after-hours prints — those land only
in `lastTrade`. But `todaysChangePerc`/`prevDay.c` keep referencing the close from **one session
before** the one that just closed, until the *next* session opens and Polygon rolls the buckets
forward. So any real after-hours print gets compared against a stale, one-session-too-old close.

**Live evidence, 2026-09-11 ~05:36 UTC (cash RTH closed, QQQ traded after-hours):**
- Polygon snapshot: `day.c = 708.69` (2026-09-10's real, confirmed close — matches
  `/v2/aggs/ticker/QQQ/prev`), `prevDay.c = 716.31` (2026-09-09's close), `lastTrade.p = 706.8992`
  (a real after-hours print).
- App reported `spot: 706.9`, `change_pct: -1.31%` (= (706.90 − 716.31) / 716.31 — measured
  against **Sept-9's** close).
- Actual move since the real close: (706.90 − 708.69) / 708.69 = **-0.25%** — 5× smaller in
  magnitude than what was displayed, and anchored to a close two sessions removed from "now."

Mirror-image of the index bug `src/features/spx/lib/spx-change-anchor.ts` already fixes: there,
`previous_close` rolls FORWARD too early (reads a false 0%); here, `day.c` rolls forward too LATE
relative to a live after-hours print (reads a stale, larger move than actually happened since the
close).

### Fix

`snapshotChangePctFromRow` gained an optional `cashSessionOpen` parameter (default `true`,
preserving every existing caller's behavior unchanged). When explicitly `false`, it anchors the
change% to `day.c` (the just-completed regular session's real close) against the latest print,
before falling through to the old `todaysChangePerc`/`prevDay.c` logic. `_rowToSnapshot` now
passes `isEtCashRth()` (the same canonical cash-RTH gate `thermalQuoteBadge`/matrix-freshness
checks already use elsewhere in this codebase) so the anchor flips automatically once the session
closes, with zero behavior change while it's open.

### Blast radius

Two other call sites of `snapshotChangePctFromRow` — `fetchStockSnapshotPerformance` (leaders /
sector-breadth performance panel) — were deliberately left untouched: they weren't the reported
symptom, and widening this fix to them is a separate, unverified change per the standing
scope-discipline (a small, single-issue PR). Flagged here as a known, disclosed follow-up if the
same stale-AH-anchor symptom is ever reported on those surfaces.

### Evidence

- `npx tsx --experimental-test-module-mocks --test src/lib/providers/polygon-snapshot-change-pct.test.ts`
  — 9/9 pass (5 new/updated), RED→GREEN confirmed via `git stash` on `polygon.ts` alone (3 of the
  new tests fail pre-fix with the exact -1.06%/-1.31% stale-anchor values, pass post-fix).
- `npx tsc --noEmit -p .` — clean.
- Full `npm test` — run alongside this fix; see PR for the pass count.
