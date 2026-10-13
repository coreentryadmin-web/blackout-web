## 2026-10-13 — [Night Hawk Legacy] `target_unreachable` gate-promote rescue is dead code again — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Night Hawk Legacy / publish gates (thin-edition rescue) | P2 — directly caused today's "only 1 play" live board | FIXED |

### Symptom (live, reported by the operator)

Operator looked at the live `/nighthawk` Legacy board and asked why it was back to showing only
one open play. Today's (2026-10-13) edition published exactly 2 plays total (GME, PENG), and PENG
was invalidated pre-market (gapped through its stop), leaving 1. `EDITION_MIN_PUBLISH_PLAYS` is 3.

### Root cause

`publish-gates.ts` defines two constants:

```ts
export const GATE_TARGET_MAX_ATR_MULTIPLE = 2.0;         // G-N2: primary publish-time block
export const GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE = 2.0; // rescue cap for thin editions
```

`evaluateNighthawkPublishGates` only ever creates a `target_unreachable` block when
`targetAtrMultiple > GATE_TARGET_MAX_ATR_MULTIPLE` (2.0) — so every real block's `value` is, by
construction, always `> 2.0`. `isPromotableBlockedPlay` then disqualifies a `target_unreachable`
block from rescue when `v > GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE` (also 2.0). With both constants
equal, `v > 2.0` is true for every real block, so **the rescue path for `target_unreachable` was
100% dead in production** — no `target_unreachable`-only blocked play could ever be rescued,
regardless of how close to the threshold it was (2.001× behaves identically to 20×).

This is the identical shape to the already-documented `gatePromoteTargetUnreachableDeadCode_
2026_09_17T1730Z` finding (`docs/audit/nighthawk-legacy-live-journal.json` /
`docs/audit/FINDINGS.md`), which was fixed once (raising the rescue cap to 3.5 against a then-3.5
primary gate). `git log -S` on `GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE` shows the constant currently
in `main` was introduced fresh by the 2026-09/10 Legacy engine-overhaul PR (`7394c330c` /
`02720a972`, "Legacy engine overhaul + Vector follow-ups" / "Legacy deep audit: align engine
selection with measured track record"), which re-lowered the primary gate from 3.5 → 2.0 for
measured touch-rate reasons and introduced the rescue cap at the SAME new value (2.0) — an
independent reintroduction of the same defect shape, not a reversion of the earlier fix.

The code's own comment at the time even said the rescue cap is set "even lower... so thin editions
cannot resurrect unreachable targets" — describing a cap BELOW the primary (which would still
rescue nothing, just more obviously), but the actual shipped value was EQUAL to the primary, not
lower, and `NON_PROMOTABLE_GATE_CODES` deliberately excludes `target_unreachable` specifically
"blocking rescue on this gate is what caused the Jul 27 zero-play edition... A promoted
target_unreachable play carries a gate_warning... that is strictly better than an empty playbook" —
so the shipped calibration directly contradicted the surrounding code's own stated design intent.

### Live evidence (not hypothetical)

Pulled today's edition funnel via the admin candidate-leaderboard endpoint
(`GET /api/admin/nighthawk/candidate-leaderboard?edition_for=2026-10-13`): three candidates reached
`rank_governor` — **JBL (score 45, rank 1)**, GME (score 35, rank 3), PENG (score 31, rank 5). GME
and PENG published; **JBL, the single top-scored remaining candidate, was rejected at the
`publish_gate` stage and could never be rescued**, leaving the edition at 2 organic plays against
the 3-play floor. The admin candidate-coverage endpoint also shows `confluence_gate` alone already
rejects ~57% of all discovered candidates across the last 4 editions (108/188), so the funnel
arrives thin before the publish gates even run — making the dead rescue path the difference between
a 3-play edition and a 2-play one on a day like today.

### Fix

Raised `GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE` from `2.0` to `2.5` — the next point on
`target-reachability.ts`'s own measured one-session touch-rate curve above the 2.0× primary
threshold (~0.4% touch rate at 2.5× vs ~0.9% at 2.0×, which is already deemed acceptable for an
unconditional publish). This is not a fresh guess: it reuses the same already-measured,
already-documented curve the primary gate's own calibration comment cites, rather than picking an
arbitrary round number. Rewrote both constants' doc comments to state the structural invariant
plainly (rescue cap must stay strictly above the primary threshold or it is mathematically
guaranteed to rescue nothing) and to record this specific live incident so a future recalibration
of the primary gate doesn't silently drag the rescue cap down to match it a third time.

Added a regression test (`publish-gates.test.ts`) asserting
`GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE > GATE_TARGET_MAX_ATR_MULTIPLE` directly as a structural
invariant, independent of either constant's specific value — this is the test that would have
caught both the original 2026-09-17 instance and this one. Also corrected the existing
`"promoteTopBlocked promotes target_unreachable only when multiple ≤ rescue cap"` test, which used
a fixture `value: 1.8` — below the primary gate's own 2.0 threshold, a value that can never occur
from a real `target_unreachable` block — to `value: 2.2`, a value the real gate could actually
produce; the old fixture was giving false confidence that rescue worked using a scenario the real
pipeline cannot produce.

### Blast radius

Single call site consumes `GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE` (`isPromotableBlockedPlay`,
`publish-gates.ts`). No other file imports it (`grep -rl` confirmed). `promoteTopBlocked`'s other
rescue paths (score floor, tier floor, `NON_PROMOTABLE_GATE_CODES` for `band_detached`/
`geometry_unknown`/`book_tape_conflict`) are untouched. `GATE_TARGET_MAX_ATR_MULTIPLE` (the primary
G-N2 threshold) is untouched — this fix only widens what the RESCUE path can save on an
already-thin edition, it does not loosen what publishes organically.

### Verification

RED→GREEN via `git stash` on `publish-gates.ts` alone: the new invariant test and the corrected
rescue test both failed against the pre-fix constant (`2.0 > 2.0` is false), both pass after.
`npx tsx --experimental-test-module-mocks --test publish-gates.test.ts`: 36/36 pass post-fix.
Sibling suites (`edition-builder-scoring-snapshot`, `edition-builder-scoring-history`,
`play-backfill`, `edition-quality`, `candidate-leaderboard`, `target-reachability`): 98/98 pass.
`tsc --noEmit` clean. Full `npm test` run alongside this PR.

### Next-session market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md`: once this ships, the next overnight build that
produces a thin organic pool with a `target_unreachable`-only blocked top candidate should show
that candidate published as `gate_promoted: true` (capped at conviction B, carrying a
`gate_warnings` caveat) rather than silently dropped — check the candidate-leaderboard endpoint's
`promotion_status` for such a candidate flips from `REJECTED` to `ACTIVE` with `gate_promoted`.
