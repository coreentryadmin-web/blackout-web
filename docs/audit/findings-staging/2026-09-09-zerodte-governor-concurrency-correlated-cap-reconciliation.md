> **kind:** FINDING

## G-5 governor: MAX_CONCURRENT_PLANS=100 vs MAX_CORRELATED_SAME_DIR=2 — reconciled (not a bug, was a stale comment) — FIXED

| | |
|---|---|
| **Status** | FIXED (documentation-only, no behavior change) |
| **Area** | 0DTE Command session governor (`src/lib/zerodte/governor.ts`) |
| **Severity** | P3 (documentation/architecture clarity — read as an inconsistency by a 2026-09-09 architecture review, was not an actual bug) |

### Root cause

`GOVERNOR_MAX_CORRELATED_SAME_DIR = 2`'s own doc comment justified the number by reference
to *"the 3-concurrent cap"* — i.e., it assumed a total open-book size of ~3 plans, reasoning
"a cluster of 3 same-direction plays is the whole book pointed one way." But
`GOVERNOR_MAX_CONCURRENT_PLANS` was raised from that old 3-concurrent world to **100** on
2026-07-29 (explicit product intent, documented in that constant's own comment: "do NOT
starve the desk with an artificial scarcity cap... default 100 is effectively no desk
scarcity"). Nobody updated `GOVERNOR_MAX_CORRELATED_SAME_DIR`'s comment when concurrency was
raised, so it sat for six weeks describing a total-book size that no longer existed —
exactly the shape that reads as "these two numbers encode incompatible risk philosophies"
to anyone auditing the file cold, which is precisely what happened in a 2026-09-09
architecture review.

### Resolution

The two constants were never actually in conflict — they bound different things by design.
`GOVERNOR_MAX_CONCURRENT_PLANS=100` is a runaway-commit backstop only, deliberately not a
real risk limit (aggregate risk is bounded by correlation, premium-at-risk, and gamma budget
instead — a book of 90 small, uncorrelated, budget-capped plans across different
tickers/directions is diversification, not "90x the risk" of one plan). No incident in this
repo's history has ever tied raw plan *count*, independent of correlation/premium/gamma, to
a loss — inventing a tight count-based cap now would have re-narrowed the board through a
different mechanism than every other loosening change made this session, on no more
evidence than the comment staleness itself.

Both constants' doc comments now explicitly cross-reference each other and state the
reconciliation: `GOVERNOR_MAX_CONCURRENT_PLANS` explains it deliberately does not bound
aggregate risk; `GOVERNOR_MAX_CORRELATED_SAME_DIR` explains it bounds directional
concentration independent of total book size, and corrects the stale "3-concurrent cap"
reference.

### Evidence

- `governor.ts`, `GOVERNOR_MAX_CONCURRENT_PLANS`'s comment: "Product intent (2026-07-29)...
  default 100 is effectively 'no desk scarcity'."
- `governor.ts`, `GOVERNOR_MAX_CORRELATED_SAME_DIR`'s prior comment (now corrected): "with
  the 3-concurrent cap, a cluster of 3 same-direction correlated plays is the whole book" —
  a total-book-size assumption six weeks stale relative to the constant it was justifying
  against.

### Fix

Comment-only change to `src/lib/zerodte/governor.ts`. No constant value changed, no gate
logic changed. Full `governor.test.ts` suite (55/55) re-run to confirm zero behavior change;
`tsc --noEmit` clean.

### Blast radius

None beyond the two doc comments — this is documentation clarity, not a code change.
