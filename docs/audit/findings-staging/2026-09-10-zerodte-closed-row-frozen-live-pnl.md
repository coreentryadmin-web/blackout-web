# 0DTE board — CLOSED rows disclose a rounding-distorted live_pnl_pct instead of the true exit_pnl_pct — FIXED

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

**Corrected mid-investigation** (see the note at the end) — the first-pass diagnosis of "the
live-marks poller stops re-quoting a dead contract, so `live_pnl_pct` freezes stale" was WRONG.
Traced the real mechanism in `zerodte-service.ts` directly: for a non-`"stopped"` `closed_reason`
(a "ratchet"/"thesis"/"flat"/"target" engine exit — everything except the mechanical -50% hard
stop), `live_pnl_pct` is DELIBERATELY RECOMPUTED post-`roundFloats()` from the ROUNDED,
member-visible `entry_premium`/`last_mark` (`reconcileLedgerLivePnlPct` → falls through to
`pinnedLivePnlPct(entry_premium, last_mark)` on the already-rounded pair), with the code's own
comment stating why: *"roundFloats() rounds entry_premium/last_mark independently; recompute PnL
from the member-visible rounded premiums so live_pnl_pct always matches its structure's formula"*
(`zerodte-service.ts:834-838`). **That is correct, intentional design for `live_pnl_pct`'s own
purpose** — a member computing `(mark-entry)/entry` by hand from the two rounded numbers shown on
the same row gets the same answer `live_pnl_pct` shows.

For this QQQ row: `entry_premium` and `last_mark` both display as `0.22` (the real exit print was
`0.215`, which rounds to `0.22` for display — same value as entry), so the rounded-pair formula
gives exactly `0%`. The RAW, pre-rounding exit computation (`0.215` vs the raw entry) gives the true
`-2.27%` — the same rounding-boundary shape already fixed once this session in the exit engine
itself (#4737, "ratchet floor's `mark_honored` flag breaks at a cent-rounding boundary"), recurring
here in a sibling, still-correct-for-its-own-purpose field.

The actual bug is one layer up: `closedPnlDisplay` (`marks-math.ts`) — the ONE shared function that
decides what a CLOSED row displays, whose own doc comment already warns "an unbanked peak is a loss
shown as a gain" — serves a DIFFERENT purpose than `live_pnl_pct`'s live-monitoring self-consistency:
it answers "what did this position actually realize," where the answer must be the raw-precision
result, not a number that's merely consistent with two other rounded numbers on the same row. It had
this category mismatch baked into BOTH its outputs:
- `pct` (the primary badge, shown when no trim tranche armed) fell back to `row.live_pnl_pct`.
- `realized_pct` (the disclosure paired with a shown peak — the field this function's own comment
  says "any surface showing the peak is obliged to show... too") ALSO used `row.live_pnl_pct`.

Neither ever consulted `row.exit_pnl_pct` — a field the exit engine populates with the real final
result at RAW precision (`entry_context.exit.pnl_pct`, forwarded to the board API's ledger row),
because `closedPnlDisplay`'s row type never declared it, and the client `LedgerRow`/`PlayRow` types
in `ZeroDteBoard.tsx` never mapped it through from the raw API response in the first place —
`mergePlays` copied `exit_reason`/`exit_detail` from the ledger row but silently dropped
`exit_pnl_pct` sitting right beside them.

**Note on a same-day, same-mechanism cross-check that looked like a contradiction and wasn't:** a
parallel Legacy-lane cycle independently traced this exact `live_pnl_pct` vs `exit_pnl_pct`
divergence on a DIFFERENT ticker (RDDT, a smaller 0.43pp gap) the same day and logged it as
"confirmed by-design, not a bug" (`docs/audit/nighthawk-0dte-live-journal.json`, `2026-09-10T19:07Z`
entry). That conclusion is correct and does not conflict with this fix — they were asking "is
`live_pnl_pct`'s own computation wrong?" (no, it's working as designed) while this finding asks "is
`closedPnlDisplay`'s CONSUMPTION of `live_pnl_pct` for a 'what actually happened' purpose correct?"
(no — a field designed for display self-consistency is the wrong source for a realized-outcome
disclosure, regardless of how correctly that field computes what it's designed to compute).

## Evidence

Live capture (one temp Clerk premium session, deleted after), `GET /api/market/zerodte/board`
ledger row for QQQ vs `GET /api/market/zerodte/record?days=1`'s matching play — both routes carry
`exit_pnl_pct`/`entry_context.exit.pnl_pct` reading `-2.27`, and the board row's own separate
`live_pnl_pct` field reads `0`. Mechanism confirmed by reading `zerodte-service.ts:536,834-843`
directly (`reconcileLedgerLivePnlPct`), not inferred.

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

Deliberately left `live_pnl_pct`'s OWN computation (`reconcileLedgerLivePnlPct`, `zerodte-service.ts`)
untouched — it is correct, intentional design for its own live-monitoring-consistency purpose (the
RDDT cross-check above confirms this independently). The bug was purely in which field
`closedPnlDisplay` reached for when reporting a CLOSED row's realized result, not in how either
field is computed.
