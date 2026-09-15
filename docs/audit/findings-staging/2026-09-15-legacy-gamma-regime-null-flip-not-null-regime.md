> **kind:** FINDING

## Night Hawk Legacy's `positioning_summary` re-lost an already-shipped fix — a null gamma flip read as "unknown" instead of the real "amplification" regime it already carried elsewhere — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** on 2026-08-20 the shared GEX regime builder (`buildGexRegime`,
`src/lib/providers/gex-cross-validation-core.ts`) was fixed after measuring, live, that SPX/SPY/QQQ
held `flip_reason: "net_short_everywhere"` for a full RTH session — a real, unambiguous SHORT-gamma
read (dealers net short at every strike, no long-gamma pocket exists), not missing data. That fix
resolves `gamma_posture: "short"` correctly even when `flip` is null, and `getGexPositioning`
(`src/lib/providers/gex-positioning.ts`) surfaces it via `gamma_posture` on every read.

Night Hawk Legacy's own `fetchPositioningSummary` (`src/features/nighthawk/lib/positioning.ts`)
never adopted that fix. Its warm/cache-hit path (the one actually serving traffic — confirmed live
2026-09-15, all 6 of today's index/sector dossiers: SPY/QQQ/IWM/XLF/XLE/XLK) re-derives the regime
with the OLD, narrower rule:
```ts
const regime = gammaRegime(gex.spot, flip);   // gammaRegime returns "unknown" whenever flip == null
```
`gammaRegime` (`src/lib/providers/gamma-desk.ts`) only ever looks at `spot` vs `flip` — it has no way
to see `flip_reason` or `gamma_posture`, so it necessarily says "unknown" for EVERY null-flip case,
re-losing the exact distinction the 2026-08-20 fix drew (a real short-gamma read vs. a genuine data
outage). Confirmed live: today's edition's `index_dossiers` showed
`"positioning_summary": "GEX king $760 · unknown · max pain $764"` for all six names simultaneously —
the same 100%-incidence pattern the original fix's own write-up flagged as suspicious ("For six hours
the desk reported its core regime as unavailable when it was in fact unambiguously short").

**Evidence:** live-fetched today's edition (`GET /api/market/nighthawk/edition`, authenticated) and
found every one of the 6 index/sector `positioning_summary` strings reading `"... · unknown · ..."`.
Traced `gamma_regime` back through `index-dossier.ts` → `positioning.ts`'s cache-hit branch → the bare
`gammaRegime(spot, flip)` call, confirmed it never reads `gex.gamma_posture`/`flip_reason` at all
(neither field appears anywhere in `positioning.ts` before this fix). Cross-checked against
`src/features/thermal/lib/thermal-flip-reason.ts`, which already treats `net_short_everywhere` as a
distinct, informative case (not a bare "unknown"/"N/A") — confirming Legacy is the one lane still
missing this. Wrote a regression test reproducing the exact scenario (`flip: null, gamma_posture:
"short"`) and confirmed pre-fix it returns `gamma_regime: "unknown"` — RED, proven via git-stash —
post-fix it returns `"amplification"`.

**Blast radius:** `fetchPositioningSummary`'s cache-hit path feeds every Night Hawk Legacy index/
sector dossier positioning line (`index-dossier.ts`) and any per-ticker positioning summary consumed
via `format.ts` (`GEX king $X · negative γ · regime Y`). Both format sites just interpolate the string
— neither special-cases "unknown", so the richer value flows through cleanly. The fallback path
(`buildSummary`, used only when the shared GEX cache is cold) still calls the older `computeGammaFlip`
which drops `flip_reason` entirely — left unfixed here since it's the rarely-hit branch and fixing it
would mean swapping in `cumulativeGammaFlipDetail` there too, a separate, slightly larger change; not
touched to keep this PR single-issue per the standing policy.

**Fix:** in the cache-hit branch of `fetchPositioningSummary`, only the flip-null case changes:
```ts
const regime =
  flip != null
    ? gammaRegime(gex.spot, flip)
    : gex.gamma_posture === "short"
      ? "amplification"
      : "unknown";
```
`gex.gamma_posture` is `"short"` precisely when `buildGexRegime` resolved `net_short_everywhere`
(the only flip-null case that ever yields a non-null posture) — reusing it costs nothing extra to
compute (it's already on every `GexPositioning` read) and can't disagree with the flip-present branch,
which is left completely untouched.

**Fix rationale — why not also change the flip-present branch to use `gamma_posture` uniformly:**
`gammaRegime`'s own boundary convention is `spot > flip → mean_revert` (strict), while
`buildGexRegime`'s posture convention is `spot >= flip → "long"` (inclusive) — the two disagree at
the exact boundary `spot === flip`. Keeping the flip-present branch on the original `gammaRegime` call
preserves that exact, already-tested boundary behavior with zero risk of a sign flip; only the
flip-null branch (previously dead-ended at "unknown" with no boundary to preserve) gains the richer
read.

**Test:** `src/features/nighthawk/lib/positioning.test.ts` — 3 new tests: flip-null +
`gamma_posture: "short"` → `"amplification"`; flip-null + `gamma_posture: null` (a genuine outage,
e.g. `insufficient_strikes`) stays `"unknown"`; flip-present at the exact `spot === flip` boundary is
unchanged (`"amplification"`, not flipped to `"mean_revert"` by the posture convention). RED→GREEN
proved via `git stash` on `positioning.ts`: pre-fix the net_short_everywhere test asserts
`gamma_regime === "amplification"` but receives `"unknown"`; post-fix all 4 tests in the file pass.
`npx tsc --noEmit` clean.
