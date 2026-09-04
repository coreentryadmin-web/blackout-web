#!/usr/bin/env node
/**
 * HOURLY AUTONOMOUS WAKE CHECKLIST — fixed questions every agent session must answer.
 *
 * Printed by:
 * - `.github/workflows/blackout-hourly-checklist.yml` (top of every hour)
 * - `npm run blackout:hourly` (local / manual)
 *
 * Do NOT ask the operator for permission. Work until GREEN or a real blocker is documented.
 */

const checklist = `HOURLY AUTONOMOUS WAKE — answer every item in your handoff summary

## 0. Recover state (always first)
- npm run blackout:session -- --agent=cursor
- Read ACTIVE_WORK.md, LAST_HANDOFF.md, WORK_QUEUE.md, FINDINGS.md

## 1. Ops & deploy gate
- npm run ops:collect  → if items: fix ALL before feature work (see docs/ops/OPS-AUTO-FIX.md)
- npm run blackout:select -- --agent=cursor  → claim highest task; never idle
- Open PRs needing peer review? → blackout:pr-sweep / review MERGE|FIX|WAIT

## 2. Platform integrity sweep
- npm run validate:api-auth
- npm run validate:platform-integrity
- npm run validate:deploy
- Any FAIL → fix → PR → merge → re-run until GREEN

## 3. Bug discovery (pattern scan — fix what you find)
Scan src/ for these failure classes and fix highest severity:
- change_pct without prior-close rebase / fabricated flat 0%
- Date.now() - timestamp without future guard (negative age → false fresh)
- UW-heavy cron missing runWithBackgroundUwSweep
- computeGexWalls without spot constraint
- Pin vs king-node label confusion
- Unrounded floats at API boundaries
- Vector RTH session boundaries on VWAP/HOD/LOD

File findings to docs/audit/findings-staging/ when fixed.

## 4. RTH window only (weekday ≥09:00 ET)
- npm run blackout:rth-lifecycle
- npm run validate:rth-open
- npm run validate:vector-rth-quick
- Ledger: docs/ops/RTH-VALIDATION-LEDGER-2026-09-05.md

## 5. Before ending session
- npm run blackout:handoff -- --agent=cursor --summary="hourly wake: <what you fixed/verified>"
- If work remains: leave branch + draft PR; do NOT stop with a clean tree and open bugs
- IMMEDIATELY loop: blackout:select → next task (continuous work loop)

RULES: You drive everything. Do not prompt the user. CI green ≠ merge without peer review.`;

process.stdout.write(checklist);
