> **kind:** FINDING

## Night Hawk Legacy edition `market_recap.spx_desk.hod`/`lod` can serve a stale, sticky-ratcheted extreme that contradicts the same response's own daily bar — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** five-engine live monitor, Night Hawk Legacy lane (`GET /api/market/nighthawk/edition`
live repro, 2026-11-01).

**Confirmed bug:** the edition response carries two independently-computed SPX "today" summaries
that disagreed on the same fact (today's SPX session high) in a way that cannot both be true.
`market_recap.spx_vix` (built by `spxContext()`, `src/features/nighthawk/lib/format.ts`, straight
off `ctx.spx_bars` — the real daily OHLC bar) read `SPX 7580.07 (-1.82%) · H 7637 L 7528`, and
`recap_summary`/`market_recap.catalysts` explicitly narrated `"Gap & go: Gap down -1.16% to
7631.07 — continued lower, last 7580.07"` — i.e. the session opened near 7631 and only moved
lower from there. But the SAME response's `market_recap.spx_desk` (fetched via
`marketPlatform.spx.getSpxDeskSummary()`, `edition-builder.ts`, which runs through
`mergeDeskLayers`/`mergePulseIntoDesk`) reported `hod: 7758.43` for the identical session — 121
points (1.6%) above the daily bar's own H (7637) and even above the session's own prior-day high
(`pdh: 7732.21`). A session that gapped down and "continued lower" cannot also have traded as high
as 7758 that same day.

**Root cause:** `stickyStructureLevel`'s hod/lod branch (`src/features/spx/lib/spx-desk-merge.ts`)
took `Math.max`/`Math.min` across `[pulseVal, baseVal, lastGoodStructure[key], livePrice]`
**unconditionally, every cycle** — including cycles where `pulseVal`/`baseVal` were both genuinely
fresh. That makes the sticky cache a one-way trap: the instant any single cycle feeds a bad or
stale candidate into `pulseVal` (off-hours, the pulse lane's own "serve the last RTH print"
shortcut — `lastPulseForSignals`, `src/features/spx/lib/spx-desk.ts` — carries a snapshot forward
with **no session-date staleness check of its own**, unlike this file's `lastGoodStructure`/
`lastGoodStructureSessionDate`), `lastGoodStructure.hod` latches onto it and then re-enters that
same inflated value into the max on every subsequent cycle, permanently out-ranking a correct,
fresh `baseVal` (the full desk build, which recomputes `hod`/`lod` from real settled minute bars
on every poll regardless of market hours) for the rest of the session. Every OTHER key in this
same function (`pdh`/`pdl`/`vwap`/the EMAs) already has the correct contract —
`pulseVal ?? baseVal ?? lastGoodStructure[key] ?? null`, fresh always wins outright — hod/lod were
the two keys still exempt from it, deliberately ("a different, max/min-based formula... left
unchanged") for a narrow, legitimate reason (letting the live index tick widen a lagging
minute-bar HOD/LOD during RTH) that the unconditional max/min over-applied off-hours too, where
there is no live spot to reconcile against at all.

**Fix:** `stickyStructureLevel`'s hod/lod branch now only takes the max/min-with-sticky-fallback
path when `livePrice != null` (RTH, a live spot genuinely needs reconciling) — preserving the
existing, tested "pulse gaps must not drop HOD/LOD" / "live spot outruns the bar lane" behavior
exactly as before. When `livePrice == null` (off-hours/no RTH tick — the case this bug hit), it
instead resolves `baseVal ?? pulseVal ?? lastGoodStructure[key]`, the same "fresh wins, sticky is
the last resort" contract every other key already uses. `baseVal` goes first specifically because
it is independently recomputed from real settled minute bars every poll, while off-hours
`pulseVal` is exactly the un-revalidated carried-forward snapshot that caused this.

**Evidence (RED → GREEN):** added 4 cases to `src/features/spx/lib/spx-desk-merge.test.ts`
(`"mergePulseIntoDesk off-hours hod/lod sticky-ratchet correction"`). RED (confirmed via a
`git show origin/main:...` copy of the pre-fix file, run with
`npx tsx --experimental-test-module-mocks --test spx-desk-merge.test.ts`): 2 failing —
`7758.43 !== 7637` (hod) and `7200 !== 7528` (lod), both exactly reproducing the live contradiction
shape. GREEN (post-fix): 23/23 pass in that file, 100/100 across the whole `spx-desk*.test.ts`
family. `npx tsc --noEmit`: clean.

**Blast radius:** `stickyStructureLevel` is module-private, called only from `mergePulseIntoDesk`
in this same file, which every consumer (`mergeDeskLayers`/`spx-desk-loader.ts`,
`spx-play-engine.ts`, the client `useMergedDesk.ts` hook) already routes through — so the single
fix covers every surface that reads merged SPX `hod`/`lod` (`/api/market/spx/merged`,
`/api/market/spx/play`, Largo's `get_spx_structure`/`get_spx_desk` tools, the Night Hawk Legacy
edition's `market_recap.spx_desk`), not just the edition route the live repro happened to surface
it on. No other call site in the repo reimplements this max/min-ratchet pattern (`grep` for
`Math.max(...candidates)`/`Math.min(...candidates)` returns only this one site).
