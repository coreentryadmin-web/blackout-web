## 2026-10-07 — [FINDING, P3 swing/Ask-Largo] `watchGateCoaching` silently dropped every gate past the 3rd, while the sibling count bullet and the uncapped "Entry" section both promise the real total — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/swing/play-brief-narrative-coaching.ts` (`watchGateCoaching`) |
| **Severity** | P3 — a real, member-visible self-contradiction inside a single Ask Largo play-brief envelope's own "Trade manager read" section, not a data-correctness or gate defect |
| **Found via** | Standing Ask Largo × Night Hawk Swings mandate deep-dive, live `GET /api/market/swing/play-brief?playId=SWING:WDC` against production (2026-10-07, WATCH bucket, `serving: COMMIT_NOW`, 4 active commit-gate blocks) |

### Root cause

A WATCH-bucket play-brief's "Trade manager read" renders two adjacent bullets built from the same
`play.gateBlocks` list, from two different functions, and they disagreed on how much of the list to
show:

- `actionNarrative` (`play-brief-narrative.ts`) states the **true, uncapped** count —
  `play.gateBlocks?.length ?? 0` — producing `"Entry stance — WAIT. 4 gates blocking entry — see
  below."`
- `watchGateCoaching` (`play-brief-narrative-coaching.ts`), the very next bullet the first one
  points to with "see below", used to `.slice(0, 3)` the SAME list before mapping it to text — with
  no `"+N more"` marker and no comment explaining the cap — silently dropping every gate past the
  third.

The "Entry" section (`watchEntrySection`, `play-brief.ts`) renders the identical `gateBlocks` list a
few lines earlier in the SAME envelope with no cap at all (`play.gateBlocks.map(...)`, full list).
So within one envelope: the Entry section shows all 4 gates, the count bullet says "4 gates... see
below", and the explanation bullet that promise points to shows only 3 — silently omitting whichever
gate sorted last.

Live repro (WDC, 2026-10-07, 11:0x UTC, `GET /api/market/swing/play-brief?playId=SWING:WDC`):
`play.gateBlocks` = `[g_s12_halt_feed_stale, g_s4_regime, g_s6_confluence, g_s14_cortex]` (4 real,
independently-evaluated commit gates — see `CLAUDE.md`'s swing gate-compound-funnel notes for what
each one means). The rendered envelope read:

```
Entry stance — WAIT. 4 gates blocking entry — see below.
Gates blocking entry — g_s12_halt_feed_stale: ... · g_s4_regime: ... · g_s6_confluence: ... .
```

`g_s14_cortex` ("Cortex preflight vetoed this setup — desk will not open.") never appears in the
coaching bullet — and it is arguably the single most decisive gate here, since it is the only one of
the four with no "clears when X" unlock story (it is a per-pass Cortex veto, not a time-of-day or
feed-health condition the member can simply wait out).

### Why it wasn't caught earlier

Every existing `watchGateCoaching` test (`play-brief-narrative-coaching.test.ts`) uses 1 or 2
`gateBlocks` fixtures — none ever exercised 4+ gates, so the `.slice(0, 3)` cap had no test that
could ever disagree with it. The two sibling renderers (`actionNarrative`'s count,
`watchEntrySection`'s full list) are in two other files with their own test suites, so nothing
cross-checked the three render paths against each other for the same play.

### Fix

Removed the `.slice(0, 3)` entirely — `watchGateCoaching` now maps and joins the full
`play.gateBlocks` list, matching `watchEntrySection`'s uncapped rendering and making the count
`actionNarrative` states actually equal to what gets explained. No length cap is reintroduced: the
only two render paths for this same data (`watchEntrySection`, `actionNarrative`'s count) already
carry the full list uncapped, so there is no existing convention to preserve by capping here, and
a silent drop is strictly worse than a long bullet. Added a regression test
(`watchGateCoaching: renders every gate, not just the first 3 (live WDC repro)`) with a 4-gate
fixture, proven RED pre-fix (`git stash` the fix, test fails with "the 4th gate must not be
silently dropped") and GREEN post-fix.

### Blast radius

`watchGateCoaching` has exactly one call site (`collectCoachingBullets`, same file) and is only
reached for WATCH-bucket plays with an active `gateBlocks` list — `tsc --noEmit` clean, full
`play-brief*`/`entry-enterability` test files (442 tests) and the file's own suite (148 tests) all
pass post-fix.
