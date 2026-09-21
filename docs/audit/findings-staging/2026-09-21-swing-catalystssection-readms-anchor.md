> **kind:** FINDING

## Ask Largo swing play-brief: `catalystsSection` sampled a fresh `Date.now()` for both its freshness-bearing fields instead of `ctx.readMs` — #5351/#5392-class readMs-anchor bug, not among the 9 sites #5392 fixed — fix/swing-catalystssection-readms-anchor — 2026-09-21

| **Status** | FIXED |
|---|---|

- **What was broken:** `catalystsSection(eco: EcosystemContext | null)` in `src/lib/swing/play-brief-intel.ts`
  renders earnings date, short-interest fundamentals, news headlines, and peers for a swing play
  brief. Two of those reads are freshness-bearing (`arsenal.fundamentals.as_of`,
  `arsenal.news.as_of`), and both staleness checks sampled a bare `Date.now()` directly
  (`fundamentalsAncient(arsenal.fundamentals.as_of, Date.now())` and
  `newsCatalystStale(arsenal.news.as_of, Date.now())` / `newsCatalystAgeMs(..., Date.now())`)
  instead of the request-wide `ctx.readMs` anchor `composeSwingPlayBrief` stamps once before any
  section runs (per #5351). `catalystsSection` did not even take `ctx` as a parameter, unlike the
  9 sibling sections PR #5392 fixed the same day (`chartTechnicalsSection`, `preferredGexWalls`,
  `chartLevelsSection`, `meridianCatalystSection`, `gexPostureSection`, `buildStructureLadder`,
  `collectFocalLevels`, `resolveBreakInvalidation`, `tradeManagerNarrativeSection`) — confirmed
  against #5392's own merged diff, which never touches this function.
- **Why this matters in practice:** a real request runs sections sequentially with real I/O
  between them, so `catalystsSection`'s own two internal `Date.now()` samples can each land on a
  different real instant, and can disagree with a sibling section (e.g. `meridianCatalystSection`,
  now anchored via #5392) about whether the same underlying arsenal snapshot should be treated as
  stale — the exact "same fact, two answers within one envelope" defect class #5351/#5392 already
  fixed elsewhere in this file, left open here because this function was outside that sweep's grep
  scope (it read `Date.now()` with no `ctx` param in sight at all, so a naive "does this call
  `ctx.readMs`" grep would miss it just as easily as a naive "does this call `Date.now()`" grep
  would flag every other correctly-anchored call site).
- **Fix rationale:** thread an optional `ctx?: SwingPlayBriefContext | null` second parameter
  (same pattern `chartTechnicalsSection` and `expectedMoveCoaching` already use for backward
  compatibility — existing callers/tests that construct `catalystsSection(ecosystem)` alone are
  unaffected, falling back to a fresh `Date.now()` exactly as before), derive
  `const readMs = ctx?.readMs ?? Date.now();` once at the top of the function, and use `readMs` at
  both internal call sites instead of resampling the clock. Updated the real production call site
  in `buildIntelSections` (`catalystsSection(ecosystem)` → `catalystsSection(ecosystem, ctx)`) where
  `ctx` was already in scope.
- **Evidence / Test:** the two regression tests already existed in `play-brief-intel.test.ts` —
  written by a prior cycle alongside #5392 to document this exact gap before it was fixed
  (`catalystsSection: uses ctx.readMs as the staleness anchor for fundamentals, not the real wall
  clock` and the news-headlines sibling), using the same fixed-future-anchor technique as #5392's
  own tests: `ctx.readMs` pinned one year in the future while the underlying `as_of` is fresh vs.
  the *real* wall clock, so a pre-fix run reads it as fresh (wrong) and a post-fix run reads it as
  ancient/stale under the anchor (correct). RED→GREEN proven via `git stash` on the implementation
  file only (test file kept): pre-fix `2/187 fail` in `play-brief-intel.test.ts` (exactly the 2
  target tests); post-fix `187/187` pass. `npx tsc --noEmit` clean. Full `src/lib/swing/*.test.ts`
  suite: 1465/1465 — no collateral breakage.
- **Blast radius:** single function, single call site (`buildIntelSections`). No other caller of
  `catalystsSection` exists in the codebase.
- **Follow-up, not started:** `vectorDeskSection`/`wallDynamicsSection` (flagged as a genuine open
  follow-up by #5392's own finding — need a signature change to accept `ctx` since neither
  currently takes any context-shaped parameter) remain unfixed; a future sweep should re-grep
  `play-brief*.ts` for `Date.now()` rather than trusting any prior count (including this one) as
  exhaustive.
