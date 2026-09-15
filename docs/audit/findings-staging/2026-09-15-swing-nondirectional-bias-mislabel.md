> **kind:** FINDING

## Two swing play-brief sections badged a healthy/top-ranked SHORT play "bullish" (Largo C5) — FIXED

**Status:** FIXED — `fix/swing-nondirectional-bias-mislabel`

### Root cause

`thesisHealthSection` (`src/lib/swing/play-brief.ts`) mapped `h.health` — a direction-agnostic
"is the setup intact" score (persistence/entry-geometry/flow/regime/theta pillars,
`thesis-health.ts`) — straight to a bullish/bearish `bias` field: `h.health >= 65 ? "bullish" :
h.health < 45 ? "bearish" : "neutral"`. `laneRankSection` (`src/lib/swing/play-brief-lane-rank.ts`)
had the identical bug class, mapping `deltaFromMedian` (a relative entry-score rank, also
direction-agnostic) the same way.

For a SHORT play whose thesis is performing exactly as intended (price correctly falling,
`health >= 65`), the Thesis health section badged itself green **"Bullish"** — the literal
opposite of what the trade is betting on. Same for a top-ranked SHORT in `laneRankSection`
(`deltaFromMedian >= 10`). This directly contradicts the envelope's own top-level
`biasFromDirection(play.direction)` (`"bearish"` for a SHORT), which a member reading the same
brief sees right above these sections.

This is real, reachable UI, not inert JSON: `BieSectionCard.tsx:20` renders `section.bias` via
`<BiasPill bias={section.bias}>` (`BieChips.tsx`, explicitly documented "Directional bias pill"),
color-coded green(bullish)/red(bearish) in `globals.css`.

### Evidence

- Direct source read confirmed both mappings verbatim.
- Confirmed `BieSectionCard.tsx:20`'s `{section.bias ? <BiasPill bias={section.bias} /> : null}`
  render path — a real, member-facing color-coded pill, not a passthrough field.
- Live cross-check: current board (82 committed SWING positions) has zero committed SHORTs with
  `thesisHealth` wired (only 2 SHORT rows exist, both WATCH candidates with no `thesisHealth`), so
  the buggy path did not fire live today — but it is unconditional and will fire on the next
  committed SHORT with `health >= 65` or a top-ranked SHORT.
- Verified NOT a defect (ruled out during the same audit): `tradeManagerNarrativeSection`/
  `chartTechnicalsSection` deliberately derive bias from actual tape/technicals evidence
  independent of `play.direction` (explicit comment, `play-brief-narrative.ts:969-970`, FINDINGS
  2026-09-06: "a SHORT into a bullish tape must not badge bearish") — live-confirmed correct on a
  real AAPL SHORT WATCH candidate (top bias="bearish", "Trade manager read"="bullish", correctly
  flagging desk disagreement, not a bug).

### Blast radius

Two call sites, both isolated: `thesisHealthSection` (`play-brief.ts`) and `laneRankSection`
(`play-brief-lane-rank.ts`). No other section derives `bias` from a non-directional quality/rank
signal — every other section-level `bias` either matches `biasFromDirection` or is a deliberate,
documented tape-evidence-vs-direction disagreement signal (see above).

### Fix

Removed the `bias:` field from both sections' non-uncalibrated return paths — `bias` is already
optional on `RichSection`/`BieSectionCard`, so omission is the honest fix (a quality/rank score has
no direction of its own; forcing one onto it fabricates a market call that isn't there). Left the
`uncalibrated` branch's `bias: "neutral"` in `thesisHealthSection` untouched (harmless — "neutral"
never contradicts anything) to keep the fix minimal and scoped to the actual reported contradiction.

### Fix rationale

Omission over re-deriving a "correct" directional bias for these sections, because there isn't
one — health/rank say nothing about which way the trade should move. Matches the Largo product
contract's own absence-over-fabrication principle (the same discipline already applied to
`confidence` omission, C6).

### Tests

- `src/lib/swing/play-brief.test.ts`: new test — a calibrated SHORT fixture with `health: 80`
  asserts `thesis.bias === undefined` and `envelope.bias === "bearish"` (sanity).
- `src/lib/swing/play-brief-lane-rank.test.ts`: new test — a top-ranked (`#1 of 2`) SHORT fixture
  asserts `sec.bias === undefined`.
- RED→GREEN proof: `git stash` on both source files reproduced 2 failing tests (`actual: 'bullish'`)
  against the pre-fix tree; restoring the fix returned the suite to green (89/89 in
  `play-brief.test.ts`, full `play-brief-lane-rank.test.ts` green).
- `npx tsc --noEmit`: clean.
