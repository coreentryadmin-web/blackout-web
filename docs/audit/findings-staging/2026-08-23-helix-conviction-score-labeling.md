# HELIX conviction score misrepresentation — labeled for direction, doesn't rank it

> **kind:** FINDING

## Summary
The "Top Prints" panel labels its sort mode "★ conviction", implying it identifies the most directionally confident prints. However, the conviction score (named a "score" in the code, "conviction" in the UI) measures premium size + route features, not directional confidence. An independent audit probe measuring whether the score ranks underlying direction found **SPREAD WITHOUT ORDER** — the score spreads by 6.2pp across win-rate buckets but has no monotonic trend (Spearman ρ=0.46, weak and positive-ish).

This creates a **product honesty problem**: members read "★ conviction" as "most likely to move in the predicted direction" when the score measures "largest premium + sweep/0DTE bonus".

## Score Formula (src/providers/unusual-whales.ts)
```typescript
const premPts = premium > 0 ? Math.min(60, round(premium / $1M × 60)) : 0;
const sweepPts = hasSweep ? 25 : 0;
const dtePts = route === "0dte" ? 15 : 0;
score = min(100, premPts + sweepPts + dtePts)
```
Interpretation: size (capped at $1M = 60 pts) + sweep (+25) + 0DTE (+15).
**No directional analysis anywhere in the formula.**

## Audit Evidence: Score Does Not Rank Direction
**helix-score-signal.mjs** measured on 748 graded prints:

| Score Bucket | n | Win Rate | Avg Favorable% | Verdict |
|---|---|---|---|---|
| 0-39 | 282 | 50.0% | +0.55% | no signal |
| 40-59 | 162 | 47.5% | **-4.78%** | **below average** |
| 60 (saturated) | 54 | 53.7% | -0.11% | flat |
| 61-84 | 32 | 50.0% | +0.30% | no signal |
| 85-100 | 6 | 83.3% | +2.94% | too small (n<30) |

Spread: 6.2pp (83% top vs 47% bottom). **Order: INVERTED** (40-59 bucket WORST, but middle of range). 
Spearman ρ=0.46 — weak, fails monotonicity test. Verdict: **SPREAD WITHOUT ORDER.**

**Conclusion:** The score does not rank direction. It ranks size. A print with score 50 is no more likely to continue in the predicted direction than a print with score 40 — and actually *less* likely in this dataset.

## Why This Matters
- **Member decision-making**: A trader seeing "★ conviction" reads it as "highest directional confidence" and may overweight these prints in position sizing.
- **Anchor bias**: The top print in the panel gets full gold styling + glow (line 26: "the single most conviction-worthy print"). If conviction doesn't rank direction, the styling authority is misplaced.
- **Comparison to "Size" mode**: The fallback sort is labeled "◆ size", which is honest about measuring premium. If score measured direction, the label distinction would be valid. As written, both measure size (one adds features), but only one tells the truth.

## Blast Radius
- **UI label**: `HighScorePrints.tsx` line 61 — `kicker={mode === "score" ? "★ conviction" : "◆ size"}`
- **Comment**: line 26 calls it "conviction-worthy" without defining conviction
- **No backend logic to change** — the score formula is intentionally size-based
- **No data flow corruption** — score is calculated correctly; only the label is dishonest

## Options for Fix

### Option A: Relabel to Honest Description (recommended)
Change `"★ conviction"` to something that describes what it actually measures:
- `"★ largest impact"` (size focus)
- `"★ featured trades"` (size + sweep/0DTE)
- `"★ premium concentration"` (size)

Rationale: The score formula is fine; only the label needs honesty. Size-ranked prints ARE valuable to watch (high-volume trades matter), but not for directional confidence.

### Option B: Pivot Score to Directional Ranking
Redefine the score to actually measure directional confidence:
- Add a `directionalConfidence` component based on ask_pct extremes or aggression measures
- Re-weight premium vs direction in the formula
- Re-run audit to verify new score actually ranks direction

Cost: larger change, would affect leaderboards and Discord digest. Coordinate with Thermal/Vector if they also use score.

### Option C: Remove Score Sort Entirely
Hide the score-ranked mode and only show size-ranked top prints. Keep score in the tape but remove it as a sort mode.

Cost: removes a potentially useful ranking; members currently using it would lose it.

## Recommended Fix
**Option A**: Change label to `"★ featured trades"` or `"★ premium concentration"` and update the comment to explain that conviction refers to the score's size-emphasis rather than directional confidence.

Rationale:
- Quick (1 line + comment)
- Honest about what the score measures
- Preserves the existing sort mode (which is useful for finding big/interesting prints)
- Aligns language with the fallback "◆ size" label
- Matches the actual use case (traders watch top-premium prints)

## Status
PENDING COORDINATOR DECISION on whether to:
1. Relabel (quick, minimal blast radius)
2. Redesign score (larger change, requires re-audit)
3. Deprecate score sort (removes functionality)

Do not merge without resolving the label vs formula mismatch. A label-only fix is a one-line commit.
