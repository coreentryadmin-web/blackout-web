> **kind:** FINDING

# Swing V2 G-S3 earnings binary wired into commit path — FIXED

| **Status** | FIXED |
|------------|-------|
| **Pri** | P1 |
| **Area** | swing / v2/gates + commit |

## Symptom

`evaluateSwingGates` (PR-5) implemented `event_in_window` but had zero production callers. V2 commit only enforced G-S6/G-S14 — names could COMMIT into an AMC print same-day (`isOvernight: true`).

## Fix

- `evaluateEarningsGate` (G-S3) in `v2/gates.ts`
- `earningsInWindow` pinned on dossier from catalyst reads → commit candidate
- Enforced when `isSwingEarningsGateEnforced()` (default on with V2; opt-out `SWING_ENGINE_V2_ENFORCE_EARNINGS=0`)
- Member-facing `g_s3_earnings` gate block in entry-verdict

## Evidence

- `v2/gates.test.ts`, `commit.test.ts`
- Deep-dive Q10 triage: `SWING-V2-DEEPDIVE-TRIAGE-RESPONSES-2026-09-05.md`

## Also in this PR

- Q2: `deriveSwingCandidates` per-candidate try/catch (poison seed isolation)
- Full 30-question triage doc
