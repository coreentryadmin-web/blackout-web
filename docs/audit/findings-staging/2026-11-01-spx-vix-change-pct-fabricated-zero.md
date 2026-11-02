> **kind:** FINDING

## SPX desk: `vix_change_pct` transported Polygon's fabricated-0 artifact instead of being derived — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** live root-cause audit (2026-11-01), per the standing SPX performance/correctness
mandate — `src/features/spx/lib/spx-desk.ts`'s three desk builders transport `vix_change_pct`
straight from Polygon's raw index-snapshot `session.change_percent` with no validation, at
`buildSpxDesk()` (~line 1784 pre-fix), `buildSpxDeskPulse()` (~line 2328 pre-fix), and
`buildSpxDeskPulseMinimal()` (~line 2441 pre-fix).

**Root cause:** Polygon's `/v3/snapshot/indices` serves a FABRICATED `0` for `change_percent`
whenever no new session has started since the snapshot was last computed (every night after
close, every weekend, every holiday) — because Polygon sets `session.previous_close ===
session.close` in that state, a stale-anchor artifact, not a real "flat day." The sibling field
`spx_change_pct`, computed two lines above each of the three call sites, was NOT affected by this
bug because it is DERIVED rather than transported: `pulseChangePctFromPriorClose(price, prior.pdc,
spxSnap?.change_pct)` (`spx-change-anchor.ts`) independently re-derives the day's percent change
from a prior-session close obtained from real daily OHLC bars
(`latestSessionAndItsOwnPrior`/`priorDayFromDailyBars`, fed `fetchIndexDailyBars(SPX, ...)`)
rather than trusting Polygon's transported `session.previous_close`. VIX had no equivalent
daily-bars-derived prior-close fetch anywhere in these three builder functions, so its
`change_pct` was transported raw and inherited Polygon's artifact.

**Live evidence (2026-11-01, Sunday, market closed):** `GET /api/market/spx/desk` returned
`{"vix": 19.42, "vix_change_pct": 0, "spx_change_pct": -1.82}`. Direct Polygon
`/v3/snapshot/indices` confirmed both `I:VIX` and `I:SPX` show the same
`previous_close === close` artifact (`change_percent: 0` for both) — yet `spx_change_pct` came out
correct (-1.82%) because of the derivation above, while `vix_change_pct` did not. Direct Polygon
daily bars for `I:VIX` showed the two real most recent sessions: Thu 2026-10-29 close 17.20, Fri
2026-10-30 close 19.42 → true day-over-day VIX change ≈ +12.9%, not 0.

**Fix:** applied the same "derive, don't transport" treatment VIX's sibling field already has.
Added a VIX-specific daily-bars-derived prior-close pair, mirroring the existing SPX pattern
exactly rather than inventing a new mechanism:
- `buildSpxDesk()`: fetches `dailyBarsVix` (`fetchIndexDailyBars(VIX, fromWeek, today)`) alongside
  the existing SPX `dailyBars` fetch, derives `priorFromBarsVix` with the identical RTH-aware
  anchor conditional `priorFromBars` already uses, and computes
  `vix_change_pct: pulseChangePctFromPriorClose(vixSnap?.price ?? null, priorVix.pdc,
  vixSnap?.change_pct) ?? intel?.vix_change_pct ?? null` — same fallback chain shape as before,
  only the live-value computation changed.
- `buildSpxDeskPulse()`/`buildSpxDeskPulseMinimal()`: added `vixPriorDayForPulseLane()` /
  `fetchVixPriorDayCached()` — VIX siblings of the existing `priorDayForPulseLane()` /
  `fetchPriorDayCached()` (same 60s-TTL serve-stale-then-refresh-in-background cache shape, same
  "never block cold" discipline `buildSpxDeskPulseMinimal`'s own header requires). On a true cold
  start (cache never populated) this returns `pdc: null`, and `pulseChangePctFromPriorClose` falls
  back to the raw transported value — never worse than pre-fix behavior, only better once the
  cache warms (typically within one Polygon round trip, kicked off by the same call).

**Fix rationale — why a separate VIX cache rather than a generic per-ticker helper:** SPX's
existing prior-close functions (`fetchPriorDayCached`/`priorDayForPulseLane`) carry several
hard-won, heavily-commented edge-case fixes (midnight-rollover anchoring, EXTENDED-hours override,
cross-midnight re-snapshot) accumulated over many live incidents. Parameterizing them by ticker
in-place would risk regressing that history for no benefit, since VIX needs the exact same
RTH-aware anchor *strategy* but not the EXTENDED/midnight-rollover *overrides* those functions
layer on top for SPX's own price-display needs (VIX's `change_pct` only ever needs `pdc`, never
`pdh`/`pdl`-as-displayed-price tricks). Duplicating the small, stable fetch-and-derive core
(`fetchIndexDailyBars` + the same `priorDayFromDailyBars`/`latestSessionAndItsOwnPrior`
conditional) into a parallel, independent VIX cache keeps the blast radius isolated to VIX's own
new code path while reusing every actual derivation primitive (`pulseChangePctFromPriorClose`,
`priorDayFromDailyBars`, `latestSessionAndItsOwnPrior`) rather than reimplementing them.

**Evidence (RED → GREEN):** extended 3 test files with wiring/arithmetic proofs, then reverted
`spx-desk.ts` to its pre-fix `HEAD` content (keeping the new tests) to get a true RED baseline:
- `spx-change-anchor.test.ts`: new pure-arithmetic test reproducing the live VIX repro numbers
  (price 19.42, true prior close 17.20, Polygon's fabricated 0) through the already-exported
  `pulseChangePctFromPriorClose` — asserts the derived value is ≠ 0 and ≈ the real ~+12.9% move.
  This one stays green before and after the wiring fix (it tests the pure function in isolation),
  which is why the wiring-level tests below are what actually prove RED → GREEN for the bug.
- `spx-desk-offhours-spot.test.ts`: new source-wiring test for `buildSpxDesk` asserting
  `priorFromBarsVix` exists and `vix_change_pct` is computed via `pulseChangePctFromPriorClose`.
- `spx-pulse-change-basis.test.ts`: two new source-wiring tests for `buildSpxDeskPulse` and
  `buildSpxDeskPulseMinimal`, same assertion shape.

RED (pre-fix `spx-desk.ts`, new tests applied): 3/3 new wiring tests FAIL (`not ok`) — confirmed via
`npx tsx --experimental-test-module-mocks --test` across the three files, 30 pass / 3 fail.
GREEN (post-fix): same run, 33/33 pass. Full regression sweep across all spx-desk-related
regex-based test files (`spx-change-anchor`, `spx-pulse-change-basis`, `spx-desk-offhours-spot`,
`spx-desk-inprocess-cache-freshness`, `spx-desk-closed-placeholder`, `spx-desk-ws-freshness`,
`spx-desk-merge`): 65/65 pass. `npx tsc --noEmit`: clean (Node 20, `/opt/node20/bin`).

**Blast radius — consumers that inherited the bad value, now corrected at the source with no
further changes needed:**
- `src/lib/admin-spx-dashboard.ts` (`volatility.vix_change_pct`) — reads `desk.vix_change_pct`
  straight through.
- `src/lib/bie/spx-desk-brief.ts` / `src/lib/bie/spx-desk-intel.ts` — both gate on
  `Math.abs(desk.vix_change_pct)` before narrating a VIX move in Ask Largo's SPX brief; a
  fabricated `0` silently dropped a genuinely large VIX spike/drop from the narrative on every
  off-hours/weekend/holiday read.
- `src/lib/bie/spx-live-voice.ts` (`vixChangePct: num(desk.vix_change_pct)`).
- `src/features/spx/lib/spx-desk-merge.ts`'s `mergePulseIntoDesk` — passes `pulse.vix_change_pct`
  (or `base.vix_change_pct`) straight through whenever the corresponding `vix` itself is live, so
  it does not need its own fix; it now carries the corrected value automatically.
No other call sites of `vix_change_pct` exist outside these read-only consumers and the three
builders fixed here.
