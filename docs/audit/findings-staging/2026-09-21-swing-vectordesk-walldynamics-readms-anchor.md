> **kind:** FINDING

## Ask Largo swing play-brief: `wallDynamicsSection`/`vectorDeskSection` were the last two sections still sampling a bare `Date.now()` instead of `ctx.readMs` — #5351/#5392/#5393-class readMs-anchor bug — fix/swing-vector-desk-readms-anchor — 2026-09-21

| **Status** | FIXED |
|---|---|

- **What was broken:** `wallDynamicsSection(vec, sessionDate, bucket)` and `vectorDeskSection(vec,
  sessionDate, bucket)` in `src/lib/swing/play-brief-intel.ts` both gate their entire render on
  `vectorSnapshotStale(vec, readMs, sessionDate)`, but neither took `ctx` as a parameter at all —
  `wallDynamicsSection` called `vectorSnapshotStale(vec, Date.now(), sessionDate)` directly, and
  `vectorDeskSection` did `const readMs = Date.now();` and used that local sample. Both were flagged
  as an explicit, named open follow-up in the 2026-09-21 `catalystsSection` finding (this same
  staging directory), which noted the signature change these two needed and that they were outside
  #5392's original 9-site sweep and #5393's follow-up.
- **Why this matters in practice:** identical mechanism to every other entry in this bug class —
  `composeSwingPlayBrief` stamps one canonical `ctx.readMs` before any section runs specifically so
  every section in the SAME brief agrees on "now" even though sections run sequentially with real
  I/O between them (Vector fetch, GEX matrix fetch, Meridian fetch, etc). These two sections instead
  each sampled the real wall clock at whatever instant they happened to execute, so a Vector
  snapshot near the ~120s staleness boundary could be judged fresh by `wallDynamicsSection`/
  `vectorDeskSection` while the SAME snapshot, at the SAME real moment, was judged stale by every
  sibling section (`gexPostureSection`, `chartLevelsSection`, `chartTechnicalsSection`, the
  narrative/coaching family) that had already been anchored to `ctx.readMs`. `vectorDeskSection` is
  the section that renders the live entry-zone/targets/invalidation/"Watch now" directive block —
  the highest-stakes one in this file to get a stale-vs-live call wrong on.
- **Fix rationale:** thread a NEW trailing optional 4th parameter, `ctx?: SwingPlayBriefContext |
  null`, onto both functions — same backward-compatible pattern used throughout this bug class
  (`chartTechnicalsSection`, `catalystsSection`), chosen specifically so every existing call/test
  that passes only `(vec, sessionDate, bucket)` keeps compiling and behaving identically (falls back
  to a fresh `Date.now()`). Derive `const readMs = ctx?.readMs ?? Date.now();` at the top of each and
  use `readMs` at the one internal `vectorSnapshotStale(...)` call site instead of resampling the
  clock. Updated the one real production call site in `buildIntelSections`
  (`wallDynamicsSection(vec, ctx.sessionDate, bucket)` → `wallDynamicsSection(vec, ctx.sessionDate,
  bucket, ctx)`, same for `vectorDeskSection`) where `ctx` was already in scope.
- **Evidence / Test:** two new regression tests in `play-brief-intel.test.ts`, using the same
  fixed-future-anchor technique as every prior PR in this class: build a Vector snapshot with
  `asOf` fresh vs. the REAL wall clock (60s old, no `dataAgeMs` set, so `vectorAgeStale` falls back
  to its `readMs - Date.parse(vec.asOf)` branch — the exact branch this bug hits) but `ctx.readMs`
  pinned one year in the future. Asserted both ways: unanchored (`wallDynamicsSection(vec, null,
  "open")` / `vectorDeskSection(vec, null, "open")`) renders live (pre-fix AND post-fix — proves the
  fix is backward-compatible, not just that it changes behavior), while the anchored call
  (`..., ctx)`) must read stale. RED→GREEN proven via `git stash` on the implementation file only
  (test file kept): pre-fix, `wallDynamicsSection`'s new test failed (rendered the live wall-event
  body instead of `null`) and `vectorDeskSection`'s new test threw (its 4th param didn't exist yet,
  so the call silently fell through to the 3-arg overload and ctx was never consulted — the fixture
  needed correcting once during this pass, see below) — 2/189 fail in `play-brief-intel.test.ts`.
  Post-fix: `189/189` pass. `npx tsc --noEmit` clean, no type errors introduced by the new trailing
  param.
- **Blast radius:** two functions, one shared call site (`buildIntelSections`, both calls on
  adjacent lines). No other caller of either function exists in the codebase (verified via
  repo-wide grep for `wallDynamicsSection(` / `vectorDeskSection(` outside test files).
- **Scope closure — this class of bug is now fully closed in `play-brief*.ts`.** Repo-wide grep for
  every remaining bare `Date.now()` in `src/lib/swing/play-brief*.ts` (excluding tests) turned up
  only: (1) `play-brief.ts:1030` — the canonical stamp point itself, where `composeSwingPlayBrief`
  first derives `ctx.readMs` (correct by construction, this IS the source of the anchor); (2)
  `play-brief-context.ts:230` — used to build the brief's own display `asOf` field while
  constructing `ctx` in the first place, not a staleness comparison against a stored timestamp; (3)
  `play-brief-meridian.ts:41` — stamps a fresh `as_of` on the RESULT when a Meridian fetch fails
  (a "when did we discover this failure" timestamp, not a comparison against a stored `as_of` for
  staleness — a different category of `Date.now()` use entirely); (4) `play-brief-resolve.ts:179,
  187` — window-size math for a lookback query (`Date.now() - 90 days`), unrelated to staleness
  anchoring. None of these four match the bug pattern (comparing a stored freshness timestamp
  against "now" to decide whether to render/suppress/label data as stale). A future sweep should
  still re-grep rather than trust this count, per this file's own standing discipline, but as of
  this fix there is no further known follow-up in this specific bug class within the swing
  play-brief family.
