> **kind:** FINDING

## Meridian desk: clicking an earnings row from the mega-cap week grid, estimate-revision timeline, or calendar-update feed can silently fail to open anything — FIXED

**Status:** Fixed, regression test added (`src/features/meridian/lib/meridian-timeline.test.ts`).

### Root cause

`MeridianDesk.tsx` renders four surfaces that let a reader click a ticker to open its earnings
event: the analytics-grid print clock/scatter/calendar/table (via `selectEarningsTicker`), the
"Mega-cap earnings week" grid, the "Estimate revisions (36h)" list, and the "Calendar updates
(36h)" list. The latter three built the target id by hand:

```ts
onClick={() => {
  setSelectedId(`earnings:${row.ticker}:${row.date}`);
  setView("timeline");
  setFilter("earnings");
}}
```

That id format matches `earningsId()` in `meridian-timeline.ts`, but matching the FORMAT isn't
enough — the id also has to name a row that actually exists in `allItems`, the timeline the
member is looking at. It doesn't always:

- `allItems` comes from `loadMeridianEarningsTimeline`, which deliberately drops any earnings
  print on a ticker with **no listed options chain** (`partitionOptionable`, documented inline:
  "a print with no chain is a row a member cannot act on").
- `earnings_week`, `estimate_revision_timeline`, and `recent_earnings_revisions` (the three
  panels with the hand-built click handlers) are built from `loadBenzingaEarningsBundle`'s
  **raw, unfiltered** `window_rows`/`revisionRes.rows` — no optionable filtering at all
  (`buildEarningsWeekRows`, `buildRecentEarningsRevisions`, `diffEstimateRevisionTimeline` in
  `meridian-benzinga-earnings-core.ts` / `meridian-benzinga-earnings.ts`).

So any importance≥4 print, estimate revision, or calendar update on a ticker with no listed
options chain appears in these three panels but has **no corresponding row in `allItems`**.
Clicking it sets `selectedId` to an id that resolves to nothing: `activeItem` falls through all
three fallbacks (`filteredItems.find` → `allItems.find` → the ticker-lookup item) to `null`, and
the detail pane renders `MeridianEmpty message="Select a catalyst to open the structure brief."`
— after the click also force-switched the view to Timeline and the filter to Earnings. The
member clicked a specific, named print and landed on an unrelated empty state with no
explanation, which reads as a broken button, not an absence.

The component already had the correct pattern for this exact failure mode —
`selectEarningsTicker` (used by the analytics-grid panels) looks the ticker up in `allItems`
first and no-ops if there's no match, with an inline comment explaining why: "When the window
has no timeline row for that ticker... the click is a NO-OP rather than a navigation to
nothing — silently switching views to an unchanged timeline reads as a broken button." The
three other click handlers simply didn't call it — a duplicated-logic-drift bug: the safe
lookup existed, and three sibling call sites bypassed it with their own unchecked template
literal instead.

### Evidence

Added `findEarningsTimelineItemId()` (the single shared lookup, used by all four call sites
now) with unit tests in `src/features/meridian/lib/meridian-timeline.test.ts`:

- RED (pre-fix, function didn't exist): 4 new tests fail with
  `(0 , import_meridian_timeline.findEarningsTimelineItemId) is not a function`.
- GREEN (post-fix): all 12 tests in the file pass, including:
  - resolves the real row id case-insensitively when a matching earnings row exists;
  - returns `null` — the no-op signal — when the ticker has no timeline row (the exact
    optionable-filtered-out case above);
  - never matches a non-`earnings`-kind row by ticker;
  - blank/whitespace ticker never matches.

`npx tsc --noEmit` clean on the worktree.

### Blast radius

Three call sites in `MeridianDesk.tsx` shared the same bug (one root cause, not three
independent ones): the "Mega-cap earnings week" grid, "Estimate revisions (36h)" list, and
"Calendar updates (36h)" list. All three now call the same shared, tested lookup and no-op
when the ticker isn't in the current timeline, matching `selectEarningsTicker`'s existing,
documented behavior. `selectEarningsTicker` itself was also switched to call the new shared
helper instead of its own inline duplicate of the same lookup, so there is now exactly one
place this logic lives.

### Fix rationale

Extracted the lookup into `findEarningsTimelineItemId()` in `meridian-timeline.ts` (exported
alongside the sibling `earningsId`/`parseMeridianEventId` helpers) rather than patching each
`onClick` with its own existence check, because the duplication — not the missing check alone —
is what let three of four call sites drift from the one that already got this right. A pure,
exported function is also the only way to put this under a real `tsx --test` regression test;
the component itself can't be (no React Testing Library in this repo, same constraint every
Meridian panel file's own comments already note). Deliberately left unchanged: the underlying
optionable filter itself (`loadMeridianEarningsTimeline`'s drop of non-optionable prints) and
the three panels' decision to stay unfiltered (`earnings_analytics_core.ts`'s own comment:
"Analytics needs the whole window") — both are intentional, documented design choices; the bug
was only in how a click against the filtered timeline was resolved, not in which rows these
panels show.
