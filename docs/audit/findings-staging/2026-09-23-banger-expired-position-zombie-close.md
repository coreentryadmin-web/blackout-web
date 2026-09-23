## Expired Banger (Engine B) positions never closed — 41/168 (24%) of the open book was zombie-stuck, one 40 days past expiry — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings / Engine B (Banger) — Ask Largo (standing mandate) |
| **Severity** | P1 (real member capital positions never graded/closed; `summary.bangerOpens` inflated ~32% by dead rows) |
| **Files** | `src/lib/banger/live-sync.ts`, `src/app/api/cron/banger-live-sync/route.ts` |

### Root cause

`runBangerLiveSync` (`live-sync.ts`) fetches a live option mark per OPEN/PARTIAL row and, when the
provider returns none, silently `continue`s:

```ts
const mark = marks.get(row.contract_occ);
if (mark == null || !Number.isFinite(mark) || mark <= 0) {
  noQuote += 1;
  continue;
}
```

Once an option contract's expiry passes, the provider stops quoting it — so for an already-expired
row this branch fires on **every single tick, forever**. There was no expiry-aware force-close
path anywhere in this file or its cron caller (`banger-live-sync/route.ts`), so a row whose
contract had settled just sat in `OPEN`/`PARTIAL` in the database indefinitely.

### Evidence

Found while diffing a different discrepancy: `GET /api/market/swing/record`'s
`summary.bangerOpens` reported 168, but `GET /api/market/nighthawk/horizons?view=swings`'s
`board.lanes.SWING.committed` showed only 130 committed plays (native+banger). Diffing
`/api/market/banger/board`'s `open[]` (unpaged, per the sibling `#5466` fix) against the committed
list by ticker surfaced 22 banger tickers with zero matching committed entry — all with a
**negative** calendar DTE. `horizonPlayFromBangerPosition` (`banger-lane-merge.ts`) correctly
refuses to render an expired contract (`dte < 0 → null`); that guard is working as designed and is
not the bug — it was just the first place the real defect became externally visible.

Measuring the FULL population (not just the ticker-collision subset), live 2026-09-23:
- 168 total OPEN/PARTIAL banger rows.
- **41 (24%) had an already-expired contract** — 3 `OPEN`, 38 `PARTIAL`.
- Oldest: id 99 (FLY), expired 2026-08-14 — **40 calendar days** stuck open, `entry_premium: 1.75`,
  `last_mark: 1` (stale), still reporting as an open position.
- None of the 41 had ever been graded — no `realized_pnl_pct`/`usd`, no `closed_at` — and none
  will ever transition on their own, since the branch above runs unconditionally on every RTH tick.

### Fix

Added an optional `fetchExpiryClose(ticker, expiryYmd) => Promise<number | null>` dependency to
`BangerLiveSyncDeps`. In the no-quote branch, if the row's contract `isExpirySettled`
(`src/lib/providers/expiry-liveness.ts` — the same helper the GEX heatmap uses for the identical
"has this expiry stopped trading" question), force a terminal close via a new
`settleExpiredBangerRow` helper instead of skipping:

- Settlement premium = OCC intrinsic value = `max(0, underlyingCloseOnExpiryDate - strike)`. Every
  banger contract is a LONG call (`banger-lane-merge.ts` hardcodes `right: "C"`, `direction:
  "LONG"`), so this is unambiguous — no put/short case to handle.
- Reuses the **exact** partial+remainder realized-P&L formula the existing `EXIT_RUNNER`/
  `STOP_OUT` branch already uses (`partial + remainingFraction * exitPremium`), with the
  settlement value standing in for a live exit mark — no bespoke math for this path.
- Closes via the existing `CLOSED_RUNNER` status (no new enum value, no DB migration —
  `updateBangerLiveState`'s `scale_out_action` column is free-text already) with
  `scaleOutAction: "EXPIRED"` and a `scaleOutReason` that names the settlement close/strike, so it
  reads clearly on the closed-board and is never confused with a real trailing-stop exit.
- `fetchExpiryClose` is optional and, when omitted, reproduces the pre-fix behavior byte-for-byte
  (falls into `noQuote`) — every existing caller/test is unaffected. A `null` return (holiday, data
  not posted yet) also leaves the row untouched for that tick rather than guessing.
- Wired the real implementation in `banger-live-sync/route.ts` via the already-existing
  `fetchOpenClose(ticker, date)` (`polygon-largo.ts`, Polygon's `/v1/open-close/{ticker}/{date}`) —
  no new provider primitive.

### Evidence (tests)

RED→GREEN proven via `git stash` on the two implementation files (test file kept): 5 new tests
failed pre-fix, all pass post-fix. `src/lib/banger/live-sync.test.ts` (11/11 pass, including the 6
pre-existing tests unchanged): force-close at intrinsic value (fresh + already-scaled/PARTIAL
rows), back-compat no-op when `fetchExpiryClose` is omitted, no-op when it returns `null`, and a
guard test proving a still-live (non-expired) no-quote row never even calls `fetchExpiryClose`.
`tsc --noEmit`: clean. Full banger-lane suite (`commit`, `contract`, `discord-trade-notify`,
`discovery`, `flag`, `live-sync`, `positions-db*`) + `expiry-liveness.test.ts`: all green.
`route.test.ts` for the cron itself: still green (RTH gate test unaffected).

### Fix rationale

Chose intrinsic-value-at-expiry-close over "settle at the last known mark before expiry" — the
cheaper alternative — because the latter can be stale by the exact same span as the bug itself (up
to 40 days for the oldest rows here), while intrinsic value from the underlying's actual
expiry-date close is the standard OCC settlement convention for American-style equity options and
requires no judgment call. Deliberately did not add a new `BangerStatus` enum value or DB column:
`CLOSED_RUNNER` + a distinct free-text `scale_out_action`/`scale_out_reason` fully expresses
"this settled at expiry, not via the live trailing-stop rule" without any schema change or
blast-radius into `ScaleOutAction`-typed call sites elsewhere (`manage.ts`,
`discord-trade-notify.ts`, `legacy-live-sync.ts`) — the new `transitions` array stays untouched
(typed `ScaleOutAction` strictly); a separate `expiredSettled` counter was added to
`BangerLiveSyncResult` instead. Raised on the standing #4076 collaboration thread before
implementing, given this changes what "realized P&L" means for real member capital; implemented
once the settlement approach (OCC intrinsic value, reusing existing math, no schema change) was
laid out with full evidence rather than shipping a guess silently.
