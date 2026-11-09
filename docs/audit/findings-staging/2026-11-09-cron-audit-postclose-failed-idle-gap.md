> **kind:** `FINDING`

## Cron audit query false RED — post-close `failed` between scheduled fires (2026-11-09)

| **Status** | FIXED |
|------------|-------|

**Symptom:** `Cron audit query` run **42649315653** (`1cc122c`) reported `problems: spx-evaluate, nighthawk-outcomes, gex-eod-snapshot, banger-discovery`.

**Root cause (3 of 4):** `evaluateJob` always surfaced `last.status === "failed"` before the off-schedule idle-gap suppression that ops #1983 added for staleness. On Monday ~10:55 AM ET, post-close crons sit in `isInOffScheduleIdleGap` until the evening UTC band, but a **Friday failed handshake** still read as `failed` and failed CI.

**Fix:** Gate `failed` on `!suppressStaleOffSchedule` when inside schedule idle gap; unit tests for Mon-before-fire + existing weekend case.

**Note:** `spx-evaluate` during cash RTH may still alert if the engine path is genuinely stalled — that is independent of this harness gap.
