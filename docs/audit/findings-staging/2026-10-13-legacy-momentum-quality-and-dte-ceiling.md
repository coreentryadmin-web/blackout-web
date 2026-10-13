## 2026-10-13 — [Night Hawk Legacy] Momentum-quality scoring (acceleration + sustained-vs-exhausted) + 10-DTE ceiling — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Night Hawk Legacy / candidate scoring + contract selection | P3 — real product-quality gap, operator-requested | FIXED |

### What was missing

Operator asked Legacy to rank candidates on "relative volume, price acceleration, trend
structure, breakout/breakdown confirmation... distinguish sustained moves from exhausted spikes,"
then select "liquid 2-10 DTE contracts." Audited the current pipeline (`scorer.ts`,
`technicals.ts`, `deterministic-edition.ts`) against each named criterion before writing anything:

Already covered: relative volume, trend structure, breakout/breakdown confirmation
(`scoreTechnicalSetup`), options flow + dealer positioning (`flow_score`/`pos_score`/
`wall_proximity_score`/`vex_alignment_score`).

Genuinely missing (grepped the whole scorer directory — zero matches for any acceleration or
exhaustion concept): **price acceleration** and **distinguishing sustained moves from exhausted
spikes**. Also confirmed missing: the **10-DTE ceiling** — `pickChainContract`'s own doc comment
already named "2-10 DTE" as the product requirement and the 2-day floor (`MIN_DTE_CALENDAR_DAYS`)
was real, but nothing enforced the ceiling; every expiry was pooled together and sorted by
strike-distance-to-spot first, so a far-dated monthly whose strike happened to sit nearest to spot
could win outright over a genuine 2-10 DTE weekly.

### Fix

**`momentum-quality.ts`** (new): pure, direction-aware scoring of price acceleration (recent
3-day return vs. the prior 3-day return, same-direction only — a sign flip is a reversal, not a
deceleration, handled explicitly) and volume pattern (today's volume elevated alongside 2+ of the
prior 3 sessions = `sustained`; today alone elevated = `single_day_spike`, the exhaustion
signature). Computed entirely from `TechnicalCard`'s already-fetched `daily_bars` (60 sessions) —
zero new per-ticker network calls, deliberately, because a live 2026-10-12 incident (see the
`fix/legacy-target-rescue-dead-cap` finding, same session) traced 6 of 20 candidates dropping out
of an edition entirely to a 45s per-ticker dossier wall timeout; a new fetch here would make that
exact failure mode worse. Wired additively into `scorer.ts`'s composite (`momentum_score`, bounded
+8/-5) and into both `factor_breakdown` call sites in `deterministic-edition.ts` so it's visible in
the member-facing "why this play was picked" panel.

**10-DTE ceiling** (`deterministic-edition.ts`): added `MAX_DTE_CALENDAR_DAYS = 10` and a
`longDated` last-resort pool mirroring the floor's existing `shortDated` treatment — never a hard
exclusion, just deprioritized behind anything inside the 2-10 DTE window. Extended the
`preferAffordable` cost-preference tier (every Legacy call site opts in) with matching `longDated`
passes preserving its existing liquidity-safety-first priority — 4 existing tests caught this when
the ceiling alone silently broke that guarantee for chains whose only deeply-liquid expiries sat
outside the window.

### Live verification against real market data (not hypothetical)

Ran the new `computeMomentumQuality`/`scoreMomentumQuality` against real Polygon daily bars for
today's (2026-10-13) actual 42-ticker discovery pool (pulled from the admin candidate-leaderboard
endpoint). Two concrete, retrospectively-checkable results:

- **FIGS** scored the maximum +8 (accelerating +20.2% over the last 3 sessions, up from +9.9% the
  prior 3 — genuinely sustained volume, 2+ of the prior 3 sessions elevated) — yet the CURRENT
  composite score ranked it only #10 (score 16) in tonight's real build. The new signal would have
  surfaced the single strongest momentum name in the pool, which the current system ranked near
  the bottom.
- **PENG** — one of only 2 organic plays that actually published tonight (via the merit-floor
  backfill path, which deliberately skips the score/tier floor) — scored -3 (decelerating: +9.3%
  recent vs. +17.9% prior, the move visibly losing steam). PENG was invalidated pre-market the same
  morning (gapped through its own stop). The new signal would have flagged exactly this candidate
  as weakening before the real-world failure, while GME (the other published play, +5, genuinely
  accelerating) stayed open and confirmed.

### Scoped out, disclosed, not fixed here

- **Relative strength vs. the broader market** (RS vs. SPY/sector) — a real, separate gap. Needs a
  shared SPY-bars fetch threaded through `market-wide.ts` → `edition-builder.ts` → `scorer.ts`
  (not a per-ticker fetch, which would reintroduce the dossier-timeout risk above). Flagged as a
  scoped follow-up.
- **"Reasonable spread" liquidity gate** — `contractPremium`'s only spread check rejects a quote
  wider than 100% of its own mid (a broken-data sanity floor, not a tradeable-spread bar). A
  genuinely wide-but-under-100% spread (60-90% of mid) still passes today.

### Verification

`momentum-quality.test.ts`: 16/16. `deterministic-edition.test.ts`: 87/87 (2 new DTE-ceiling
tests, RED→GREEN proven via `git stash`: failed against the pre-fix picker, pass after; 1 stale
comment fix; 4 existing `preferAffordable` tests needed the `longDated` passes to stay green).
Full `src/features/nighthawk` test directory: 2036/2036. `tsc --noEmit` clean. Full `npm test`
alongside PR #5964.
