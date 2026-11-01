> **kind:** FINDING

## Ask Largo swing play-brief: "Underlying excursion since entry" (and its narrative sibling) computed from a different, stale cron-cached spot than every other "current spot" in the same brief — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** workflow task, Ask Largo x Night Hawk Swings standing mandate (confirmed live,
META SWING:META:69 — a real open COMMIT position, and TSM WATCH).

**Confirmed bug (live repro):** META's `GET /api/market/swing/play-brief` showed the Management
section's "Underlying excursion since entry: **+0.2% favorable** / **-2.4% adverse**" with NO
staleness caveat, while the SAME response's own displayed spot read 614.00 everywhere else
(`envelope.levels[0]={label:'spot',price:614,source:'Vector'}`, `structureLadder.spot:614`). The
excursion figure (mfePct 0.15 / maePct -2.35 before rounding) was byte-identical to
`GET /api/market/nighthawk/horizons`'s own `underlyingExcursion` for the same `positionId=69`,
whose own `liveSpot` field confirms it was computed off spot **615.49** — a $1.49 gap on the same
ticker within the same closed-market minute, so not real price movement. TSM (WATCH bucket) showed
the identical shape (cron-cached 406.74 vs this brief's own displayed 408.79).

**Root cause:** `play.underlyingExcursion` is computed upstream at RESOLVE time
(`src/lib/swing/play-brief-resolve.ts`'s `loadOpenTerminalPlay` → `live-plays.ts`'s
`livePlayFromSwingPosition`) off a `spot` parameter that traces (play-brief-resolve.ts:389:
`const spot = snap?.spotsByTicker?.[ticker.toUpperCase()] ?? null;`) to the periodically-refreshed
swing-active-refresh/swing-discovery cron's persisted serving-snapshot cache
(`readSwingServingSnapshot()`) — a COMPLETELY DIFFERENT spot resolution than the fresh, per-request
Vector/GEX spot `src/lib/swing/play-brief.ts`'s `levelsFromContext` resolves for this SAME
response's `envelope.levels[0]`/`structureLadder.spot` (play-brief.ts:1360-1361:
`const vecSpot = vectorStale ? undefined : vec?.spot; const spot = vecSpot ?? (gexStale ? undefined
: gex?.spot);`). Two independent spot resolutions feeding two different displayed numbers in one
response.

This is the SAME bug class the 2026-10-21 fix already closed for the WATCH bucket's "Since flag"
line (`watchForSection`, `play-brief-intel.ts`) — that fix's own comment explicitly scoped itself to
"this section" and left every other reader of `play.liveSpot`/`play.underlyingExcursion` untouched.
`#6836` (2026-10-26) separately reconciled `underlyingExcursion` against the SAME spot's own PRIOR
snapshot extremes (fixing snapshot-vs-request-time spot, both from the SAME cron cache) but never
addressed that the spot itself is the stale cron cache rather than the fresh Vector/GEX read the
brief displays everywhere else.

**Blast radius — a SECOND call site read `play.underlyingExcursion` raw, with the identical
exposure:** `src/lib/swing/play-brief-narrative-coaching.ts`'s `ivLeverageDivergenceCoaching`
("Option down/up more than the stock's own move would suggest" — Trade manager read, OPEN bucket)
also compared the option's P&L against the raw, potentially-stale `play.underlyingExcursion`. Fixed
both from one shared implementation.

**Fix:** added `freshUnderlyingExcursion(excursion, entryPx, direction, freshSpot)` to
`src/lib/swing/play-brief-absence.ts` (shared by both call sites, so they can never drift apart).
It reconstructs the prior ratcheted price extremes (the real `row.underlying_mfe`/
`row.underlying_mae` price columns aren't threaded onto `TerminalPlay` — only the already-pct-
converted `underlyingExcursion` is) by reversing `signedExcursionPct`'s own
`pct(px) = (px-entry)/entry*100`, which recovers the EXACT price that produced the existing
(possibly stale) mfePct/maePct, then folds the FRESH spot in on top via `signedExcursionPct` itself
(`hi = max(priorMfePx, spot, entry)`) — this can only grow the ratchet, never shrink it, so the
recompute is mathematically exact, not an approximation. Falls back to the existing (possibly
stale) value when the entry price or a fresh spot isn't available — same "recompute when possible,
else fall back silently" discipline the 2026-10-21 WATCH-bucket fix already established.

- `play-brief.ts`'s `managementSection` now resolves the SAME fresh Vector/GEX spot
  `levelsFromContext` resolves (`freshSpotForManagementExcursion`, a second independently-computed
  copy of that two-line formula, matching the existing pattern `watchForSection` already
  established) and feeds it through `freshUnderlyingExcursion` before rendering the line.
- `play-brief-narrative-coaching.ts`'s `ivLeverageDivergenceCoaching` gained an optional 4th
  (actually 3rd positional) `spot` parameter, defaulting to `null` so every existing 2-arg call site
  keeps working unchanged; `collectCoachingBullets` (which already resolves this exact fresh spot
  for its own use) now threads it through.

**Tests:** `src/lib/swing/play-brief.test.ts` — two new tests proving the Management section
recomputes against a fresh spot (RED before the fix: asserted `-2.0% adverse`, stale; GREEN after:
`-3.0% adverse`, fresh) and falls back cleanly when no fresh spot is available.
`src/lib/swing/play-brief-narrative-coaching.test.ts` — two new tests for the same recompute/
fallback behavior in `ivLeverageDivergenceCoaching`. Full `src/lib/swing/*.test.ts` suite (2193
tests) and `tsc --noEmit` both clean on Node 20.
