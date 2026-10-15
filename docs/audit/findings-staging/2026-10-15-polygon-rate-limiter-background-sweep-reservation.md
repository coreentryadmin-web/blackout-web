## 2026-10-15 — [FINDING, P1 performance, shared infra] Vector bead-recorder's continuous GEX polling saturated the shared Polygon rate limiter, starving 0DTE/SPX/Thermal of their share (two confirmed live `upstream_ok:false` incidents) — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**This is the fix for the already-filed, previously-escalated finding** "Live ALB tail-latency
incident (2026-10-15, 16:21-16:51 UTC+): Vector bead recorder's 5s universe-wide GEX polling
structurally saturates the shared Polygon rate limiter — NOT FIXED, escalated" (`FINDINGS.md`,
folded from `2026-10-15-vector-bead-recorder-gex-rate-limiter-saturation.md` via PR #6066) and its
docs-only escalation PR #6065 / #4076 comment 6197984130. That entry deliberately shipped NO code
fix, pending Cursor's input on a cross-cutting shared design surface. ~2h later, with no reply on
#4076 and fresh corroborating evidence from the 0DTE lane (comment 6199692739: two confirmed live-
RTH `GET /api/market/zerodte/board` `upstream_ok:false` incidents, ~17:44-17:47 UTC and ~18:44-
18:45 UTC, both empty discovery/governor output despite 20 real committed positions existing
safely, both self-healing within minutes, both time-correlated with the rate-limiter saturation
window), this was re-escalated from "write it up" to "design and ship a careful, conservative,
additive fix now" — per this repo's standing NEVER-SIT-IDLE discipline and the Claude↔Cursor
collaboration protocol's explicit authorization for autonomous action once a reasonable wait has
passed on an unanswered, well-evidenced, well-scoped item.

### Root cause (unchanged from the original finding — repeated briefly for context)

`src/lib/vector-bead-recorder-leader.ts`'s universe sweep fires every 5s (and a second, 15s
"active viewer" lane) across the shared ~100-122-ticker Vector universe, calling the same shared
`fetchGexHeatmap()` every other Polygon-GEX caller (0DTE, SPX, Thermal, Helix, Meridian, Largo
tools, interactive member reads) depends on. The cache's own TTL is a flat 5s, matching the
recorder's own cadence, so on nearly every tick the whole universe is already stale and
re-triggers a real Polygon rebuild — live-measured at 47-87 full-chain escalations/min sustained
for 3.5+ hours, with dozens of UNRELATED tickers (names outside Vector's own universe) hitting
`[polygon] rate-limiter queue budget exceeded at global_rps` / `at local_slot` in the same
millisecond as the recorder's own churn. The shared Polygon rate limiter
(`src/lib/providers/polygon-rate-limiter.ts`) has no per-caller budget at all today — every caller
competes for the identical global ceiling with no notion of priority.

### Why this was safe to fix now (not a new guess under incident pressure)

The original finding's own write-up named the three candidate fixes and their risk:
(1) changing the recorder's cadence/TTL — reverses deliberately re-affirmed product intent, needs
product sign-off, explicitly NOT done here or anywhere in this fix; (2) changing
`fetchGexHeatmap`'s shared cache/concurrency-cap layer — the literal cross-cutting dependency
every Polygon-GEX consumer relies on, NOT touched here; (3) **giving the Polygon rate limiter a
per-caller priority/reservation scheme — "architecturally the most promising real fix... new
design surface... deserves a deliberate design pass."** This fix is (3), and the "deliberate
design pass" turned out to already exist, proven in production: `src/lib/providers/
uw-rate-limiter.ts` already ships the exact mechanism needed (`runWithBackgroundUwSweep` +
`reserveForLiveTraffic`, an `AsyncLocalStorage`-tagged caller sees a REDUCED admission ceiling at
both the Redis-global and local-process admission stages, while every untagged — i.e. every
existing — caller sees the ceiling completely unchanged). That mechanism shipped for UW on
2026-09-01/09-09 for the structurally identical problem (a background sweep able to monopolize a
small shared ceiling and starve live member traffic) and has been live and uneventful since. This
fix ports the same proven shape to the Polygon limiter rather than inventing a new one.

### The one real design decision this fix had to make

UW's version reserves a flat `ceiling - 1` unit for live traffic, which is a real ~50% reservation
there because `UW_GLOBAL_MAX_CONCURRENCY` defaults to 2. Polygon's ceilings are 24-150x larger
(`MAX_CONCURRENCY`=48, `GLOBAL_MAX_RPS`=150) — porting the literal "-1" would reserve under ~2% of
the budget, which the measured incident (a continuous tens-of-req/s structural saturator) would
blow through immediately, making the port a no-op in practice while looking identical to UW's
proven pattern in a diff review. Used a **fraction** of the ceiling instead
(`POLYGON_BACKGROUND_SWEEP_MAX_SHARE`, default 0.5, env-overridable without a redeploy — same
escape hatch every other constant in this file already has), so the reservation stays a meaningful
floor regardless of which ceiling value is configured, and is tunable from measured production
behavior post-deploy rather than guessed once and left.

### Fix

`src/lib/providers/polygon-rate-limiter.ts`: added `runWithBackgroundPolygonSweep` (an
`AsyncLocalStorage<true>` tag) + `reserveForLiveTraffic(ceiling)` (returns `ceiling` UNCHANGED for
any untagged caller; for a tagged caller, returns `Math.max(1, Math.floor(ceiling *
BACKGROUND_SWEEP_MAX_SHARE))` — never reduced to zero, so a sweep can always make SOME progress).
Wired into BOTH admission stages the live incident's own evidence showed failing at once:
- `acquireGlobalRedisSlot`'s Redis sliding-window RPS check (`"blackout:polygon:rps"`) now passes
  `reserveForLiveTraffic(GLOBAL_MAX_RPS)` instead of the raw ceiling.
- `acquireLocalSlot`'s per-process concurrency check now reads `effectiveMaxConcurrency()` (=
  `reserveForLiveTraffic(MAX_CONCURRENCY)`) instead of the raw `MAX_CONCURRENCY`, on both the
  admit test and the busy-delay branch. Polygon has no Redis concurrency semaphore (unlike UW's
  `acquireGlobalRedisConcurrencySlot`), so this per-process cap is the only concurrency gate that
  exists, making it just as important to cover as the RPS side.

`src/lib/vector-bead-recorder-leader.ts`: wrapped both fan-out call sites —
`tick()`'s `recordSharedUniverseWallSamples({ shards })` (the 5s universe lane) and
`activeTick()`'s `recordActiveNonUniverseWallSamples()` (the 15s active-viewer lane) — in
`runWithBackgroundPolygonSweep(...)`. The tag propagates via `AsyncLocalStorage` through every
nested async call (`recordVectorUniverseWallSample` → `buildVectorUniverseRow` →
`fetchGexHeatmap` → `polygonTrackedFetch`) without threading an explicit parameter through shared
library code neither lane owns.

### Blast radius / what was deliberately left unchanged

- **Every other Polygon caller** (0DTE discovery/commit, SPX desk, Thermal, Helix, Meridian, Largo
  tools, interactive member Vector/heatmap reads, and Vector's OWN interactive reads) is
  completely unaffected: none of them run inside `runWithBackgroundPolygonSweep`, so
  `reserveForLiveTraffic` returns their ceiling byte-for-byte unchanged. This is the fix's main
  safety property — it protects the 0DTE path named in the corroborating evidence, and everyone
  else, without needing per-route investigation, because the mechanism is caller-CLASS-based.
- **`heatmap-warm`'s own background rebuild cron** was NOT tagged — out of scope here (PR #6055
  already fixed its own, different concurrency-cap bug on this same code path and is correct/
  settled per the original finding; tagging it too is a reasonable follow-up, not required to fix
  THIS incident, which the evidence attributes to the recorder specifically).
- **The recorder's own 5s/15s cadence, and both global ceilings (`POLYGON_MAX_RPS`/
  `POLYGON_GLOBAL_MAX_RPS`=150, `POLYGON_MAX_CONCURRENCY`=48), are unchanged** — this fix
  reallocates existing shared budget between caller classes; it does not raise or lower the total.
- **Default-safe**: if `runWithBackgroundPolygonSweep` were ever NOT wired into the recorder (a
  future refactor accidentally drops the wrap), the worst case is the EXACT pre-fix behavior
  (every caller competes for the full ceiling, as today) — never a regression beyond today's
  already-measured-bad state. If `POLYGON_BACKGROUND_SWEEP_MAX_SHARE` is misconfigured to a
  pathological value, `clampShare` bounds it to `[0.05, 0.95]`, so the recorder can never be
  starved to 0 share nor granted the full, unreserved ceiling.

### Test (RED → GREEN, proven via `git stash` on source files only, tests untouched)

- `src/lib/providers/polygon-rate-limiter.test.ts`: `reserveForLiveTraffic` returns the ceiling
  unchanged outside the tag (default-safe); reduces it by a REAL fraction (not a token "-1") when
  tagged, never to zero; `AsyncLocalStorage` isolation (a concurrent untagged caller running
  alongside a tagged sweep is unaffected); source-scan proof that both `acquireGlobalRedisSlot`'s
  RPS call and `acquireLocalSlot`'s concurrency check actually use the reserved value, not the raw
  constant.
- `src/lib/vector-bead-recorder-leader.test.ts`: source-scan proof both `tick()` and `activeTick()`
  invoke their recorder calls inside `runWithBackgroundPolygonSweep`, and that the helper is
  imported from the shared limiter rather than reimplemented locally.
- Pre-fix (`git stash` on `polygon-rate-limiter.ts` + `vector-bead-recorder-leader.ts` only): 9 of
  the new/modified assertions fail (11 pass / 9 fail). Post-fix (`git stash pop`): all 20 pass.
- `tsc --noEmit`: clean. Full `npm test` (Node 20.20.2, `scripts/run-tests.mjs`): see PR for the
  final tally.

### What this does NOT claim

This fix has not yet been validated against a live, naturally-recurring saturation window (the
original incident may have already self-resolved by the time this deploys — CloudWatch re-checks
are the next step, logged in `MARKET-OPEN-VALIDATION.md`). It is shipped on the strength of (a) a
well-evidenced, twice-recurring root cause, (b) a mechanism already proven safe and effective in
production for the structurally identical UW-side problem, and (c) every safety property above
being independently true regardless of whether the exact 0.5 default share turns out to be the
eventual right number — that number is now a live-tunable env var, not a hard-coded guess.
