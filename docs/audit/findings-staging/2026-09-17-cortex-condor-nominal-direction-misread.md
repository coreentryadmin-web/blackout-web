> **kind:** `FINDING`

## Cortex veto layer read a CONDOR's nominal fade direction as real directional evidence — FIXED

| | |
|---|---|
| **Area** | 0DTE — Night Hawk Cortex layer / Iron Condor |
| **Severity** | P2 (structural correctness defect; not yet proven to change live commit counts, since condors barely survive the hard-gate funnel to reach Cortex at all — see below) |
| **Status** | FIXED |
| **Files** | `src/lib/zerodte/cortex-gate.ts`, `src/lib/zerodte/scan.ts`, `src/lib/zerodte/cortex-gate.test.ts` |

### Root cause

`condor.ts` stamps a CONDOR setup's `direction` field explicitly as **nominal-only**:

```ts
direction: regime.fadeDirection, // nominal provenance only — the condor is delta-neutral
```

but `scan.ts`'s commit loop called `evaluateCortexForCommit(s.ticker, s.direction, ...)`
**unconditionally for every gate-surviving setup**, condors included. Cortex's entire evidence
model (vetoes, supports, opposes across gex-walls / wall-trend / darkpool-confluence /
catalyst-news / etc.) reasons about whether dealer/whale positioning supports or fights a
LONG/SHORT directional bet. Feeding it a condor's nominal fade direction lets it VETO /
NET_NEGATIVE / OPPOSE_UNRESOLVED-block (or, just as wrongly, PASS) a delta-neutral credit
structure on evidence that argues about a direction the condor was never actually betting on.

This is the same root cause already found and fixed at **four other surfaces** during this same
audit pass (2026-09-17 session, PRs #5106-#5109): the Largo cross-product read
(`product-adapters.ts` / `consensus-read-extract.ts`), the session governor's correlated-
conflict/concentration checks (`governor.ts`'s `is_condor` field), live Thesis Health
(`thesis-health.ts`, now returns `null` for a condor), and live confluence scoring
(`confluence.ts`, now returns `null` for a condor). Cortex — arguably the most consequential of
the five, since it is a hard BLOCK on the actual commit decision, not just a display/read
surface — was missed in that sweep.

### Why it wasn't caught earlier

The four prior fixes were each found and fixed independently, in different files, by tracing the
"is this consumer condor-aware?" question through each of Largo's read layer, the governor, and
the two live scoring surfaces. `cortex-gate.ts`/`scan.ts` were not part of that sweep because the
Cortex call site sits inside `scan.ts`'s large commit loop rather than a small standalone module,
and `cortex-gate.ts` itself has zero `condor`/`is_condor` references — nothing signaled "this
file needs condor awareness" without reading the call site's actual arguments.

### Evidence

- `condor.ts:557` — the explicit nominal-direction comment quoted above.
- `scan.ts` (pre-fix) — `s.cortex = await evaluateCortexForCommit(s.ticker, s.direction, ...)`
  ran with no `play_type` branch, confirmed by reading the commit loop directly (grep for
  `evaluateCortexForCommit` in `scan.ts` showed exactly one call site, unconditional).
- `cortex-vector-relief.ts`'s `applyCortexCommitRelief` already no-ops on `assessment.abstained`
  (`if (assessment.abstained || assessment.decision === "PASS") return assessment;`), and
  `cortex-veto-dwell.ts`'s dwell latch already treats a non-VETO fresh decision (which ABSTAIN
  always is) as clearing/no-op — so bypassing with ABSTAIN composes cleanly with both downstream
  consumers without any further changes needed there.

### Fix

Added `cortexAbstainForCondor()` to `cortex-gate.ts` — an honest `ABSTAIN` (never a fabricated
`PASS`, which would falsely claim clean evidence that was never evaluated) with a reason string
naming the nominal-direction mismatch. `scan.ts`'s commit loop now branches on
`s.play_type === "CONDOR"` before calling `evaluateCortexForCommit`, using the bypass instead.
A condor's commit decision now rests entirely on its own liquidity/range gates (`gates.ts`'s
condor-specific G-8/G-9/G-10 replacement, already condor-aware) and never on directional Cortex
evidence that structurally does not apply to it.

### Blast radius

Single call site (`scan.ts`'s commit loop) — no other file calls `evaluateCortexForCommit` with
a condor setup's direction. `s.cortex` still flows through `applyCortexVetoDwell` and
`applyCortexCommitRelief` unchanged; both already handle ABSTAIN as a pass-through, verified by
reading their source (see Evidence) rather than assumed.

### Why this fix and not an alternative

Considered making Cortex condor-aware (e.g. a condor-specific evidence composition using
`regime.offset` / wall proximity instead of a directional support/oppose model) — rejected as
out of scope for this fix: it would require designing a genuinely new evidence model for a
delta-neutral structure, not just correcting a misread. ABSTAIN is the minimal, honest fix that
matches the pattern already established at the other four surfaces (skip/null rather than
fabricate), and leaves the door open for a real condor-specific Cortex read as separate,
deliberately-scoped future work.

### Live impact — deliberately NOT overstated

This audit pass's separate investigation (`docs/audit/INTENTIONAL-DESIGN.md` items #9/#10, PR
#5112) found 0/411 committed 0DTE plays in 90 days are condors, traced to the hard-gate funnel
(the condor liquidity/range gates + G-13 flow-accumulation-conflict) rejecting nearly all condor
candidates before they ever reach the Cortex layer this fix touches. So this fix is a genuine
correctness defect (a condor that DOES survive the hard gates was being judged on evidence that
doesn't apply to it), but is **not** claimed to be a primary driver of the 0-condor-commit count —
that funnel-level bottleneck remains the leading, still-open hypothesis for that separate finding.

### Regression test

`src/lib/zerodte/cortex-gate.test.ts` — three new tests: the ABSTAIN is honest (not a fabricated
PASS, reason names the nominal-direction mismatch), it never produces a gate block (same as any
other ABSTAIN), and `cortexEntryContextFor` round-trips it the same way any other ABSTAIN
persists. RED→GREEN proven via `git stash` on `cortex-gate.ts`/`scan.ts` only (3 fail pre-fix,
0 fail post-fix, full 36/36 file pass).
