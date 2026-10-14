## 2026-10-14 — [Night Hawk Legacy] `score-signal-analysis`'s `over_gate` bucket blends two structurally different publish paths into one rate — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Night Hawk Legacy — `src/features/nighthawk/lib/score-signal-analysis.ts`, Phase 2 `by_target_atr_gate.over_gate` | P3 — diagnostic-tool correctness, risk of a wrong conclusion about a live gate-rescue change, not a member-facing defect | FIXED |

### What was wrong

`analyzePhase2EarlyRead`'s `by_target_atr_gate.over_gate` bucket reports one blended
early-favorable rate for every row whose pinned `target_atr_multiple` exceeds
`GATE_TARGET_MAX_ATR_MULTIPLE` (2.0) — but a row can only reach `over_gate` at all by having been
published *despite* failing G-N2, and there are at least two structurally different ways that can
happen: (a) the gate-promote rescue path (`gate_promoted: true`, capped at
`GATE_PROMOTE_TARGET_MAX_ATR_MULTIPLE`, fixed to 2.5 by PR #5961 this session), or (b) some other
bypass route (e.g. the already-journaled `backfillBypassesPublishGates_2026_09_17T1815Z` finding —
`backfillThinEditionPlays`' two un-gated call sites). `extractEvidence` already parses
`gate_promoted` per row (it's required for `ScoreSignalEvidence`) but the Phase 2 bucket engine
never split on it.

This surfaced live 2026-10-14 (journaled as `legacyPhase2VolumeCheckAndAtrGateObservation_2026_10_14`
in `docs/audit/nighthawk-legacy-live-journal.json`): a 90-day pull showed `over_gate` at 58.1%
early-favorable (n=31) vs `under_gate` at 37.7% (n=114) — a counterintuitive result worth
investigating, since G-N2's entire purpose is to flag these as *less* likely to resolve favorably.
Reading that number naively as "the PR #5961 rescue cap change is working" would be exactly the
premature conclusion this codebase's own discipline (see every sibling `*-ab.mjs`/`*-eval.mjs`
script's verdict logic) warns against — the 31 over-gate rows could be mostly rescued, mostly
backfilled, or a genuine mix, and the route gave no way to tell them apart.

### Fix

`Phase2Report` gains one additive field, `over_gate_by_promotion: { promoted, not_promoted }` —
splits the existing `over_gate` population (never changes its own computation) by
`r.gate_promoted`, each a standard `BucketSummary` (n + rate_pct). Pure, read-only, zero effect on
live scoring/ranking/publish gates — this module has no I/O and is a diagnostic-only report
consumed by `GET /api/admin/nighthawk/score-signal-analysis` (admin-gated).

### Evidence (RED → GREEN)

Two new tests in `src/features/nighthawk/lib/score-signal-analysis.test.ts`:
- `over_gate_by_promotion splits the over_gate population by gate_promoted...` — 4-row fixture (2
  promoted, 1 win + 1 loss → 50%; 1 not-promoted win → 100%) proves the split produces two distinct
  rates, neither equal to the blended 66.7% over_gate rate that fixture would otherwise report.
  Verified RED against the pre-fix source (`git stash` on just the source file, test kept): 2
  subtests failed (`over_gate_by_promotion` undefined). GREEN after restoring the fix.
- `over_gate_by_promotion is zeroed, never throws, when there are no over-gate rows` — empty-input
  guard.

`npx tsc --noEmit` clean. Full `npm test` run alongside this PR (see PR description for the exact
count).

### Blast radius

None — the only consumer of `analyzePhase2EarlyRead`'s return shape is the admin route, which
forwards the whole `phase2` object unchanged (`roundFloats({ phase1, phase2 })`); no other call
site reads `Phase2Report` by field name that would need updating.

### What was deliberately left unchanged

Did not attempt to answer the underlying question itself (is the 58.1% over_gate rate actually
coming from the rescue path, and does that validate or undercut PR #5961's cap change) — this PR
only ships the instrument. The production endpoint has to redeploy before a live pull can show the
real split (confirmed: a live 2026-10-14 pull of `/api/admin/nighthawk/score-signal-analysis` still
returned `over_gate_by_promotion: undefined`, as expected pre-deploy). Journaled as the concrete
next step once this merges and deploys.
