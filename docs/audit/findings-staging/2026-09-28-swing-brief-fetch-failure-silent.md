# P3: Swing play-brief ecosystem/Vector fetch failures were logged nowhere — FIXED

> **kind:** FINDING

## Problem

Live repro (2026-09-28, Ask Largo standing mandate, `GET /api/market/swing/play-brief?playId=SWING:AMZN&ticker=AMZN&positionId=44`):
the envelope correctly surfaced

```
"confidence": { "level": "moderate", "why": "2 sources unavailable this cycle (ecosystem context, Vector state) — see below." },
"unavailableSources": [
  { "source": "ecosystem context", "reason": "fetch failed", ... },
  { "source": "Vector state", "reason": "fetch failed", ... }
]
```

— an honest, correctly-surfaced member-facing absence (Largo C3). But grepping
`/ecs/blackout-production` CloudWatch Logs for the last 15 minutes for anything mentioning
"ecosystem context" returned **zero matches**. The member-facing symptom was visible; the actual
cause (timeout? provider error? which upstream?) was invisible from ops.

## Root Cause

`play-brief-context.ts`'s `Promise.all` fan-out catches the `fetchEcosystemContext`/
`fetchVectorFullState` rejections purely to flip a boolean flag, with no log line at all:

```ts
withBriefSourceTimeout(fetchEcosystemContext(ticker)).catch(() => {
  ecosystemFetchFailed = true;
  return null;
}),
withBriefSourceTimeout(fetchVectorFullState(ticker, normalizeDteHorizon("all"))).catch(() => {
  vectorFetchFailed = true;
  return null;
}),
```

The caught error itself (`err`) was discarded entirely. This is the identical bug shape
`swing-discovery.ts`'s Tier-0 origin fetch already had to fix — its own comment: *"a real
POSITIONING origin outage... was invisible in CloudWatch and distinguishable from... only by
reading `recall.tier0OriginFetchErrors` off a scan result nobody was tailing."* The play-brief
context fan-out never got the equivalent fix.

## Fix

Both `.catch()` handlers now log the real caught error via `console.warn`, naming the ticker and
which source failed, before setting the flag — mirroring `tier0-origin-fetch.ts`'s existing
`console.warn` pattern. Purely additive: no change to `ecosystemFetchFailed`/`vectorFetchFailed`
semantics, no change to the envelope, no change to `collectBriefUnavailableSources`.

## Files Changed

- `src/lib/swing/play-brief-context.ts` — `console.warn` in both catch handlers.
- `src/lib/swing/play-brief-context.test.ts` — two new regression tests asserting the real error
  reaches `console.warn` (mocked) with the ticker named, for both the ecosystem and Vector fetch
  paths.

## Evidence

- Live repro: `GET /api/market/swing/play-brief` for AMZN, `unavailableSources` non-empty, zero
  matching CloudWatch log line in the prior 15 minutes.
- New regression tests RED pre-fix (`git stash` proof, both new subtests fail with `got: []`) /
  GREEN post-fix (6/6 pass).
- `npx tsc --noEmit` — clean.

## Status

| **Status** | FIXED |
| --- | --- |
| **Commit** | this PR |
| **PR** | small, single-issue |
