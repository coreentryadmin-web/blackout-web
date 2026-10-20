## `src/lib/confidence/composite-confidence.ts` — fully-built composite-confidence aggregator, zero importers 3 months after shipping

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | REPORTED, NOT FIXED — flagged for the confidence/scoring design thread to decide wire-up vs retire; not unilaterally touched (same precedent as WS-22/x-intel/meridian-play-suggestions below) |
| **Severity** | P4 (dead-weight infra, not a runtime defect — no user-facing impact) |
| **Surface** | `src/lib/confidence/composite-confidence.ts` |

### What it is

Shipped PR #1011 (2026-07-23, commit `f396ca964`), "composite confidence scalar — regime ×
data-quality × calibration (review #6+#7+#9 unified)". A complete, well-documented, pure/
deterministic module exporting `compositeConfidence()` and `dataQualityScore()` plus their types
(`CompositeConfidenceInput`, `CompositeConfidence`, `FeedHealth`, `ConfidenceTier`). It geometric-
means three sub-confidence signals (regime decisiveness, data quality, calibration freshness) into
one EV/size multiplier, with an honest completeness discount when a sub-signal is missing (no
silent "assume everything is fine" default) and a 7-test own test file (`composite-confidence.test.ts`).

### Evidence it's an orphan

Repo-wide grep for every export the module provides, outside the module itself and its own test:

```
$ grep -rn "compositeConfidence\|dataQualityScore\|composite-confidence" --include="*.ts" --include="*.tsx" src scripts
src/lib/confidence/composite-confidence.ts        (the module itself)
src/lib/confidence/composite-confidence.test.ts   (its own test)
src/features/spx/lib/playbook-primary-score.ts    (unrelated — see below)
```

The one other hit is a **same-named, unrelated local function**: `playbook-primary-score.ts`
(owned SPX lane) defines its own private `function dataQualityScore(playbook_id, ctx)` with a
different signature — it does not import from `composite-confidence.ts`. So the module has
**zero real callers anywhere in the codebase**, three months after shipping.

### Why reported, not fixed

This is the same shape this file has repeatedly flagged and declined to unilaterally delete:
`src/lib/flow-amendment.ts` (WS-22, FINDINGS 2026-09-12, still REPORTED/NOT FIXED), the x-intel
trio (`capture-harness.ts`/`package-scorer.ts`/`visual-memory-persist.ts`, consistently deferred
to the X-intel lane as "deliberate designed-ahead scaffolding"), and `meridian-play-suggestions.ts`
("omitted: detailed calibration pending Coordinator approval" per its own header). A module this
deliberately reviewed ("review #6+#7+#9 unified") reads as forward-looking infrastructure built
ahead of its consumer, not accidental leftover — deleting it on a DISCOVERY-lane pass without the
scoring-design owner's sign-off risks destroying real design intent for a one-cycle tidiness win.

### Suggested next step

Whoever owns the confidence/scoring design thread (likely Vector/Helix/0DTE scoring, the natural
EV/size-multiplier consumers) should decide: wire `compositeConfidence()` into an actual scoring
path, or retire the module + its test if the design was superseded. Either resolution is a small,
scoped PR once decided — this entry exists so the decision isn't lost, not to force it.
