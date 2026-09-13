> **kind:** FINDING

# Night Hawk trend-conflict thesis sentence invented a flow signal that never existed

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `buildDeterministicThesis` (`src/features/nighthawk/lib/deterministic-edition.ts`) — the trend-conflict sentence in the member-facing thesis text |
| **Severity** | P2 — a real narrative-correctness defect: a specific, falsifiable evidentiary claim ("institutional money is bullish/bearish") was printed even when that evidence never existed for the pick. No crash, no data loss, but a member reading the thesis was told the pick was flow-driven when it may have been driven entirely by other factors. |

## Root cause

The `trendConflicts` branch fires purely off `dossier.tech.trend` disagreeing with `scored.direction` — it never checked which scoring dimension actually drove the final direction:

```ts
if (trendConflicts) {
  parts.push(`Flow conviction overrides ${trend} technicals — institutional money is ${dirWord}.`);
}
```

Reproduced directly: a candidate scored with `flow_score: 0` (zero/negligible flow) whose direction was actually driven by `news_score: 20` + `smart_money_score: 15` still printed:

```
"Flow conviction overrides bearish technicals — institutional money is bullish"
```

— a specific, falsifiable claim about flow/institutional activity that never happened for this pick, misattributing the real reason (news + smart money) to a fictitious flow narrative.

This is the same class of defect as the sibling flow-streak fix shipped earlier this session (PR #4892) — a sentence asserting agreement/evidence from a signal source without checking whether that source actually contributed — but in a different sentence and a different failure mode (inventing evidence rather than mislabeling real evidence's direction).

## Blast radius

Only this one sentence was affected. The catalyst headline and smart-money driver note sections a few lines below already correctly gate on `topDrivers.some((d) => d.label === "...")` before naming a specific evidence source — this sentence was the one place in the function that named a source (flow/"institutional money") unconditionally.

## Fix

The sentence now names whichever dimension is actually the top scoring driver, reusing the same `topDrivers` computation the catalyst and smart-money sections already gate on:

- `"flow"` leads → the original `"Flow conviction overrides {trend} technicals — institutional money is {dirWord}."` wording, unchanged.
- `"smart-money"` leads → `"Smart-money conviction overrides {trend} technicals."`
- `"news"` leads → `"News conviction overrides {trend} technicals."`
- `"positioning"` leads → `"Options-positioning conviction overrides {trend} technicals."`
- Anything else (e.g. `"technicals"` itself, a genuinely ambiguous case) → nothing is appended, rather than guessing.

## Why this fix, not an alternative

Considered a single generic sentence ("Score conviction overrides {trend} technicals") that never names a specific source — rejected because it throws away real information the codebase already computes and uses elsewhere in the same function (the catalyst/smart-money sections both name the specific driving evidence). Naming the real top driver is the minimal fix that removes the fabrication without losing specificity.

## Evidence

- Reproduced directly via `buildDeterministicThesis`: printed `"Flow conviction overrides bearish technicals — institutional money is bullish"` for a `flow_score: 0`/news+smart-money-driven candidate before the fix; `"News conviction overrides bearish technicals"` after.
- Confirmed the existing PR-N28 test (`flow_score: 18`, genuinely the top driver in that fixture) still gets the original `"Flow conviction... institutional money is bullish"` wording verbatim — the fix only changes behavior when flow is NOT actually the top driver.
- RED: reverted `deterministic-edition.ts` only (kept the 2 new tests), 1/2 new tests failed (the misattribution case, exactly as predicted).
- GREEN: restored the fix, all 65 tests in `deterministic-edition.test.ts` pass (63 pre-existing + 2 new).
- `npx tsc --noEmit`: clean.
- Full suite (Node 20): 14027 pass / 0 fail / 3 skipped.

## What was deliberately left unchanged

The `trendConflicts` gate itself (still correctly detects a real trend/direction disagreement) and every other thesis section (catalyst, smart-money driver note, flow-streak) — none share this specific hard-coded-attribution pattern.
