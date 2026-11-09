# 2026-11-09: SPX desk could serve a pulse-only degraded shell as `available:true` with no disclosure signal (route's main branch, and the merged bundle Largo reads)

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`GET /api/market/spx/desk`'s main (non-peek) branch — and, via `loadMergedSpxDesk()`, every
consumer of the merged desk bundle including Ask Largo's `get_spx_confluence` tool — could serve a
pulse-only "bootstrap shell" as `available:true, source:"none"` with essentially every scoring
field null, during live RTH, with **zero disclosure** of this degraded state. The response read as
a fully-populated, healthy payload (a real, nonzero price, `available:true`) while actually being a
near-empty shell.

Live evidence (2026-11-09, ~12:01–12:03 ET, 3 consecutive polls, market genuinely open):

```
GET /api/market/spx/desk →
{"available":true,"source":"none","price":7352.9,"market_open":true,"market_status":"open",
 "vwap":null,"gamma_flip":null,"gex_walls":[],"max_pain":null,"flow_0dte_net":null,
 "tide_bias":null,"dark_pool":null,"tick":null,"trin":null,"add":null,"spx_flows":[],
 "unified_tape":[],"news_headlines":[],
 "data_quality":{"vix_term_partial":false,"missing":["VIX","VIX9D","VIX3M","oi_changes","iv_term_structure"]}}
```

## Root cause

1. `emptyPayload()`/`emptyDeskPayload()` (`src/features/spx/lib/spx-desk.ts`) sets `source: "none"`
   as the sentinel for "no real desk build backs this payload."
2. `loadSpxDesk()`'s `withServerCache` (`spx-desk-loader.ts`) has a cache-lane fallback —
   `deskCacheOpts.fallback = async () => deskShellFromPulse(await loadSpxDeskPulse())` — that fires
   whenever `buildSpxDesk()` exceeds its own max-block time with no usable stale snapshot.
3. `deskShellFromPulse(pulse) = mergePulseIntoDesk(emptyDeskPayload(...), pulse)`
   (`spx-desk-merge.ts`). `mergePulseIntoDesk` spreads `...base` and explicitly reassigns
   `available: pulse.available || base.available` (the 2026-10-25 fix, so a pulse-only shell with a
   real price correctly reads `available:true` rather than being stuck `false` forever) — **but it
   never reassigns `source`**. Neither does `mergeFlowIntoDesk`/`mergeDeskLayers`. So the fallback
   shell can legitimately carry `available:true, source:"none"` simultaneously: a real price from
   the pulse lane, next to null VWAP/GEX/flow/tide/dark-pool/internals.
4. `app/api/market/spx/desk/route.ts`'s PEEK branches already distrust exactly this shape
   (`instant.price > 0 && instant.source !== "none"`, added by commit `aa5feefde` / PR #7310,
   mirroring `spx-play-engine.ts`'s closed-market guard `desk.price > 0 && desk.source !== "none"`)
   — but the route's **main** `loadSpxDesk()` branch had no equivalent check and served the shell
   to HTTP clients unguarded.
5. Largo propagation: `getLargoSpxLiveDesk` → `loadMergedSpxDesk().merged` →
   `computeSpxConfluence(desk)` (`spx-signals.ts`), which gates only on
   `if (!price || price <= 0 || !desk.available) return null` — no `source` check — so the same
   degraded shell with `available:true` passes this gate and gets scored as if fully live. (Read
   `spx-signals.ts` to confirm this gate; **not edited** — see "What was deliberately left
   unchanged" below.)

## Distinguishing this from the other two findings staged today

- **Not the same as `2026-11-09-spx-desk-pulse-offhours-spy-proxy-gap.md`** (and its earlier
  sibling): those fixed the price-resolution chain so `price` recovers a real value (via the
  SPY-proxy fallback) instead of falling through to `0`. They explain *why* the pulse lane still
  had a real `price` to report in this exact live repro — but neither one touches `source`
  reassignment or the route's main-branch disclosure gap. This finding is downstream of (and
  independent from) that fix: even with a perfectly healthy price, the shell is still silently
  presented as fully available.
- **Not PR #7310's bug**: #7310 fixed the route's **peek** fast-path only (`instant` from
  `peekSpxDesk()`). The main branch's `loadSpxDesk()` call — reached whenever the peek itself
  declines to serve (including, ironically, *because* of #7310's own new `source !== "none"`
  check) — was never given the equivalent treatment, which is exactly how this shape still reached
  production after #7310 shipped.

## Fix

Rather than flip `available` to `false` (which would also erase a genuinely correct price — real
off-hours pulse-only shells legitimately need `available:true` to stay true per the 2026-10-25 fix,
and that fix's own motivating case is untouched by this change), this adds an explicit, additive
disclosure field, `degraded?: boolean`, to `SpxDeskPayload` — the same "absence must be disclosed,
never silent" treatment `docs/audit/LARGO-PRODUCT-CONTRACT.md` already asks for, and the same shape
as the existing `gex_stale`/`vwap_stale` sticky-fallback disclosure flags on this exact type.

- `emptyPayload()` (`spx-desk.ts`): sets `degraded: true` directly — it IS the degraded-shell
  sentinel (`source: "none"`), so the invariant holds even for a caller that returns this object
  without ever routing it through `mergePulseIntoDesk` (e.g. `buildSpxDesk()`'s own
  `!polygonConfigured()` early return).
- `mergePulseIntoDesk()` (`spx-desk-merge.ts`): recomputes `degraded: base.source === "none"` on
  every merge — the same "derive honestly from `base`, never blindly inherit via the `...base`
  spread" treatment already applied to `available`/`vix_term`/`prior_close` in this exact function
  (2026-10-09/10-21/10-25 fixes, all documented inline above this one).

Because `deskShellFromPulse()` is the single function that builds every degraded shell this bug
can produce (the route's cache fallback, the bootstrap fast lane, and the catch-block's last-resort
shell all call it), fixing it there propagates the disclosure to every one of those call sites with
no code change needed in `app/api/market/spx/desk/route.ts` itself — `desk.degraded` is simply
already present on the object the route spreads into its JSON response.

## Blast radius

- `GET /api/market/spx/desk`'s main branch and catch-block fallback now honestly carry
  `degraded: true` whenever `source === "none"`.
- `loadMergedSpxDesk()`'s bootstrap fast lane (`buildBootstrapFastLane`, `spx-desk-loader.ts`) and
  the ordinary SWR cache-fallback path both route through the same `deskShellFromPulse`/
  `mergePulseIntoDesk` machinery, so the merged bundle `getLargoSpxLiveDesk` reads also now carries
  `degraded: true` on a pulse-only shell — a future fix, or any consumer outside `spx-signals.ts`,
  can check this field.
- No other route (`/pulse`, `/flow`, `/bootstrap`, `/play`) changes behavior; they either don't
  serve `SpxDeskPayload` directly or already apply their own `source !== "none"` guard.

## What was deliberately left unchanged

- **`computeSpxConfluence` (`spx-signals.ts`) and `spx-play-engine.ts` are not edited.** A
  concurrently-running agent is fixing an unrelated SPX "double-clamp" divergence bug in those same
  two files; touching them here would collide with that in-flight work. Closing the Largo-side gate
  gap (making `computeSpxConfluence` itself check the new `degraded` field, or `source`) needs a
  change in that file and is explicitly out of scope for this PR. The `degraded` field is added so
  that change is a small, mechanical follow-up whenever those files are next free to touch — not
  blocked on anything else this PR does.
- **`available` itself is not changed.** The 2026-10-25 fix's motivating case (an off-hours
  pulse-only shell carrying real structural data — VWAP/HOD/LOD/EMAs — that should legitimately
  read `available:true`) is untouched; this fix is purely additive.
- **`data_quality.missing` under-reporting** (the live repro's `missing` list omitted vwap/
  gex_walls/gamma_flip/flow_0dte_net/tide_bias/dark_pool/tick/trin/add even though all were null)
  is a real, secondary gap, but the new `degraded: true` flag already supersedes it as the honest
  signal for "this payload is a degraded shell" — a consumer no longer needs to diff every
  individual field against `missing` to detect it. Left unfixed to keep this PR single-issue, per
  the repo's standing issue-handling policy.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the two source files
`src/features/spx/lib/spx-desk.ts` and `src/features/spx/lib/spx-desk-merge.ts`, keeping the new
tests): 2/32 failed in `spx-desk-merge.test.ts` — both new `degraded`-disclosure tests, with
`merged.degraded` reading `undefined` instead of `true`/`false`.

GREEN (post-fix):
- `spx-desk-merge.test.ts`: 32/32 pass.
- `spx-desk-merge.test.ts` + `spx-desk-loader.test.ts` + `spx-desk-loader-stale-ceiling.test.ts` +
  `route.test.ts` + `spx-desk-offhours-spot.test.ts` + `spx-desk-closed-placeholder.test.ts` +
  `spx-desk-peek-staleness.test.ts` + `spx-service-degraded-shell-peek.test.ts`: 60/60 pass.
- All `src/features/spx/lib/spx-desk*.test.ts`: 119/119 pass.
- Full `src/features/spx/**/*.test.ts` suite (993 tests, 21 suites, includes `spx-play-engine.test.ts`
  and `spx-signals.test.ts`, which exercise `computeSpxConfluence` against `SpxDeskPayload` stubs):
  993/993 pass — confirms the additive field does not regress the healthy path anywhere in the
  feature.
- `npx tsc --noEmit`: clean.

All runs on Node 20 (`/opt/nvm/versions/node/v20.20.2/bin`), per this repo's standing instruction
that a Node 22 run is not evidence.
