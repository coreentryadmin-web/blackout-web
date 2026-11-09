# 2026-11-09: SPY-proxy fallback poisoned itself for up to an hour on a transient upstream failure — `next.revalidate` caches 429s, not just 200s

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

PR #7721 (earlier today) added `spxPriceFromSpyProxy()` as a last-resort fallback to `buildSpxDesk()`/
`buildSpxDeskPulse()`/`buildSpxDeskPulseMinimal()`'s price chains, for when I:SPX's own Polygon/
Massive endpoints are entitlement-blocked. The fix was correctly deployed and present in source
(verified via `gh run view` and a direct `git log` read), but this cycle's Ask Largo/5-engine
Workflow — 3 independent adversarial-verify agents, each polling production live over a ~50-minute
window well past the deploy's own stabilization window — found `GET /api/market/spx/pulse` and
`/desk` **flickering** between the correct `available:true, price:7352.9` (the SPY-proxy value) and
the pre-fix empty shell (`available:false, price:0`) on consecutive polls, with `as_of` genuinely
advancing each time (ruling out a frozen cache). 2/3 verify passes could not refute the claim that
the fix "does not reliably reach production"; the one pass that caught the fix firing correctly
also independently hit a live 429 from Massive's `/v2/aggs/ticker/SPY/prev` on a direct `curl`.

## Root cause

`spxPriceFromSpyProxy()` called `fetchPreviousDayBar("SPY", { next: { revalidate: 3600 } })`.
Next.js's fetch Data Cache caches the *response* for the full `revalidate` window **regardless of
HTTP status** — a transient 429/5xx from Massive gets cached as a "result" exactly like a 200 would,
so `polygonGet`'s `if (!res.ok) return null` check keeps returning `null` from the *cached* failed
response for up to an hour after the underlying upstream has already recovered. Multiple ECS
replicas each keep their own copy of this cache, so which replica an ALB-routed poll happens to hit
determines whether that poll sees the (stale, cached) failure or a fresh success — exactly the
flickering behavior independently observed by 2 of the 3 verify passes.

This mirrors, but is distinct from, `polygon-options-gex.ts`'s `fetchSpotFromPrevBar` — which
**deliberately** uses the same `next: { revalidate: 3600 }` shape, per its own comment, because
`cache: "no-store"` there would force the **homepage's** ISR route fully dynamic (the exact bug
FINDINGS.md's 2026-08-30 entry fixed). That rationale does not apply here: `spxPriceFromSpyProxy()`
is only ever reached from `/api/market/spx/desk` and `/pulse`, both of which already declare
`export const dynamic = "force-dynamic"` — there is no ISR benefit to protect, so there was no
reason to accept the error-caching risk in the first place.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the source change): 1/18 new assertion failed in
`spx-desk-offhours-spot.test.ts`.

GREEN (post-fix): 18/18 pass in that file; `npx tsc --noEmit` clean.

Live evidence (from the Workflow's 3 adversarial-verify agents, 2026-11-09 ~09:09-09:22 UTC, 43-56
minutes after the SPY-proxy fix's own successful deploy at 08:26:42Z): `/api/market/spx/pulse`
returned `available:true, price:7352.9` on 1-2 of ~12 polls and the empty shell on the rest; `/desk`
returned the empty shell on 24/24 and 14/14 polls across two rounds, `as_of` advancing each time. A
direct `curl` to `https://api.massive.com/v2/aggs/ticker/SPY/prev` hit a live 429 during one verify
pass — the exact upstream-failure shape this fix's caching choice would turn into an hour-long
cached `null`.

## Fix

Changed `spxPriceFromSpyProxy()`'s `fetchPreviousDayBar` call from `{ next: { revalidate: 3600 } }`
to `{ cache: "no-store" }`. Every call now hits Massive/Polygon fresh — a transient failure can
never block recovery once the upstream clears, and since this function is a last-resort fallback
(only reached when the primary I:SPX-anchored sources have already failed), the added call volume
is bounded to the already-degraded window, not the steady state.

## Blast radius

`polygon-options-gex.ts`'s `fetchSpotFromPrevBar` was deliberately **not** touched — its own
comment documents why `next.revalidate` is required there (preserving the homepage's ISR), and
changing it would reintroduce the 2026-08-30 "homepage forced fully dynamic" regression. The two
functions share a pattern but not a route-level constraint; only `spxPriceFromSpyProxy()`'s callers
are already force-dynamic API routes with nothing to lose by going `no-store`.

## Why this wasn't caught at the time of the original fix

The original fix's own regression tests asserted the fallback *existed in the price chain*, not
what caching options it used when calling the underlying fetch — the error-caching hazard is
invisible to a source-text-matching test unless it specifically asserts on the `fetchInit` shape,
which this PR's added `assert.doesNotMatch` now does.
