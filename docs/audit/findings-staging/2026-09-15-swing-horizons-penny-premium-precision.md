> **kind:** FINDING

## Swing horizons board: 2dp premium rounding disagrees with the API's own `livePnlPct` for penny-priced Banger-origin contracts — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `GET /api/market/nighthawk/horizons` wraps its whole response in
`roundFloats(payload)` with no per-key overrides, so `contract.mid`/`entryPremium`/`peakPremium`
are rounded to the plain 2dp default before serialization. `livePnlPct`, however, is computed
upstream in `banger-lane-merge.ts`'s `livePnlPct(entry, mark)` from the RAW (unrounded) `entry`
and `mark` values pulled straight off the `banger_positions` DB row — that computation happens
before this route's `roundFloats` call ever runs, so the two never see the same precision. For a
normal multi-dollar contract 2dp rounding is invisible; for a sub-$1 Banger-origin contract
(these routinely price at $0.10-$0.30) it produces a visible arithmetic mismatch between two
fields sitting next to each other in the same response.

**Evidence (live reproduction, 2026-09-15, RBLU, Swing Command board, COMMIT bucket):** raw mark
`0.125` rounds to displayed `contract.mid: 0.13`, entry is `0.15`. A member reading "entry $0.15,
mark $0.13" and computing `(0.13-0.15)/0.15` gets **-13.3%**, but the same response's own
`livePnlPct` field (computed from the real 0.125) reports **-16.7%** — a 3.4-point disagreement
between two numbers presented as describing the same position. Checked 4 other live committed
positions in the same board fetch: 3/4 (AAPL ×2, NN) matched exactly because their raw
entry/mark values happened to round cleanly at 2dp; RBLU was the one that didn't, confirming this
is a precision-loss bug specific to penny-priced contracts, not a systemic math error in
`livePnlPct` itself.

**Blast radius:** every Banger-origin (penny-priced) row on the Swing Command board — currently
the dominant population of the committed lane (80+/85 committed rows are Banger-origin per this
session's own audit). Any consumer reading `contract.mid`/`entryPremium`/`peakPremium` directly
off this route's JSON (the board UI) sees the same disagreement; the Ask Largo play-brief's own
markdown narration is unaffected (it formats premiums from the same raw pre-rounding values at
generation time, not from this route's rounded JSON).

**Fix:** added a `keyDp` override to this route's `roundFloats` call —
`{ mid: 4, entryPremium: 4, peakPremium: 4 }` — so these three premium fields keep 4 decimal
places instead of the plain 2dp default. This is the same per-key-precision mechanism
`round-floats.ts` already documents and uses for option greeks (gamma needs 4dp or a 2dp default
quantizes it to `0.00`); option premiums for sub-$1 contracts need the identical treatment.

**Fix rationale:** minimal, single call-site change — `roundFloats` already supports per-key
overrides exactly for this "mixed scale" problem, so no new rounding logic was written. Left
`livePnlPct` and every other field on the plain 2dp default; nothing else in this payload has a
comparable precision-vs-display coupling.

**Test:** RED→GREEN proven — new regression test in
`src/app/api/market/nighthawk/horizons/route.test.ts` injects a penny-priced committed play
(entry `0.15`, mark `0.125`, `livePnlPct -16.7`, the live-repro'd RBLU values) into the mocked
swing lane and asserts that recomputing `(mid/entry - 1) * 100` from the route's own output stays
within 0.5 points of the route's own `livePnlPct`. Confirmed failing (`-13.3%` vs `-16.7%`, a
3.4-point gap) before the fix, passing after. Full `route.test.ts` (6 tests) and
`round-floats.test.ts` (25 tests) green, `tsc --noEmit` clean.
