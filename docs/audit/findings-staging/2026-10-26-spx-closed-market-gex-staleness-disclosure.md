> **kind:** `FINDING`

## SPX closed-market `/play` served a specific GEX-derived trade idea sourced from up-to-24h-stale GEX data with ZERO staleness disclosure — FIXED

| | |
|---|---|
| **Severity** | P2 (member-facing data-honesty gap — a live-looking, specific trade idea ["At 0DTE support node 7675 (+2 pts)"] presented with no indication the underlying GEX layer could be hours old; no incorrect trading decision was possible from this alone since it's the closed-market SCANNING branch, no BUY/SELL action, but it violates the Largo product contract's absence/freshness principle) |
| **Surface** | `src/features/spx/lib/spx-play-engine.ts` — the closed-market branch of `evaluateSpxPlayCore` (`!desk.market_open && !premarket`, no open play) — consumed by every closed-market poll of `GET /api/market/spx/play` and by Ask Largo's SPX read |
| **Status** | FIXED |

### Root cause

When the market is closed, `evaluateSpxPlayCore` builds a "Session closed" SCANNING payload off
`computeSpxConfluence(desk)` (`spx-signals.ts`). That function's `buildLevels()` reads
`desk.gex_walls` directly to construct the "GEX support"/"GEX resistance"/"King node · GEX anchor"
factors (specific strike + point-distance in the `detail` text), the `levels.stop`/`invalidation`
fields, and (via `buildPlayIdeaIntel`) the `gates.play_idea` narrative line — all without ever
consulting `desk.gex_stale`/`desk.gex_age_ms` (`SpxDeskPayload`, `spx-desk.ts`), which exist
specifically so stale GEX is never presented as live (see that type's own doc comment: "the walls
are REAL but not live — the UI age-badges / grays them so a minutes-old wall is never shown as a
current node").

The desk snapshot feeding this branch comes from `peekMergedSpxDesk()` (`spx-desk-loader.ts`),
which **deliberately** tolerates up to 24h of staleness once the market is genuinely closed — a
correct, intentional design choice this fix does NOT touch ("once the market is genuinely closed,
stale and correct are the same thing"). The bug was never the tolerance itself; it was that the
GEX-derived factor/levels/play-idea built from that tolerated-stale data carried no staleness
disclosure anywhere in the response, while `desk.gex_stale` becomes `true` whenever the GEX
snapshot's age exceeds `GEX_STALE_MS` (default 30s, `gexStaleFromAge`/`spx-desk-numerics.ts`) —
i.e. on this 24h-tolerant path, `gex_stale:true` is the overwhelmingly common case, not an edge
case.

### Evidence (live repro, as reported)

The sibling `GET /api/market/spx/desk` route (`peekSpxDesk()`, NOT 24h-tolerant — the tightly-bound
peek) reported `gex_walls:[]`, `gex_stale:true`, `gex_age_ms:null` at virtually the same instant
`GET /api/market/spx/play` served a specific GEX-support-derived trade idea with zero staleness
disclosure anywhere in the response (grepped the payload for `stale`/`age_ms` — found none outside
unrelated top-level desk fields).

New regression tests in `src/features/spx/lib/spx-play-engine.test.ts`:
- `"evaluateOpenPlay closed-market SCANNING, desk.gex_stale:true: the GEX-derived
  factor/thesis/play-idea disclose staleness"` — a closed-market desk with a GEX support wall
  within range and `gex_stale:true` must produce a factor whose own `detail` text, a `thesis`, and
  a `gates.play_idea` that all disclose "GEX stale, not live".
- `"evaluateOpenPlay closed-market SCANNING, desk.gex_stale:false (or absent): the SAME GEX-derived
  factor renders unchanged, with no staleness disclosure"` — the identical fixture with
  `gex_stale:false`, and again with the field entirely absent (the realistic degraded-snapshot
  shape), must render the exact same factor/thesis/play-idea with NO staleness clause — proving the
  disclosure is conditional, not unconditionally appended, and that absent-vs-false behave
  identically.

RED→GREEN confirmed via a scoped pre-fix/post-fix swap (`git show HEAD:<file>` restored the
pre-fix source into the working tree — this sandbox's shared git-stash stack makes a bare `git
stash` unsafe for a concurrent-session repo):
- **Before the fix:** 7/8 tests pass in this file, 1 fails — the new `gex_stale:true` test, with
  the actual factor detail observed as `"At 0DTE support node 7675 (+5 pts)"` (no disclosure),
  reproducing the exact live-reported gap.
- **After the fix:** 8/8 pass.

Full suite: all **894 tests across every `src/features/spx/lib/*.test.ts` file pass** post-fix (0
failures). `npx tsc --noEmit` clean repo-wide.

### Blast radius

`computeSpxConfluence`/`buildLevels` (`spx-signals.ts`) are shared by the LIVE-market path too
(`BUY_CALL`/`BUY_PUT`/`HOLD` evaluation during market hours) — this fix does **not** touch that
file at all. The live-market path already has its own freshness enforcement at the gate layer
(`gex_stale_max_sec`, `gate-rules.ts`), so adding disclosure there was out of scope and
unnecessary; this fix is scoped entirely to the closed-market branch of `spx-play-engine.ts`,
which is the one place `desk.gex_stale` was never even read. No other call site of
`computeSpxConfluence`/`buildPlayIdeaIntel` is touched.

### Fix

Added `GEX_DERIVED_FACTOR_LABELS` (the three factor labels `buildLevels` builds directly off
`desk.gex_walls`/`desk.gex_king`: "GEX support", "GEX resistance", "King node · GEX anchor") and
`discloseStaleGexFactors()` in `spx-play-engine.ts`. In the closed-market branch, when
`desk.gex_stale === true` **and** the computed confluence actually fired one of those GEX-derived
factors (gated on both, not `gex_stale` alone — a closed-market read whose only firing factors are
VWAP/max-pain/etc. must never grow a confusing staleness clause about data it never showed):
- each GEX-derived factor's own `detail` text gets `" — GEX stale, not live"` appended;
- the closed-market `thesis` line gets a `" · GEX stale, not live"` clause appended;
- `gates.play_idea` gets the same `" · GEX stale, not live"` suffix appended.

The **24h staleness tolerance itself in `peekMergedSpxDesk()` was NOT changed** — this fix only
adds disclosure on top of the existing, intentional tolerance.

### Fix rationale

Matches the existing disclosure idiom this codebase already uses elsewhere for stale GEX, rather
than inventing new phrasing: `spx-invalidation.ts`'s `composeSpxInvalidationLines` ("**Data
stale** — GEX/feed lagging; treat invalidation levels as soft until refresh.") and
`spx-desk-brief.ts`'s risk line ("GEX/feed stale — lighter size until refresh."). Both already key
off the exact same `desk.gex_stale` field this fix reads.

Considered surfacing `gex_stale`/`gex_age_ms` directly onto `SpxPlayPayload` instead (mirroring the
sibling `/desk` route's own top-level fields) — rejected as a wider, less-contained change to a
type consumed by more call sites than necessary to close this specific gap; the in-text disclosure
on the factor/thesis/play-idea that actually present the stale-derived content is the narrower,
sufficient fix and is also the pattern the two sibling files above already establish.

Gating on "a GEX-derived factor actually fired" (not just `gex_stale` alone) was a deliberate
design choice made while writing the fix: an earlier draft appended the clause whenever
`gex_stale` was true regardless of whether any GEX factor fired, which would have produced a
confusing "GEX stale, not live" clause on a closed-market read whose only real signal was VWAP or
max-pain — disclosing staleness about a GEX factor the response never actually presented.

### Tests

`src/features/spx/lib/spx-play-engine.test.ts` (2 new tests, described under Evidence above).
`npx tsx --experimental-test-module-mocks --test src/features/spx/lib/*.test.ts`: 894/894 pass
(15 suites). `npx tsc --noEmit`: clean.
