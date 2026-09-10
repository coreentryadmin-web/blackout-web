# 0DTE board — CLOSED rows disclose a frozen pre-exit live_pnl_pct instead of the true exit_pnl_pct — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-zerodte-closed-row-frozen-live-pnl |
| **Priority** | P2 |
| **Area** | Night Hawk 0DTE board — `ZeroDteBoard.tsx` / `marks-math.ts` (`closedPnlDisplay`) |
| **Status** | FIXED |

## Symptom

Found during the standing 5-engine live monitor cycle (2026-09-10), cross-checking
`GET /api/market/zerodte/board`'s ledger row against `GET /api/market/zerodte/record` for the
same live QQQ position. Both routes describe the identical, already-CLOSED trade
(`O:QQQ260910P00705000`, exit at `2026-09-10T16:36:41.942Z`), but disagreed on its result:

```
BOARD  live_pnl_pct: 0       exit_pnl_pct: -2.27   exit_reason: "ratchet"
RECORD managed_pnl_pct: -2.27 (agrees with the board's OWN exit_pnl_pct field)
```

`exit_detail` on the same row spells out the true story: *"Mark 0.215 (-2.27%) is at/below the 0%
floor armed by a +47.73% peak — the protective floor exits so the green trade cannot finish red."*
— i.e. the board's own data already knows the real result is -2.27%, but a DIFFERENT field on the
identical row (`live_pnl_pct`) reads 0%, and that is the field the live `/nighthawk` UI's peak-tranche
disclosure tooltip actually renders.

## Root cause

`live_pnl_pct` is computed live, per poll, from the CURRENT mark
(`livePnlPctFor(isCondor, entryPremium, pnlMark)`, `live-marks.ts:859`). Once a row's status becomes
CLOSED, the live-marks poller stops re-quoting the now-dead contract (confirmed live: this row's
`mark_as_of` is `null`) — so `live_pnl_pct` FREEZES at whatever the last live poll computed, which
can predate the actual exit tick. For this row: entry premium and the last live poll's mark both
happened to round to the same display value (`0.22` == `0.22`), giving a naive `0%`, while the real
exit fired on the RAW, unrounded print (`0.215`, `-2.27%`) — the exact rounding-boundary shape
already fixed once this session in the exit engine itself (#4737, "ratchet floor's `mark_honored`
flag breaks at a cent-rounding boundary"), but recurring here in a sibling field (`live_pnl_pct`)
that #4737 never touched.

`closedPnlDisplay` (`marks-math.ts`) — the ONE shared function that decides what a CLOSED row
displays, and whose own doc comment already warns "an unbanked peak is a loss shown as a gain" —
had exactly this same class of bug baked into BOTH its outputs:
- `pct` (the primary badge, shown when no trim tranche armed) fell back to `row.live_pnl_pct`.
- `realized_pct` (the disclosure paired with a shown peak — the field this function's own comment
  says "any surface showing the peak is obliged to show... too") ALSO used `row.live_pnl_pct`.

Neither ever consulted `row.exit_pnl_pct` — a field the exit engine populates with the real final
result (`entry_context.exit.pnl_pct`, forwarded to the board API's ledger row), because
`closedPnlDisplay`'s row type never declared it, and the client `LedgerRow`/`PlayRow` types in
`ZeroDteBoard.tsx` never mapped it through from the raw API response in the first place — `mergePlays`
copied `exit_reason`/`exit_detail` from the ledger row but silently dropped `exit_pnl_pct` sitting
right beside them.

## Evidence

Live capture (one temp Clerk premium session, deleted after), `GET /api/market/zerodte/board`
ledger row for QQQ vs `GET /api/market/zerodte/record?days=1`'s matching play — both routes carry
`exit_pnl_pct`/`entry_context.exit.pnl_pct` reading `-2.27`, and the board row's own separate
`live_pnl_pct` field reads `0`.

RED→GREEN, `src/lib/zerodte/marks-math.test.ts` (3 new tests using the exact live QQQ numbers,
plus a synthetic no-tranche-armed case for the PRIMARY badge — not just the tooltip): `git stash
push -- src/lib/zerodte/marks-math.ts` → 65/67 pass, 2 fail (the two new assertions expecting
`-2.27`/`-10` got `0`/`5`); `git stash pop` restores 67/67 pass. `ZeroDteBoard.test.ts` (unaffected
by this change) 28/28 pass. `npx tsc --noEmit` clean.

## Blast radius

Single shared function, single call site: `closedPnlDisplay` is called from exactly one place in
the whole repo — `ZeroDteBoard.tsx`'s `StatsCell` (verified via repo-wide grep) — so both the
PRIMARY badge (unbanked-peak rows) and the hover tooltip (banked-peak rows) share this one fix.
The "command deck" v2 adapter (`command-deck/adapters.ts`) already forwards `exitPnlPct` as its own
independent field and does NOT go through `closedPnlDisplay` at all — confirmed unaffected, no
double-fix risk there. `overlayLiveMark` (the B-9 SSE-overlay function) returns early for CLOSED
rows (`{...row, mark_stale: false}`), so it never touches `exit_pnl_pct` and needed no change.

## Fix rationale

Added `exit_pnl_pct` as an optional field on `closedPnlDisplay`'s row type and derived
`realized = row.exit_pnl_pct ?? row.live_pnl_pct ?? null`, using `realized` for BOTH `pct` (the
no-tranche-armed primary badge) and `realized_pct` (the peak-disclosure hover text) — a CLOSED
row's true result is its own exit engine's final print, and `live_pnl_pct` is demoted to what it
always should have been: a fallback for older payloads that predate this field, never authoritative
once an `exit_pnl_pct` exists. Then wired `exit_pnl_pct` through the two places it was silently
dropped: `LedgerRow`/`PlayRow` types (both branches of `mergePlays` — the committed-ledger-row path
gets `r.exit_pnl_pct ?? null`, the uncommitted fresh-find path gets a hardcoded `null` since a find
is never closed) and the `StatsCell` tooltip, which now reads `pnlView.realized_pct` (the function's
OWN correct output) instead of reaching around it to read `row.live_pnl_pct` directly — that direct
reach-around was itself a second, independent bug: even a caller who wanted the right answer
couldn't get it from `closedPnlDisplay`'s return value before this fix, because `realized_pct` was
computed wrong at the source.

Deliberately left `live_pnl_pct`'s OWN computation (`live-marks.ts`) untouched — it is correct for
what it is (a live poll snapshot), and freezing after the position closes is itself correct/expected
behavior (there is nothing left to poll). The bug was purely in which field the DISPLAY layer
reached for once a row closes, not in how either field is computed.
