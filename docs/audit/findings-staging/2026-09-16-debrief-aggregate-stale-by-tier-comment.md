## 2026-09-16 — [FINDING, FIXED] `debrief-aggregate.ts`'s `by_tier` field comment was stale — claimed "no NH tier engine yet" after PR-N7 shipped one

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P4 — documentation-only; zero behavioral impact, but actively misleading to anyone (human or agent) deciding whether tier-calibration work on Legacy is possible |
| **Lane** | Night Hawk Legacy |
| **PR** | fix/debrief-aggregate-stale-tier-comment |

### Root cause

`NighthawkDebriefReport.by_tier`'s doc comment read: `/** Empty until a tier is ever pinned in
publish_context (no NH tier engine yet). */`. PR-N7 (`nighthawk-tiers.ts`'s `assignNighthawkTier`)
has been wired into `publish-context.ts` since this repo's earliest commit in this checkout
(`git log -S`, both the tier engine file and this exact comment string trace to the same
2026-07-17 import commit) — `publish-context.ts:266-272` unconditionally pins `tier: { tier,
factors }` onto every published play whenever `scored` is non-null (i.e. every normal publish
path). Confirmed live this session: tonight's edition (2026-09-16) shows the tier engine actively
assigning A/B letters (RVTY score 53→"A", SMTC score 78→"B" — the measured-evidence-driven score
bands, not a naive score-ordinal mapping). So `by_tier` (fed by `readPinnedTier`/`byTier` reading
that same pinned field) has never actually been the empty array the comment describes for any
edition in this codebase's history — the comment describes a pre-tier-engine state that, as far as
this repo's history shows, never existed here.

### Why this matters enough to fix

This is Legacy's outcome-honesty aggregate layer (`debrief-aggregate.ts`) — the exact module a
future audit pass reads to decide whether per-tier win-rate calibration is worth pursuing. A
reader trusting the stale comment could wrongly conclude "there's no tier data to look at yet" and
skip a genuinely live signal, or waste a cycle re-discovering that the field is in fact populated
(which is exactly what happened this cycle before the comment was traced against
`publish-context.ts`).

### Fix

Replaced the stale comment with one describing the actual pinning mechanism (PR-N7's
`assignNighthawkTier`, wired since 2026-07-17) and the two real reasons `by_tier` can still read
empty for a given query window: an all-pre-pinning row population (not reproducible in this
repo's visible history, but the honest general case), or the `current`-methodology anti-blend
filter (#333) dropping every row that carries a tier. No behavioral change — the field's actual
values are unaffected; only the comment describing them changed.

### Blast radius

Single comment, single file. Grepped repo-wide for the exact stale phrase ("no NH tier engine
yet") and its close variants — no other occurrence.

### Tests

None added — pure comment change, nothing computational to assert. `tsc --noEmit` clean
post-edit.
