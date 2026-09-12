# trim_scale's TREND-regime dead zone still dumped a double-digit peak to flat breakeven — the 2026-08-27 fix's own documented residual gap, now closed with a graduated floor — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P1-trim-scale-trend-dead-zone-partial-floor |
| **Priority** | P1 — real trade P&L, live 0DTE exit engine, A/B-tier default profit-management mode |
| **Area** | `src/lib/zerodte/exit-engine.ts` — `decideTrimScale` (Night Hawk 0DTE, `trim_scale` exit mode) |
| **Status** | FIXED |

## Prior context (this is a fix of an already-documented, already-measured gap, not a new discovery)

`FINDINGS.md`'s **"trim_scale's shared breakeven floor preempted its own trim tranche — SLS/TSM
round-tripped +22% peaks to flat — FIXED"** (2026-08-27, `fix/trim-scale-floor-dead-zone`) closed
the neutral/range dead zone but explicitly flagged one it did NOT close, under "What this does NOT
fix (documented, not a regression)": *"`trend` regime's gap between its breakeven arm (peak +20%)
and its own first tranche (peak +40%) is a genuinely **unarmed** window ... a `trend` peak sitting
at 20-39% that retraces to breakeven still exits via the shared floor exactly as before. That is a
calibration question ... flagged for whoever next tunes the regime thresholds."*

`docs/audit/0DTE-RESEARCH.md`'s **"the regime-conditioned trend dead-zone"** (2026-09-04) measured
this live and confirmed it was still firing in production: a 90-day sweep of
`GET /api/market/zerodte/record?days=90` found **37/372 graded 0DTE plays (9.9%) exited via
`ratchet_breakeven_floor` after a median +26.67% peak (up to +48.56%)** — concrete examples BULL
(2026-09-03, +20.45%→0%) and CLS (2026-09-03, +31.18%→0%). That entry ended "No gate changed" —
`scripts/audit/regime-dead-zone-ab.mjs` was built to A/B two candidate fixes (FIX A: lower trend's
own tranche threshold; FIX B: a partial floor inside the dead zone) but the live population had only
3 real `trend`-regime rows at the time, "0-3 real trend samples" being judged too thin to size a
risk-management change against, with an explicit "re-run in 2-3 weeks" note.

**This session verified the bug is still live on `main` today (2026-09-12, 8 days after the
measurement, short of the "2-3 weeks" re-run window)** by reading `decideTrimScale` directly:
`ratchetFloorPct`'s breakeven arm is still the fixed `EXIT_RULES.ratchet_arm_pnl_pct = 20` for every
regime, `TRIM_SCALE_RULES.tranches_by_regime.trend[0]` is still `40`, and the existing test suite's
own `"trim_scale DEAD ZONE per regime — TREND: ..."` test still asserted the old behavior
(`action: "EXIT", reason: "ratchet_breakeven_floor"` for a trend peak of +20% retraced to 0%) as
"intentional (trend deliberately runs longer before its first trim)" — i.e. the gap was confirmed
unfixed, not stale documentation.

## Root cause (mechanism, restated precisely)

`ratchetFloorPct` and `TRIM_SCALE_RULES.tranches_by_regime` are two INDEPENDENT threshold tables.
The shared floor's breakeven arm is a flat peak +20% regardless of regime; `trim_scale`'s own first
tranche trigger is regime-conditioned (neutral +20, range +15, trend +40). For neutral/range the two
tables coincide or cross AT OR BEFORE +20%, so a peak high enough to arm the shared floor has also
armed (or is about to arm) a real tranche — the 2026-08-27 `trimAvailable` guard covers that case by
banking the tranche instead of letting the floor dump the position. `trend` cannot benefit from that
guard: its first tranche is +40%, so for ANY peak in [20%, 40%) no tranche is armed yet, the guard
never engages, and the plain `ratchetFloorPct` (flat 0% once armed) was the ONLY protection — dumping
the WHOLE position to breakeven and giving back 100% of a real double-digit peak, precisely in the
window where `trend`'s own "let it run" schedule hadn't reached its first real trim.

## Fix

Added `trimScaleFloorPct(peakPnlPct, trimmed, regime)` (`exit-engine.ts`), used ONLY by
`decideTrimScale` in place of `ratchetFloorPct` for its `sharedFloor` computation. Inside a regime's
OWN genuine dead zone — `[EXIT_RULES.ratchet_arm_pnl_pct, tranches_by_regime[regime][0])`, non-empty
only when the regime's first tranche sits above the shared arm point (`trend` today) — it floors at
**half the peak** instead of flat 0%. Outside that window it delegates straight to `ratchetFloorPct`,
so it is byte-identical everywhere else (every neutral/range peak; every trend peak before +20% or
at/after +40%; the lock tier at peak ≥ +50%; the post-trim runner-floor latch).

A new machine-readable reason, `trim_scale_dead_zone_floor`, is stamped on an EXIT via this specific
tier — distinct from `ratchet_breakeven_floor`/`ratchet_early_profit_floor`/`ratchet_profit_floor`,
so this mechanism stays independently greppable/auditable in the ledger going forward rather than
folding into the pre-existing reason buckets.

**Blast radius catch, fixed in the same PR:** `categorizeExitReason` (also `exit-engine.ts`) maps the
member-facing `closed_reason`/`exit_reason` category, and its existing rule buckets ANY reason
starting with `"trim_scale"` as `"target"` (profit-taking) — correct for `trim_scale_first`/
`trim_scale_second`/`trim_scale_runner_target`, but the new `trim_scale_dead_zone_floor` also starts
with that prefix despite being a PROTECTIVE floor exit (giving back half a peak), not a target hit.
Left as-is, a member would see this exit labeled/styled as "hit target" on the board when it is
really the same family as an ordinary ratchet floor exit. Added an explicit case ahead of the prefix
check so `trim_scale_dead_zone_floor` → `"ratchet"`, with its own regression test (both a direct
`categorizeExitReason` call and a round-trip through a real `evaluateExitState` EXIT decision).

## Fix rationale — why this (FIX B), not the alternative (FIX A)

Two candidates existed (both already scaffolded in `scripts/audit/regime-dead-zone-ab.mjs` from the
2026-09-04 measurement):
- **FIX A** — lower `trim_scale`'s own `tranches_by_regime.trend[0]` to +20% (matching the shared
  arm point, the same way neutral already does). This is a **calibration change** to the trim
  schedule itself — it would make `trend` start trimming earlier, contradicting the regime's whole
  documented design intent ("`trend` lets a runner run — later/looser trims — don't scratch a
  trend-day momentum leg"), and per this repo's own standing discipline
  (`docs/audit/0DTE-RESEARCH.md`'s "No gate changed... deserves more than 0-3 real trend samples"),
  changing a regime-conditioned schedule threshold on a still-thin live population is exactly the
  kind of risk-management surgery this repo requires more evidence before shipping.
- **FIX B (shipped)** — a partial floor INSIDE the dead zone, leaving `tranches_by_regime.trend`
  (`[40, 80]`) completely untouched. This is not a recalibration of the trim schedule at all; it is
  closing a defect in the FLOOR mechanism (a flat-0% wipe with zero graduated protection) using a
  principle the codebase already applies one tier higher (`ratchet_lock_pnl_pct`/
  `ratchet_lock_floor_pct`: the floor rises from breakeven to +20% once peak ≥ +50%, rather than
  staying flat) — "the floor should scale with how much was earned," not a new tuning invented for
  this fix. It requires zero additional live sample size to justify, because it doesn't change WHEN
  a real tranche arms or how much of the position it banks — only what happens to the UN-banked
  remainder while genuinely waiting for the first tranche, which was previously "give back
  everything" and is now "give back at most half."

**What was deliberately NOT changed:** `TRIM_SCALE_RULES.tranches_by_regime` (all three regimes,
byte-identical); `ratchetFloorPct` itself (unchanged, still used byte-for-byte by ratchet-mode rows
via `evaluateExitState`'s `mode === "ratchet"` branch, and by the board's own display floor in
`zerodte-service.ts` — neither call site is touched by this fix); the 2026-08-27 `trimAvailable`
dead-zone guard and its neutral/range coverage (untouched, still exactly as before); the
STOP-BREACH CARVE-OUT (2026-09-04) that forces `trimAvailable` false on a raw plan-stop breach
(untouched — a stop breach still always exits, now potentially at the new, higher dead-zone floor
mark if that sits above the raw stop, exactly the same "higher mark wins" precedence as before).

**Blast radius / known follow-up left open, not fixed here (single-issue PR discipline):**
`zerodte-service.ts`'s board display floor (`floorPnlPct` on the ledger row, "your stop is now at
X%") still computes via plain `ratchetFloorPct(peakPnlPct, ratchetTargetReached(...))`, with no
regime awareness at all — this was ALREADY true before this fix (it doesn't reflect trim_scale's
own regime-conditioned schedule at all, e.g. it never showed the neutral/range dead-zone-guard's
banking either), so this fix does not introduce a NEW display/engine divergence, it just leaves an
existing one unwidened. Making that display trend-aware would need `exitMode`/`regime` threaded into
that call site (currently absent) and is out of scope for this single-issue PR; flagged here for a
follow-up rather than silently expanding this PR's surface.

## Evidence

RED→GREEN, `src/lib/zerodte/exit-engine.test.ts` (git-stash technique — `exit-engine.ts` alone
stashed out, test file kept, both re-verified before/after):
- **Pre-fix** (production code reverted to `origin/main` via `git stash`, test file kept): `npx tsx
  --experimental-test-module-mocks --test src/lib/zerodte/exit-engine.test.ts` — **81 pass / 5 fail**:
  the updated TREND dead-zone test (expects the graduated floor, not flat breakeven), the new
  BULL/CLS live-shape test, the new `trimScaleFloorPct` unit-coverage test (import of a function that
  doesn't exist yet on the reverted engine), and the two `categorizeExitReason` tests covering the
  new `trim_scale_dead_zone_floor` → `"ratchet"` mapping.
- **Post-fix**: same file — **86 pass / 0 fail**.
- `src/lib/zerodte/exit-engine.test.ts` + `exit-sync.test.ts` + `scan.test.ts` + `board.test.ts` +
  `zerodte-service.test.ts` + `zerodte-service-marks.test.ts` — **297 pass / 0 fail** (no other
  consumer of `ratchetFloorPct`/`decideTrimScale` regressed).
- `npx tsc --noEmit` — clean.
- Full `npm test` (Node 20) — pending final confirmation in the PR (see PR checks); no failures
  observed in the scoped runs above, and the change is additive/one-call-site-scoped.

Concrete numeric proof (mirroring the live BULL/CLS examples from the 2026-09-04 measurement): a
`trend`-regime peak of **+20.45%** (BULL's shape) retraced to breakeven now floors at **+10.23%**
instead of flat 0%; a peak of **+31.18%** (CLS's shape) floors at **+15.59%** — the position still
cannot finish red (same invariant as before), but no longer gives back its ENTIRE peak while waiting
for `trend`'s own first real tranche at +40%.
