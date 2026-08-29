## The 0DTE gate-calibration tool discards WHY every rejection is ungradeable — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in `feat/scenario-corpus-harness` |
| **Severity** | P2 — desk-operations calibration surface (admin-only `/api/market/zerodte/calibration`), not member-facing |
| **Surface** | `src/lib/zerodte/calibration.ts` `blockedValueLines` |

### Root cause

`skip-grading.ts`'s counterfactual grader (`gradeSkippedPlay`) already writes a specific `reason`
string onto every `ungradeable` verdict ("no long/short direction on the rejection row", "block
time unreadable", "no underlying bar at/after the block time inside the plan window", etc.) — the
whole point of the module's own comment: *"Nothing reconstructable → verdict 'ungradeable' WITH
the reason, persisted, so the same row is never re-ground every run and the gap is visible, not
silent."*

But `calibration.ts`'s `blockedValueLines` — the function that turns graded rejections into the
report's `blocked_value` lines, the ONLY consumer of `GradedSkipInput.counterfactual` for this
purpose — only ever read `.verdict` and `.basis` off each counterfactual. `.reason` was fetched
from the DB (it lives inside the same JSONB blob), held in memory, and then dropped on the floor:
never aggregated, never surfaced, never returned. An operator reading the report saw `n: 0,
ungradeable: 72` for `score_floor` and had zero way to tell "no bar data at all" from "block time
unreadable" from any other cause — the exact silent-absence-as-fact trap this repo's own CLAUDE.md
names repeatedly elsewhere (empty GSC domain-property query, absent AWS creds misread as a product
fault) was live inside its own calibration instrument.

### Evidence

A live run against production (`scripts/audit/gate-calibration-live-report.mjs`, new this pass)
found **every one of 11 gate codes at n=0 graded / 100% ungradeable** over a 30-day, 236-row
window (`score_floor` 72/72, `opening_window` 61/61, `plan_illiquid` 28/28, `vix_unavailable`
12/12, `cortex_veto:gex-walls` 6/6, etc.) — the counterfactual skip-grading machinery has
apparently never successfully graded a single rejection in production, and until this fix there
was no way to read why from the report itself. (Root-causing WHY every row is ungradeable is a
separate follow-up once this fix is deployed and the reasons are actually visible in the report —
this finding is about the visibility gap, not yet the underlying grading failure itself.)

New tests in `calibration.test.ts` (`blocked-value lines: ungradeable reasons are aggregated...`)
pin: most-frequent-reason-first ordering, a cap of 5 distinct reasons per gate (so one gate's long
tail of one-off parse quirks can't crowd out another gate's dominant cause), a `null` reason
labeled `"(no reason recorded)"` rather than silently vanishing, and alphabetical tiebreak on equal
counts for determinism.

### Blast radius

`blockedValueLines` is the sole writer of `CalibrationReport.blocked_value`
(`buildZeroDteCalibrationReport` → `analyzeGateCalibration`), consumed only by the admin-gated
`GET /api/market/zerodte/calibration` route — no member-facing surface reads it. No other call
site duplicates this logic.

### Fix rationale

Aggregate `reason` the same way `verdict`/`basis` already are — grouped by gate, most-frequent
first, capped — rather than exposing the raw per-row list (which could run into the hundreds and
bury the signal). Left the underlying "why is grading 0-for-N in production" question open
deliberately: that requires seeing the actual reason text this fix now surfaces, so it is the
correct next step, not something to guess at and patch blind.
