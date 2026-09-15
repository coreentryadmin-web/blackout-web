> **kind:** FINDING

## Night Hawk Legacy's cold-cache positioning fallback still had the null-flip-is-not-null-regime gap fixed on the warm path — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** PR #5012 (this session, merged earlier today) fixed `fetchPositioningSummary`'s
warm/cache-hit path (`src/features/nighthawk/lib/positioning.ts`) so a null gamma flip caused by
`net_short_everywhere` (dealers net short at every strike — a real, unambiguous SHORT-gamma read,
not missing data, per `gex-cross-validation-core.ts`'s `buildGexRegime` fix on 2026-08-20) resolves
to `"amplification"` instead of `"unknown"`. That PR's own write-up explicitly deferred the COLD-
CACHE fallback path (`buildSummary`, fed by `fetchPolygonPositioningBundle` when the shared GEX
cache is unavailable) as "a separate, slightly larger change" to keep the fix single-issue.

`buildSummary` computed its regime via `gammaRegime(spot, computeGammaFlip(...))` — and
`computeGammaFlip` (`src/lib/providers/gamma-desk.ts`) collapsed the null-flip case to a bare
`number | null`, discarding the `GammaFlipReason` (`resolved` / `insufficient_strikes` /
`net_short_everywhere` / `crossings_far_from_spot`) that `cumulativeGammaFlipDetail`
(`gex-cross-validation-core.ts`) already computes underneath it. So the fallback path had the exact
same "unknown" blind spot the warm path just had fixed — any ticker whose positioning summary is
built via the cold-cache path (shared matrix cache miss/unavailable) would still show `"unknown"`
for a real net-short-everywhere book.

**Evidence:** traced `computeGammaFlip`'s implementation — confirmed it delegates to
`cumulativeGammaFlip(strikeTotals, spot)`, which is itself `cumulativeGammaFlipDetail(...).flip`
(the reason is computed and then thrown away one call up). Wrote a regression test forcing the
fallback path (mocking `getGexPositioning` to return `null`, `polygonConfigured` to `true`, and
`fetchPolygonPositioningBundle` to return an all-net-short-gamma row set — strikes 90/100/110 with
`put_gamma_oi` -10/-20/-5 and no `call_gamma_oi`, which never lets the cumulative sum turn
positive). RED→GREEN proved via `git stash` on `gamma-desk.ts` + `positioning.ts`: pre-fix returns
`gamma_regime: "unknown"`, post-fix `"amplification"`.

**Blast radius:** `buildSummary` is Legacy's fallback for the SAME two callers PR #5012 already
covered on the warm path — the public `/api/market/nighthawk/legacy-marks`-adjacent dossier build
and `fetchLegacyOptionMarksServer` consumers via `positioning.ts`'s single `fetchPositioningSummary`
entry point. `computeGammaFlip` also has one other caller,
`src/app/api/market/gex-positioning/route.ts` — untouched, since the refactor preserves
`computeGammaFlip`'s exact return value (proven by its own existing 19 tests across
`gamma-desk.test.ts`/`gamma-desk.flip.test.ts` passing unchanged).

**Fix:**
1. Extracted `computeGammaFlipDetail(levels, spot)` in `gamma-desk.ts` — same strike-totals
   conversion `computeGammaFlip` already did, but delegates to `cumulativeGammaFlipDetail` instead
   of `cumulativeGammaFlip`, returning the full `GammaFlipDetail` (flip + reason + crossings).
   `computeGammaFlip` now delegates to it (`computeGammaFlipDetail(levels, spot).flip`) —
   byte-identical behavior, proven by the existing test suite passing unchanged.
2. `buildSummary` now calls `computeGammaFlipDetail` and applies the same rule PR #5012 shipped for
   the warm path: `flip != null ? gammaRegime(spot, flip) : reason === "net_short_everywhere" ?
   "amplification" : "unknown"`.

**Fix rationale:** identical pattern to PR #5012 — extract a generic "detail" function so both the
warm (`gamma_posture` from the shared cache) and cold (`computeGammaFlipDetail`'s own `reason`)
paths reuse the same underlying flip-reason computation rather than duplicating or drifting from
each other. The flip-present branch is untouched in both paths, preserving `gammaRegime`'s exact
`spot > flip` boundary semantics.

**Test:** `src/features/nighthawk/lib/positioning.test.ts` — 2 new tests: an all-net-short-gamma
cold-cache book resolves to `"amplification"`; a real flip crossing on the cold-cache path still
resolves via unchanged `gammaRegime` logic (`"mean_revert"` at spot above the crossing). RED→GREEN
proved via `git stash` on `gamma-desk.ts` + `positioning.ts`. `npx tsc --noEmit` clean. Full local
Node 20 suite run alongside this change (see PR).
