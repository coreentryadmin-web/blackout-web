# 2026-11-09: Night Hawk Cortex evidence `weight` disagreed with its own narrative text at the wire boundary (record + board routes)

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

Night Hawk 0DTE's Cortex evidence items (`entry_context.cortex.supports[]`/`opposes[]`/`vetoes[]`)
served a structured `weight` field that disagreed with that SAME item's own pre-formatted
`narrative` text line, at the 3rd decimal place. Live-confirmed on
`GET /api/market/zerodte/record?days=14` (prod): META 2026-11-05's `entry_context.cortex.
supports[]` carried `{"weight": 0.48, ...}` for source `opening-harvest`, while the SAME item's own
`narrative` array entry read `"+0.478 [opening-harvest] opening harvest: gap up 2.3 pts..."`.
Reproduced on 45 distinct evidence items in that window (e.g. NVDA 2026-11-05 opening-harvest
weight field=0.52 vs narrative=0.524; SPY 2026-11-05 vex-charm weight field=0.4 vs
narrative=-0.399; QQQ 2026-11-04 vex-charm weight field=0.37 vs narrative=0.369). The same gap
existed live on `GET /api/market/zerodte/board`'s `ledger[].cortex`/`setups[].cortex.verdict` for
any currently-open position, not just the historical record route. Matches the Largo Product
Contract's "precision" dimension (`docs/audit/LARGO-PRODUCT-CONTRACT.md`) — Largo's
`get_zerodte_record`/board-reading tools could quote two different numbers for the same evidence
source within one answer.

## Root cause

`src/lib/nighthawk/cortex/compose.ts` computes each item's decayed/capped weight at 3-decimal
precision (`round(item.weight * cortexDecayFactor(...), 3)`, now named `CORTEX_WEIGHT_DP`) and
bakes that exact value into BOTH the structured item object AND the pre-formatted narrative string
(`` `+${s.weight} [...] ` ``) — so at composition time the two agree exactly, by construction.

The divergence happened downstream, at the two wire boundaries that re-round the already-composed
payload with the shared `roundFloats()` helper (`src/lib/round-floats.ts`), whose default is a flat
2dp with no awareness of `weight`'s 3dp origin:

- `src/app/api/market/zerodte/record/route.ts` called `roundFloats(record)` with the DEFAULT dp=2
  and no `keyDp` override at all. `roundFloats` recursively force-rounds every nested number,
  including `entry_context.cortex.supports[]/opposes[]/vetoes[].weight`, but it cannot touch the
  plain-text `narrative` array — so the structured field collapsed to 2dp while its own narrative
  sentence kept the original 3dp value.
- `src/lib/platform/zerodte-service.ts`'s `ZERODTE_BOARD_WIRE_DP` (the board route's `keyDp`
  override map, added for the SAME reason on option greeks and condor-width fields) listed
  `delta`/`theta`/`iv`/`gamma`/`vega`/`put_width_pct`/`call_width_pct` but never `weight` — so any
  currently-open position's Cortex evidence (`ledger[].cortex`, a committed row's flattened
  `entry_context.cortex`; `setups[].cortex.verdict`, a fresh find) carried the identical mismatch
  live on the board route too.

This is purely a display/precision-layer defect — it does not corrupt `score`/`conviction`/veto
decisions (all computed upstream from the full-precision value before this rounding pass ever
runs) and does not affect grading math.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the three source files —
`src/lib/nighthawk/cortex/compose.ts`, `src/lib/platform/zerodte-service.ts`,
`src/app/api/market/zerodte/record/route.ts`): 4 failures across the new/extended tests —
3 in `compose.test.ts` (new `CORTEX_WEIGHT_DP`/`CORTEX_WIRE_KEY_DP` exports missing, REPRO test
fails) + 1 in the new `record/route.weight-precision.test.ts` (`0.48 !== 0.48` — notEqual
assertion correctly fails because the bug collapsed the field to 0.48) + 1 in
`zerodte-service.test.ts` (same shape, board route's `ledger[].cortex.supports[].weight`).

GREEN (post-fix): all three target files pass — 51/51 across `compose.test.ts` (20),
`record/route.weight-precision.test.ts` (1), `zerodte-service.test.ts` (30). Broader regression
sweep (board route tests, sim-precision, `record.test.ts`, `zerodte-sim-board.test.ts`,
`round-floats.test.ts`, every `cortex/*.test.ts`): 157/157 pass. `npx tsc --noEmit` clean.

## Fix

Added one named export in `compose.ts` — `CORTEX_WEIGHT_DP = 3` (replacing the bare literal `3`
already passed to `round()` there, so the composer's own rounding and the wire-boundary override
can never independently drift to different values again) — and a derived `CORTEX_WIRE_KEY_DP:
RoundFloatsKeyDp = { weight: CORTEX_WEIGHT_DP }`, imported at both wire boundaries:

- `zerodte-service.ts`'s `ZERODTE_BOARD_WIRE_DP` now spreads `...CORTEX_WIRE_KEY_DP` alongside its
  existing greek/condor overrides.
- `record/route.ts`'s `roundFloats(record)` call now passes `roundFloats(record, 2,
  CORTEX_WIRE_KEY_DP)`.

**Why this fix and not an alternative:** the task description's suggested approach (add `weight` to
the existing `keyDp` override maps) is correct, but defining the dp as a bare literal `3` at each
call site would reintroduce exactly the "two independently-maintained constants can drift apart"
shape that caused this bug in the first place (compose.ts's internal `round(..., 3)` vs a
hand-picked wire-side override). Exporting one constant from the module that actually decides the
precision — and having both wire boundaries import it — makes that drift structurally impossible
rather than merely currently-correct. `compose.ts`'s own rounding BEHAVIOR is unchanged (the literal
`3` was replaced with a constant of the same value, not a different one).

**Deliberately NOT changed:** `compose.ts`'s internal 3dp computation itself (already correct,
confirmed by reading the source — this was the one explicit constraint in the task). The client
pane's own further re-rounding of the structured evidence table to 2dp for DISPLAY
(`src/lib/zerodte/pane.ts`'s `round2(item.weight).toFixed(2)`) — a separate, pre-existing, intentional
UI simplification of the rendered table that never reads the `narrative` strings verbatim, so it
cannot itself produce the field-vs-narrative mismatch this fix addresses.

## Blast radius

Two files fixed: `src/lib/platform/zerodte-service.ts` (board route, via its exported
`ZERODTE_BOARD_WIRE_DP`) and `src/app/api/market/zerodte/record/route.ts` (record route). One file
refactored to expose the shared constant: `src/lib/nighthawk/cortex/compose.ts` (behavior
unchanged). This fixes every consumer of `GET /api/market/zerodte/board` and
`GET /api/market/zerodte/record` that reads Cortex evidence structurally — the member Night Hawk
pane's evidence table (served pre-rounded for display anyway, so unaffected in practice), and
Largo's `get_zerodte_record`/board-reading tools, which read the raw JSON and could previously quote
the field and the narrative sentence as two different numbers in the same answer.

**Collision disclosed, not a second fix needed:** `roundFloats`'s `keyDp` matches by bare key name,
not by path — the same pre-existing behavior already accepted for `delta` (which also touches
`ledger[].thesis_health.delta`, an unrelated field, via the SAME `ZERODTE_BOARD_WIRE_DP` map before
this PR). Adding `weight` similarly raises `ledger[].thesis_health.pillars[].weight` (a normalized
0-1 pillar weight, `src/lib/zerodte/thesis-health.ts`) from 2dp to 3dp. That field is computed and
normalized to sum to 1 on the UNROUNDED weights before this display-only rounding pass ever runs,
so the extra digit is strictly more precision on an unrelated field, never a behavior change — not
worth a second, narrower override, and not touched by this PR.

**Found but deliberately NOT fixed here (separate, out of scope — flagged for a follow-up PR):**
`record/route.ts`'s `roundFloats(record, 2, CORTEX_WIRE_KEY_DP)` call (post-this-fix) still carries
NO override for `put_width_pct`/`call_width_pct` — confirmed real while investigating this bug:
`entry_context.condor` on a committed CONDOR-type row (`src/lib/zerodte/condor.ts`'s `CondorPlan`,
pinned at commit via `scan.ts`'s `...(s.play_type === "CONDOR" && s.condor_plan ? { condor:
s.condor_plan } : {}),`) carries these EXACT field names at internal 4dp precision, the same ones
`ZERODTE_BOARD_WIRE_DP` already protects on the board route (2026-10-26 fix) — so a historical
condor play's record-route width precision is exposed to the identical flat-2dp-collapse failure
mode this PR fixes for `weight`, just not yet fixed for that field. `shadow_signals.contract_greeks`
(`ContractGreeksQuality`), checked too, does NOT collide — its fields are `low_delta`/
`high_theta_decay`/`theta_decay_pct`/`note`, not literally keyed `delta`/`theta`/etc., so it was
never at risk. Left out of this PR to keep it single-issue per the standing issue-handling policy —
this is a distinct field family, not a re-occurrence of the same bug instance, and deserves its own
RED→GREEN proof against real condor-play fixtures rather than being folded in here.
