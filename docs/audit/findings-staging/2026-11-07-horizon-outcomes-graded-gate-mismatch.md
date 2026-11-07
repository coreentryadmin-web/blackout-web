# 2026-11-07 horizon-outcomes.ts: `mapZeroDteOutcome` gated "graded" on the wrong lane, silently dropping real live-managed exits

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 data-correctness (cross-lane reporting under-counts real graded trades) |

## Root cause

`mapZeroDteOutcome` (`src/lib/horizon-outcomes.ts`) is the row→outcome mapper behind
`fetchUnifiedHorizonOutcomes`, the read-only cross-lane outcomes view `get_horizon_outcomes`
(Largo, grouped with the Track Record tools per the file's own header) reads. Its own header
already documents, in detail, that it must report the SAME number `record.ts`'s
`managedGradeView`/`asManagedPnlPct` computes (the AS-MANAGED headline — the exit the member was
actually live-guided to take) and NOT `officialPlanPnlPct`/`isZeroDteWin` (the MECHANICAL/OFFICIAL
lane, `record.ts`'s own doc: "never the headline").

The VALUE was wired correctly — `pnl = asManagedPnlPct(row)`. But the "is this row even graded"
gate was wired to a *different* function entirely:

```ts
const graded = isGradedZeroDteRow(row);
const pnl = graded ? asManagedPnlPct(row) : null;
```

`isGradedZeroDteRow` tests `officialPlanOutcome`/`officialPlanPnlPct` — which, absent an override
or a WS-10/WS-11 `entry_context.executable` reconstruction, falls all the way back to the row's
own `plan_outcome`/`plan_pnl_pct` MID columns. Those mid columns are populated by a separate
mechanical bar-walk grading pass, not by the live exit engine itself. Right after a position
closes on a real live-only exit (thesis-break / ratchet-floor / flat-timeout), the exit engine
stamps `entry_context.exit` immediately — and `managedGradeView`'s `hasRealTerminalExit` branch
grades straight off that blob, with no dependency on the mid columns or an executable blob at all
— but the mechanical mid-column grade can still be null (not yet computed, or for a live-only
reason the bar-walk can't reproduce, never reconciled into `officialPlanPnlPct` at all — see that
function's own `officialOverridingRealExit` guard). In that window `isGradedZeroDteRow` reads
`false` while `asManagedPnlPct` already has a real, well-defined number.

Because `pnl` was forced to `null` whenever `graded` was false (regardless of what
`asManagedPnlPct` actually returned), every such row was reported with `label: null, pnl_pct:
null` — silently dropped from the unified outcomes feed as "ungraded," even though it is a
genuinely closed, gradable position with a real, signed P&L the member-facing Track Record UI and
`/api/market/zerodte/record` both already show.

This is the same "two lanes read for one decision, only one kept current" shape the file's own
header already calls out for the *value* (officialPlanPnlPct vs asManagedPnlPct can disagree in
sign) — except here it was the *gate*, not the value, that silently diverged, and the failure mode
is worse: not a wrong sign, but the row vanishing from the feed entirely.

## Evidence

- Constructed a fixture row shaped exactly like the normal post-close, pre-mechanical-grade state:
  `plan_outcome: null, plan_pnl_pct: null` (mechanical mid grade not yet computed), no
  `entry_context.executable` (no WS-10/WS-11 grade), `entry_context.exit: { reason:
  "thesis_break:gex_walls", pnl_pct: -9.5 }` (the real live exit, already stamped).
- Pre-fix: `mapZeroDteOutcome(row)` → `{ label: null, pnl_pct: null }` — the row silently
  disappears from `get_horizon_outcomes` even though it closed at a real -9.5% loss.
- Post-fix: `mapZeroDteOutcome(row)` → `{ label: "loss", pnl_pct: -9.5 }`.
- RED→GREEN proof: added this exact case as a new `node --test` assertion in
  `src/lib/horizon-outcomes.test.ts`; it fails against the pre-fix code (14 pass / 1 fail) and
  passes after the fix (15/15 pass). All four pre-existing `mapZeroDteOutcome` tests (legacy-mid,
  WS-11 reconstruction win, live-only-exit-vs-executable loss, ungradeable row, exact-zero
  breakeven) continue to pass unchanged — the fix narrows the gate to agree with the value already
  being read, it does not change behavior for any row that was already correctly handled.

## Blast radius

Only `mapZeroDteOutcome` in `src/lib/horizon-outcomes.ts` changed. `mapSwingOutcome` (the Swing
sibling) already gated correctly on its own single source of truth (`graded_at` + finite
`realized_pnl_pct`) and is untouched. `fetchUnifiedHorizonOutcomes`'s DB-fetch wiring, the LEAPS
placeholder, and every other export in this file are unchanged. No other module reads
`isGradedZeroDteRow` from this file (it was only ever imported here); `record.ts` itself and every
one of *its* existing callers of `isGradedZeroDteRow`/`officialPlanPnlPct`/`asManagedPnlPct` are
untouched — this fix only removes one, mistaken cross-wiring at the call site in
`horizon-outcomes.ts`.

## Fix rationale

Gate "graded" on the exact same computation whose result is reported, so the two can never drift
apart again: `const pnl = asManagedPnlPct(row); const label = pnl == null ? null : ...`. This also
lets the now-unused `isGradedZeroDteRow` import be dropped. No change to `record.ts` itself — that
file's precedence logic (reconstruction vs real-exit vs mechanical) is correct and already
carefully guarded by its own extensive sign-safety comments; the bug was purely in this file's
mismatched re-use of two of its exports for one decision.

## Verify

- `npx tsx --experimental-test-module-mocks --test src/lib/horizon-outcomes.test.ts` — 15/15 green
  (was 14/15 pre-fix with the new case added, RED→GREEN confirmed).
- `npx tsc --noEmit` — no errors attributable to this file.
- Full `npm test` — see PR for the exact pass count.
