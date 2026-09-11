> **kind:** FINDING

# Thesis text's R:R display could round across the label's own threshold, printing a self-contradictory number

| Field | Detail |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (narrative clarity, not a data-correctness defect) |
| **Component** | `src/features/nighthawk/lib/deterministic-edition.ts` (`buildDeterministicThesis`) |
| **Found via** | Live spot-check of the 2026-09-11 evening edition's fresh HPE/DELL picks during a quiet improvement-hunting cycle |

## What was broken

`buildDeterministicThesis`'s R:R clause:

```js
const rrLabel = rr >= 2 ? "strong" : rr >= 1 ? "favorable" : rr >= 0.5 ? "acceptable" : "tight";
parts.push(`R:R ${rr.toFixed(1)}:1 (${rrLabel}).`);
```

`rrLabel` buckets on the true, unrounded `rr`. But `rr.toFixed(1)` rounds **to nearest**, so a value just under a threshold can display as if it cleared it: `rr = 0.49` (< 0.5, labeled "tight") prints as `R:R 0.5:1 (tight)`. A member reading that sentence sees "0.5" sitting right on the ladder's own "acceptable" cutoff, printed with the "tight" label — an apparent self-contradiction that undermines confidence in the number, even though the underlying math is correct.

Live reproduction: **both** of the fresh 2026-09-11 evening picks hit this — HPE (`rr = 0.49` → "R:R 0.5:1 (tight)") and DELL (`rr = 0.45` → "R:R 0.5:1 (tight)"). Not a rare edge case; it fires any time the true ratio falls in the last tenth below a threshold (0.45–0.499 for the 0.5 cutoff, and the same band below 1 and below 2).

## What changed

The displayed number now rounds **down** instead of to-nearest: `Math.floor(rr * 10 + 1e-9) / 10`. Flooring means the printed number can never read higher than the true ratio, so it can never cross into a higher label's territory than the label actually reflects — `0.49` now prints `R:R 0.4:1 (tight)`, consistent with its own label. A ratio safely inside a band (e.g. `1.5`) is unaffected — it already displays its true value either way. The `1e-9` epsilon guards a `rr` that is an exact multiple of 0.1 (e.g. `0.50`) from landing on the wrong side of `Math.floor` due to binary floating-point representation.

## Evidence

- Two new regression tests in `deterministic-edition.test.ts`: one reproducing the exact live HPE/DELL shape (`rr=0.49`) — RED before the fix (asserted `displayed < 0.5`, got `"0.5"`), GREEN after (`"0.4"`); one confirming a ratio safely inside a band (`rr=1.5`) still prints its true rounded value unchanged. Full file: 45/45 pass.
- `tsc --noEmit` clean.
- Full suite run alongside this change (see PR for pass count).

## Blast radius

Single template-string line inside one function. `buildDeterministicThesis` is Legacy's own edition-synthesis thesis builder (`claude-edition.ts` → `deterministic-edition.ts`) — confirmed via grep that no other desk (Vector, 0DTE, Swings) imports this function; `vector-play-candidates.ts`'s only import from this file is the unrelated `pickChainContract`. No other field or code path reads the R:R display string.

## Fix rationale

Chose to floor the *display* only (not change `computeRiskReward`'s own `.toFixed(2)` rounding, and not change the label thresholds) because the label ladder is the source of truth for play quality — the fix's job is only to make the printed number never overstate what that label says, never to change which plays get called "tight" vs "acceptable". Flooring (rather than, say, deriving the label from the rounded display value) keeps the label's precision intact and only ever makes the displayed number more conservative, never more flattering — consistent with this codebase's standing "never overstate quality shown to members" discipline.
