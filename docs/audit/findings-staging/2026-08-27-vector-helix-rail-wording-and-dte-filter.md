> **kind:** `FINDING`

## Vector "Live Helix" rail showed 400+ day LEAPS prints as "Recent"/"Top by premium", plus verbose section wording — FIXED

| **Status** | FIXED |
|---|---|

**Context.** Operator report, verbatim: *"can we remove extra wordings on Helix rail —
'Recent · ranked by premium · 40 prints today' / 'Full Helix tape →' / 'Latest prints · by time' /
'Session rank' — move the Full Helix Tape below LIVE with an icon that's it"* and separately *"we
show random flows which is not needed — on Recent we show flows that expire 500 days from now, who
cares?? we need to show nearby expiry flows. we only show 3? maybe Recent should be 0-30 DTE only
and show more Recent, like 15 Recent and 15 Top by premium. Even Top By Premium shows contracts
477d/400+ days out — needs fixing with some logic."*

**Root cause — two distinct bugs, both in `src/features/vector/lib/vector-helix-flows.ts`.**

1. **No DTE ceiling anywhere in the rail's ranking.** `pickVectorLiveHelixLayout` ranked "Top by
   premium" by `compareLiveHelixByPremium` (premium desc) over the ENTIRE fetched pool, with zero
   regard for days-to-expiry, and "Recent" sorted the same pool by time — also with no DTE bound.
   A single large LEAPS print (which by definition carries much more premium per contract than a
   near-dated one, since it prices in far more time value) could sit at rank #1 all session.

2. **The pool itself was already crowded out, one layer up.** `trimVectorHelixFlowPool` (called
   from `use-vector-helix-flows.ts`'s `applySessionPool`) trims a 200-row session fetch down to
   `VECTOR_LIVE_HELIX_TAPE_CAP` (40) rows **sorted by premium only** — so even before
   `pickVectorLiveHelixLayout` ran, far-dated whale prints could already have displaced every
   near-dated print from the in-memory pool entirely. Fixing bug (1) alone would not have fixed the
   reported behavior for a liquid ticker, because the near-dated prints would already be gone by
   the time the rail's own filter ran.

**Evidence — live, against production** (`/api/market/flows`, temp Clerk session via
`scripts/audit/lib/prod-clerk-session.mjs`, read-only):

- `GET /api/market/flows?ticker=SPX&limit=200&since_hours=24&min_premium=200000` — top 15 by
  premium out of 200 rows were **all >45 DTE**: `$31.4M @ 85 DTE`, `$30.4M @ 113 DTE`, five prints
  at `$5.2-16.3M @ 294 DTE`, `$7.4M @ 386 DTE`, etc. DTE distribution across the 200 rows:
  `0-30: 40, 31-45: 0, 46-100: 45, 101+: 115`.
- Confirming bug (2): sorting those same 200 rows by premium and taking the top 40 (exactly what
  `trimVectorHelixFlowPool` does today) — **0 of the 40** were within 45 DTE, i.e. the shipped pool
  trim already excludes every near-dated SPX print before any section-level filter runs.
- Confirming the fallback need: `GET ...&ticker=ASTS...` returned only 3 rows all session, at 50,
  141, and 568 DTE — an illiquid name can have genuinely *no* near-dated flow that day, so a bare
  DTE ceiling with no fallback would blank the rail entirely for names like this.

**Fix.**
- New `filterByMaxDte(flows, maxDte, fallbackN)` in `vector-helix-flows.ts`: keeps flows within
  `maxDte`; if that window matches **nothing at all**, returns the `fallbackN` nearest-DTE flows
  instead of an empty list (mirrors the existing "return the nearest, never blank" rule
  `expiriesForHorizon` already uses for wall expiries in `vector-dte-horizon.ts`, so this repo now
  has one consistent honest-fallback convention for DTE windows, not two).
- `trimVectorHelixFlowPool` now DTE-bounds the pool FIRST (`VECTOR_HELIX_POOL_MAX_DTE = 60`,
  deliberately wider than either section ceiling below so it is never itself the bottleneck),
  *then* sorts by premium — fixing bug (2) at the source instead of only downstream.
- `pickVectorLiveHelixLayout` now DTE-bounds each section independently before ranking/sorting:
  - Recent: `VECTOR_HELIX_RECENT_MAX_DTE = 30` (operator's exact number — "Recent should be 0-30
    DTE only").
  - Top by premium: `VECTOR_HELIX_RANKED_MAX_DTE = 45` — operator suggested "0-45 or 0-60"; 45 was
    picked to give headroom above this repo's existing "monthly" DTE-horizon convention
    (`vector-dte-horizon.ts`'s `HORIZON_MAX_DTE.monthly = 35`) without being as wide as 60, so a
    legitimate few-weeks-out monthly print can still rank while pure LEAPS cannot.
  - Both display caps raised `VECTOR_LIVE_HELIX_RECENT_N` and the new
    `VECTOR_LIVE_HELIX_RANKED_DISPLAY_N` to 15 (was 3 for Recent; Top-by-premium's display was
    implicitly capped at the 40-row pool cap, not a deliberate display count) per the operator's
    "15 Recent and 15 Top by premium" ask. `VECTOR_LIVE_HELIX_TAPE_CAP` (40) is unchanged and still
    governs the underlying in-memory pool size/fetch trim — only the two section DISPLAY caps
    changed.
- Wording/layout (`VectorHelixRail.tsx` + `globals.css`): removed the header subtitle line
  (`vectorLiveHelixSubtitle`'s "Recent · ranked by premium · N prints today") and both per-section
  kicker lines ("Latest prints · by time" / "Session rank") entirely — section labels ("Recent" /
  "Top by premium") are unchanged, only the qualifier text under them is gone. Moved the
  "Full Helix tape →" text link into a new `.vector-helix-head-actions` column directly under the
  LIVE/STALE `FreshnessChip`, replaced with an icon-only `lucide-react` `ExternalLink` (the same
  icon already used for this purpose elsewhere in the repo — `LearnSectionBlocks.tsx`,
  `LargoSlashPromptsMenu.tsx`), keeping `aria-label`/`title` for accessibility without a visible
  label.

**Blast radius.**
- `vector-helix-flows.ts`: `trimVectorHelixFlowPool`'s new third parameter has a default, so its
  one call site (`use-vector-helix-flows.ts`'s `applySessionPool`) is unaffected without a code
  change there. `pickVectorLiveHelixLayout`'s new `recentMaxDte`/`rankedMaxDte` opts are both
  optional with defaults — its only call site (`VectorHelixRail.tsx`) needed no changes either.
- The pool (`helixState.flows`) is shared with the Suggested Play engine
  (`vector-play-candidates.ts`, via `VectorPageShell.tsx`'s `sessionHelixFlows` prop) — checked
  before tightening the pool's DTE composition. That engine's own DTE windows top out at
  `DTE_WINDOWS.monthly.maxDte = 35`; it never uses a flow beyond that regardless of what the pool
  holds, so narrowing the pool to `<=60 DTE` cannot remove anything the Suggested Play engine could
  have used — if anything it removes only dead weight that engine already ignored.
- `vectorLiveHelixSubtitle` is left in place (still exported, still covered by its existing test)
  in case another consumer wants it later; it is simply no longer called from the rail.

**What was deliberately left unchanged.** `VECTOR_LIVE_HELIX_SESSION_FETCH_LIMIT` (200, the raw
fetch size from the API) and `VECTOR_LIVE_HELIX_TAPE_CAP` (40, the pool size) were not touched —
only the pool's *composition* (DTE-bounded-then-premium-sorted instead of premium-sorted-only) and
the two section DISPLAY caps changed. A tighter Recent/Ranked DTE ceiling could theoretically show
fewer than 15 rows for a thin ticker with few near-dated prints that day — that is the honest
tradeoff named in the task and considered acceptable (matches the operator's own suggested
fallback, "show fewer than 15 rather than showing nothing"); the nearest-DTE fallback in
`filterByMaxDte` only engages when a section's window would otherwise be completely empty, not
merely thin.

**Verification.** `npx tsc --noEmit` clean (Node 20). New/changed tests in
`vector-helix-flows.test.ts` (11 new cases covering `filterByMaxDte`'s window + honest-fallback
behavior, `trimVectorHelixFlowPool`'s far-dated-whale exclusion, and
`pickVectorLiveHelixLayout`'s per-section DTE bounds + raised display caps) and a new
`VectorHelixRail.test.ts` (source-invariant, matching the existing `vector-ios-native.test.ts`
idiom for this feature) covering the wording/layout change — both pass on Node 20
(`npx tsx --test`). Full repo suite run on Node 20 as part of this PR (see PR description for the
pass/fail count at time of merge).
