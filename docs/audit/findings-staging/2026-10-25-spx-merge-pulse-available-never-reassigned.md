> **kind:** FINDING

## SPX Slayer — `mergePulseIntoDesk` never reassigns `available`, spuriously zeroing the play's score/direction off a cold fallback shell

**Area:** SPX Slayer / `src/features/spx/lib/spx-desk-merge.ts`
**Found by:** background Workflow `five-engine-live-correctness-sweep` (adversarially verified), 2026-10-25, Ask Largo × 5-engine live monitor standing mandate

### Symptom

`GET /api/market/spx/play`'s closed-market snapshot served `available:false, assessed:false,
score:0, factors:[], direction:null, grade:"D"` at 2026-10-25T12:51:11.955Z (Sunday, market
closed) — but the real underlying desk data (price, VWAP, EMA, tick/trin/add) was fully
available at the exact same instant, confirmed via a parallel `GET /api/market/spx/desk` showing
`available:true`, price `7623.68`.

Forcing a fresh full-desk build (`GET /api/market/spx/merged`) and re-polling
`GET /api/market/spx/play` two minutes later, for the same closed session and the same price
`7623.68`, correctly returned `assessed:true, score:-4, rawScore:38`, with 11 real factors whose
weights sum exactly to `-4`.

### Root cause

`mergePulseIntoDesk` (`spx-desk-merge.ts`) builds a merged desk payload with `{...base, ...}` and
explicitly reassigns ~30 derived fields in its return spread — but never reassigned `available`,
so the spread silently carried whatever `base.available` already was, forever.

That is harmless on the common path, where `base` is a real desk build that already carries a
correct `available:true` of its own. But `deskShellFromPulse` (`spx-desk.ts`) calls this exact
function as `mergePulseIntoDesk(emptyDeskPayload(...), pulse)` to build the **fallback shell**
used whenever the real merged desk build is cold or slow (right after a deploy, a cache miss, a
cache stampede — `buildBootstrapFastLane`/`deskCacheOpts.fallback` in `spx-desk-loader.ts`).
`emptyDeskPayload` hardcodes `available:false`. With no reassignment in `mergePulseIntoDesk`,
that `false` survived forever even when `pulse` — the ONLY data source this fallback shell has —
carried real, live price/VWAP/EMA/tick/trin/add data the whole time (`SpxDeskPulse.available` is
set `true` by `buildSpxDeskPulse` precisely when a real price was resolved).

Downstream, `computeSpxConfluence` (`spx-signals.ts:466`) gates with
`!price || price<=0 || !desk.available`, nulling confluence entirely whenever `available` is
false — even with real price. `evaluateSpxPlayCore`'s closed-market branch
(`spx-play-engine.ts:1609-1681`) then emits exactly the observed `assessed:false/score:0/
factors:[]/direction:null/grade:"D"` whenever confluence is null.

This is the same oversight shape as two already-merged fixes in this identical function:
`prior_close`/`gap_pct`/`gap_source` (commit `3553dd98a`, #5748) and `vix_term` (commit
`c2d93ef1d`, #6461) — both documented as "never reassigned, inherited `emptyDeskPayload`'s
placeholder forever." Neither of those fixes touched `available` itself, so this third instance
of the same class remained live and unfixed on `main` until now.

### Fix

`mergePulseIntoDesk`'s return object now assigns `available: pulse.available || base.available`.
Mirrors the gate at the function's other call site (`mergeDeskLayers` only invokes
`mergePulseIntoDesk` when `pulse.available` is already true) while correctly handling the
fallback-shell case where `base.available` starts false: the merged shell becomes available the
moment either side has real data, and — importantly — stays honestly unavailable when neither
side does (never fabricated to `true`).

### Blast radius

Single call site, single field. `mergePulseIntoDesk` has exactly two callers
(`mergeDeskLayers`, gated on `pulse.available` already being true — this fix is a no-op there
since `pulse.available || base.available` is already true; and `deskShellFromPulse`, the
fallback-shell path this bug actually affects). No other function reads/derives `available`
differently for this payload shape.

### Tests

`src/features/spx/lib/spx-desk-merge.test.ts` — 3 new cases: merged shell becomes available when
pulse has real data and base (the empty fallback shell) does not (RED→GREEN confirmed against
pre-fix source); stays available when base was already a real build (no regression); stays
honestly unavailable when neither side has real data.

| **Gates** | `npx tsc --noEmit` clean · `npm test` full suite (Node 20.20.2, see run log). |
| **Status** | FIXED — PR TBD. |
