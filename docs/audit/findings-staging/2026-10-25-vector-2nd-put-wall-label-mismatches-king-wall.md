> **kind:** `FINDING`

## Vector — live `/vector` play card's "2nd put wall" label points at the visually-dominant (king/trophy) GEX strike, while the unqualified "put wall" points at a weaker one — possible wall-source mismatch, open

**Status:** OPEN — needs the owning Vector lane to trace which `gexWalls` source feeds
`vector-play-engine.ts`'s `collectLevels()` vs. which feeds the on-screen GEX MATRIX ladder, and
confirm whether they can legitimately disagree or are drifting.

### Area

`/vector` desk (non-owned, Vector lane) — the live SCALP play card's headline/targets
(`src/features/vector/lib/vector-play-engine.ts`'s `collectLevels()`/`pickTargets()`) vs. the
GEX MATRIX side panel ladder (same page).

### Found by

Live-UI visual check via `proxy-browser.cjs` against prod `/vector` (desktop viewport 1440×900,
`--desktop`), DISCOVERY-lane sweep, 2026-10-25, ~11:20 AM ET (market closed, Sunday — SPX spot
7,623.68, 0DTE nearest expiry Oct 26).

### Symptom

Live screenshot (`https://blackouttrades.com/vector`, desktop):

- **GEX MATRIX ladder** (left panel) shows strike `7,620` with `-$374.6M` GEX, marked with a gold
  trophy/king icon (the visually dominant strike in the visible range — the single largest
  magnitude). Strike `7,600` shows `-$250.3M` — smaller magnitude, no king marker.
- **SCALP play card** (same page, same instant) headline: *"SCALP · momentum short on
  continuation → target 2nd put wall 7,620"*; its `TARGETS` line: *"2nd put wall 7,620 → put wall
  7,600 → 1σ 7,554.31"*.

So the play card's unqualified **"put wall"** (the label `vector-play-engine.ts` assigns to
`gexWalls.putWalls[0]`, documented as the STRONGEST put wall by gamma-share — see the existing
FINDINGS.md entry *"Vector play engine: secondary gamma wall rendered under the identical 'call
wall'/'put wall' label as the primary — FIXED"*) is `7,600`, the WEAKER strike by the GEX MATRIX
panel's own numbers — while **"2nd put wall"** (`gexWalls.putWalls[1]`, documented as the
second-strongest) is `7,620`, the strike the GEX MATRIX panel itself marks as the single strongest
(king) wall in view.

### Why this isn't a confirmed bug yet

The cited prior fix (same file) explicitly establishes that `gexWalls.putWalls` is sorted by
`.pct` (gamma-share strength) descending, NOT by distance to spot, and that "the second-strongest
wall can legitimately sit CLOSER to spot than the strongest one" — so the ORDER of the two target
prices in the headline (nearest-to-spot first: 7,620 before 7,600) was already known to be
independent of which one gets the "2nd" qualifier. That part is working as designed.

What is NOT yet established is whether `gexWalls.putWalls[0]`/`[1]` (the play engine's input) and
the GEX MATRIX panel's own per-strike magnitudes come from the **same underlying GEX computation**.
If they're two independently-derived wall sets (plausible — this repo has at least three GEX-wall
builders: `src/lib/providers/gex-wall-levels.ts`'s `computeGexWalls` sorted by `.pct`,
`src/features/vector/lib/vector-gex-ladder.ts`'s `byStrength` sort, and whatever feeds the GEX
MATRIX display component directly), the "strongest"/"2nd" labels in the play card could be
correctly ranking a DIFFERENT, possibly stale or differently-scoped GEX reading than the one the
member is looking at in the adjacent ladder — which would make "2nd put wall" point at the strike
the member's own eyes tell them is the primary one. That is the member-facing contradiction worth
investigating, not the ordering logic itself (which the prior fix already covers).

### Next step (for whoever picks this up)

Trace the live data flow for a single `/vector` render: which `GexWalls` object does
`vector-play-engine.ts`'s `collectLevels()` actually receive at runtime (prop drilling /
`vector-full-state` fetch), and does the GEX MATRIX ladder component read `strikeTotals`/the same
ladder Map, or a separately-fetched/cached snapshot? If both ultimately derive from the identical
ladder at the identical instant, re-verify this specific repro (SPX, 2026-10-25 ~11:20 AM ET,
7,620 vs 7,600) against live data before concluding anything — a single screenshot is evidence, not
proof, and the two widgets may simply have been captured at a few seconds' difference during a
Sunday no-market idle-data window where nothing was actively refreshing.

Not fixed in this pass — scope (tracing 3 separate GEX-wall builders + confirming which backs each
widget) exceeds a single DISCOVERY-cycle fix; flagging for the Vector lane / a dedicated follow-up
measurement, per the existing `docs/audit/INTENTIONAL-DESIGN.md`-style discipline of writing up
rather than guessing at cross-widget data-provenance questions.
