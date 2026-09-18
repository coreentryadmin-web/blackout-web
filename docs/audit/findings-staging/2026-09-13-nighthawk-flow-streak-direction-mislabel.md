> **kind:** FINDING

## Night Hawk thesis's flow-streak sentence fabricated agreement with the play's direction

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `buildDeterministicThesis` (`src/features/nighthawk/lib/deterministic-edition.ts`) — the flow-conviction sentence in the member-facing thesis text |
| **Severity** | P2 — a real narrative-correctness defect: a disagreeing flow signal was presented as corroborating evidence for the trade. No crash, no data loss, but a member reading the thesis was told the opposite of what the ticker's own flow history actually showed. |

### Root cause

`dossier.flow_streak` is a **ticker-level** measurement — a 10-day DB rollup of net daily
call/put premium (`flow-streak.ts`'s `computeFlowStreakFromBuckets`), computed independently of
which direction a given candidate is ultimately scored or published for. It can legitimately
disagree with the play's own chosen direction: strong technicals/news can make a candidate LONG
even while its recent options flow has actually been net-PUT (bearish) for several days.

`scorer.ts`'s own `scoreFlowQuality()` already guards its *scoring* bonus on this exact agreement
check, per its own audit comment:

```ts
// Raw flow-implied direction, computed BEFORE the streak bonus below...
// flowStreak.direction comes from a DIFFERENT population than `flows`...used to be added to
// score unconditionally, regardless of which way it pointed relative to tonight's flow...
if (flowStreak?.streak_days && flowStreak.direction === direction) {
  score += streakBonusPoints(flowStreak.streak_days, streakWeight);
}
```

But that guard only controls **points** — the thesis **text** at `buildDeterministicThesis`'s
flow-conviction branch never checked it:

```ts
if (scored.flow_score >= 20) {
  const flowParts: string[] = [];
  if (dossier?.flow_streak?.streak_days && dossier.flow_streak.streak_days >= 2) {
    flowParts.push(`${dossier.flow_streak.streak_days}-day ${dirWord} flow streak`);
  }
  ...
```

`dirWord` here is `scored.direction !== "short" ? "bullish" : "bearish"` — the **play's** own
direction, not the streak's. And `scored.flow_score` can clear its own `>= 20` threshold purely
from tonight's live flow data (`totalPrem >= 5_000_000` alone gives 15 points, `sweepPct >= 0.8`
gives another 10) with **zero contribution from the streak bonus** — so this branch can and does
fire even when the streak itself disagreed with the play's direction and never earned its bonus.

Reproduced directly:

```ts
// scored.direction: "long", flow_score: 30
// dossier.flow_streak: { streak_days: 4, direction: "short", ... }
buildDeterministicThesis(scored, dossier).thesis
// -> "...4-day bullish flow streak with aggressive options activity..."
// (before the fix — the streak was actually a 4-day BEARISH/PUT-dominated streak)
```

### Blast radius

Only this one sentence in `buildDeterministicThesis` was affected — the sibling low-flow-score
branch two lines below (`"{streak_days}-day flow streak building."`) already used
direction-neutral wording (no `dirWord`) and needed no change. No other consumer of
`dossier.flow_streak` was found to make the same mistake.

### Fix

The streak clause now derives its direction word from the streak's own `direction` field
(`"short"` → `"bearish"`, `"long"` → `"bullish"`), falling back to the play's `dirWord` only when
a dossier carries no streak direction at all (a defensive default — every existing test fixture
in this file omits the field, so this preserves their behavior unchanged).

### Why this fix, not an alternative

Considered instead omitting the streak clause entirely when it disagrees with the play's
direction — rejected because silently dropping a real, measured signal loses information a
member might reasonably want (a disagreeing streak is itself useful context, e.g. "flow just
turned bullish after 4 bearish days"). Stating the streak's true direction is the minimal fix that
removes the fabrication without discarding real data; a richer "despite a 4-day bearish streak"
framing is a narrative enhancement beyond the scope of this correctness fix, not attempted here.

### Evidence

- Reproduced directly via `buildDeterministicThesis` with a synthetic LONG-scored candidate and a
  bearish `flow_streak`: printed `"4-day bullish flow streak"` before the fix, `"4-day bearish
  flow streak"` after.
- RED: reverted `deterministic-edition.ts` only (kept the 3 new tests), 1/3 new tests failed (the
  disagreement case, exactly as predicted — the agreement and no-direction-field cases pass
  regardless since `dirWord` and the streak's true direction coincide in those fixtures).
- GREEN: restored the fix, all 63 tests in `deterministic-edition.test.ts` pass (60 pre-existing +
  3 new).
- `npx tsc --noEmit`: clean.
- Full suite (Node 20): 14023 pass / 0 fail / 3 skipped.

### What was deliberately left unchanged

`scorer.ts`'s own scoring-bonus guard (already correct — this fix only closes the parallel gap in
the narrative text) and the direction-neutral low-flow-score branch (never claimed a direction,
nothing to fix).
