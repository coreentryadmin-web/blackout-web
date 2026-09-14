> **kind:** FINDING

## `dossierFetch`'s abort contract is unwired everywhere it's used — timed-out fetches keep running in the background

| **Status** | HELD (docs-only, doc-comment corrected in `docs/dossier-fetch-timeout-no-abort-wiring`) |
|---|---|

**What this is.** A held (report-and-hold, not directly fixed) finding from the Night Hawk
Legacy audit lane's standing per-cycle sweep, surfaced while reviewing `dossier.ts`'s
per-ticker fetch orchestration. Docs-only — the code change in the companion PR is a corrected
doc comment on `fetch-timeout.ts`, not a behavior change, per the standing issue-handling
policy's staged-finding pipeline.

**Root cause.** `dossierFetch` (`src/features/nighthawk/lib/fetch-timeout.ts`) is documented as
wrapping a fetch-like factory "with a timeout that actually aborts the underlying HTTP
connection via AbortController" — `fn` is supposed to receive and honor an `AbortSignal` so a
timed-out request is truly cancelled, not just abandoned.

In practice, **every single call site ignores the signal, and none of the wrapped provider
functions even accept one**:
- `dossier.ts` calls `dossierFetch` 24 times (14 in the main `Promise.all`, 10 more inside the
  `runUwPooled` second wave) — every one passes a bare `() => someProviderCall(...)` that takes
  zero arguments, silently discarding the `AbortSignal` `dossierFetch` passes in.
- Confirmed via signature inspection that the wrapped functions themselves have no capacity to
  accept a signal even if a caller wanted to pass one: `fetchMarketFlowAlertRows`,
  `fetchPositioningSummary`, `buildTechnicalCard`, `fetchPolygonNews`, `fetchBenzingaCatalysts`,
  `fetchShortInterest`, `fetchUwDarkPool`, `fetchUwFlowPerExpiry` (a representative sample —
  none takes an `AbortSignal` parameter).

So `dossierFetch`'s real behavior today is "stop WAITING on `fn` and resolve with `fallback`" —
not "stop the underlying request." When the 8s (`DOSSIER_FETCH_TIMEOUT_MS`) deadline fires, the
promise race resolves with the fallback and the caller moves on, but the abandoned fetch keeps
running to completion in the background: still holding a connection/socket, still consuming
upstream API rate-limit quota, and the process still spends CPU parsing a response nothing will
ever read.

**Why this matters at scale.** `fetchAllDossiers` builds dossiers for every candidate ticker in
an edition, `DOSSIER_BATCH_SIZE` (default 2) at a time, each ticker firing up to ~24 of these
wrapped calls. Under normal conditions most resolve well inside 8s and this is invisible. But
during any real upstream slowness — and this repo's own CLAUDE.md already documents exactly
that shape elsewhere (`fetchVectorFullState`'s "cold-cache fan-out routinely takes 4-6s" against
an 8s Cortex timeout) — a burst of 8s timeouts firing across a batch means a burst of abandoned-
but-still-running requests piling up in the background, competing for the same upstream quota
and connections the NEXT ticker's fetches need. This is a plausible, previously undocumented
contributor to exactly the kind of latency/tail-behavior the standing performance mandate asks
this fleet to keep hunting for — not proven as the root cause of any specific measured incident,
but a real, confirmed mechanism that would produce that shape of problem.

**Why held, not fixed directly.** Wiring real cancellation through requires every wrapped
provider function (~20 of them, spread across `unusual-whales.ts`, `polygon.ts`,
`polygon-largo.ts`, `polygon-options-gex.ts`, plus `positioning.ts`/`technicals.ts`/
`flow-streak.ts` in this same directory) to accept an `AbortSignal` and thread it down to its
own internal `fetch()` call(s) — a genuine multi-file architectural change, not a local one, and
exactly the kind of change the standing escalation policy reserves for report-and-hold rather
than a same-cycle CARVE-OUT fix. It also touches shared provider functions used well outside
Legacy (0DTE, Swings, Vector, Helix all import from the same provider files), so a careless
change risks those lanes' own tuning — the same caution CLAUDE.md's cross-lane collaboration
protocol asks for before touching shared surface.

**What was fixed here.** Corrected `dossierFetch`'s own doc comment so it accurately describes
current behavior instead of overclaiming — a future reader (or a future audit pass) should not
assume timing out here frees the underlying resource; the comment now names every current call
site's non-wiring explicitly, points at this finding, and states the actual guarantee that does
hold today (a genuine, per-call-site opt-in: wiring `fn` to use `signal` restores real
cancellation for that one caller).

**Suggested (non-prescriptive) next step, if picked up:** rather than threading `AbortSignal`
through all ~20 provider functions in one large PR (high risk, hard to review, touches shared
cross-lane surface), the natural incremental path is per-function: pick the provider(s) most
often the tail-latency culprit (candidates worth measuring first: `fetchPositioningSummary`
since it fans out to the shared GEX matrix cache, and the `fetchUw*` family since they're gated
behind `runUwPooled`'s own concurrency-2 pool and therefore most likely to queue behind a slow
neighbor), confirm each accepts/forwards a signal to its own `fetch()` call, then update its
`dossierFetch` call site in `dossier.ts` to pass `signal` through. Each such change is small,
single-function, and independently testable/provable exactly like this session's other fixes.
