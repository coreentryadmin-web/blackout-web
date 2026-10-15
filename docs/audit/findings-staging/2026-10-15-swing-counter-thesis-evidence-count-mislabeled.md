> **kind:** FINDING

## Swing play-brief `counterThesisLine` understated its own evidence-weight label — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — member-visible, incorrect conviction signal in the Ask Largo swing play-brief |
| **File** | `src/lib/swing/play-brief-narrative.ts` (`counterThesisLine`) |
| **Found by** | Workflow-based "dead-wired data" hunt, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-15 |

### Root cause

`counterThesisLine` gathers up to ~10 independently-gated counter-thesis votes into `reasons: string[]`
(HELIX flow, Night Hawk, 0DTE, Vector bias, a wall, EMA stack, MACD, structure break, dealer posture,
fading pillar — each pushed by its own independent conditional, nothing capping the array before the
weight label is computed). It then slices to `shown = reasons.slice(0, 3)` purely for join-string
display length, and used to compute the "corroborated across N independent reads" label from
`shown.length` — which is pinned at a maximum of 3 — while the function's own adjacent comment
explicitly asserted "The count itself is never fabricated — it's `reasons.length`". Whenever 4 or
more of the ~10 votes genuinely corroborated for one ticker/direction (a realistic, not theoretical,
shape — live production examples already exist in this file's own history, e.g. the GDDY 2026-10-09
EMA/MACD/structure case the file documents elsewhere), a member saw "corroborated across 3 independent
reads" when the real count was 4, 5, or more — understating conviction exactly when the counter-thesis
evidence was strongest, and directly contradicting this function's own stated Largo-contract precision
discipline (state real evidence weight, never invent it, never flatten it away).

### Evidence

New regression test (`play-brief-narrative.test.ts`) stacks 4 independent reasons (HELIX put-led flow,
Night Hawk bearish, 0DTE short bias, bear EMA stack) for one LONG play. Pre-fix (RED, verified via
`git stash` isolation): rendered `"corroborated across 3 independent reads"`. Post-fix (GREEN): renders
`"corroborated across 4 independent reads"`, while the displayed clause list is unchanged (still only
the first 3 reasons joined, for prose length) — only the count label changed.

### Fix

One-line change: compute `weight` from `reasons.length` (the full, pre-slice array) instead of
`shown.length` (the post-slice, display-capped array). `shown.join(" · ")` — the actual rendered
clause list — is untouched; only the count label now matches what the comment already claimed it did.

### Blast radius

Single call site (`counterThesisLine` is only called from `tradeManagerNarrativeSection` in the same
file). No other function in `play-brief-narrative.ts`/`play-brief-narrative-coaching.ts` uses this
slice-then-count pattern (confirmed via the same workflow's adversarial verification pass).
