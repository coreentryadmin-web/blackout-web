## 2026-09-04 — [PERF, P3 Meridian] Skip already-printed timeline rows in the chain-IV batch budget — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Found by** | Cursor autopilot follow-up on #3536 blast-radius note |
| **Root cause** | `loadMeridianEarningsTimeline` passed every optionable row into `batchLoadEarningsExpectedMovePct` even when `is_printed` was true. `overlayTimelineExpectedMoves` already withheld the overlay for printed rows, so the Polygon chain pull was pure waste of the capped EM budget. |
| **Fix** | `timelineRowsForExpectedMoveBatch()` filters `!is_printed` before the batch call; overlay behavior unchanged. |
| **Tests** | `timelineRowsForExpectedMoveBatch excludes already-printed rows from the chain-IV batch` in `meridian-benzinga-earnings-core.test.ts`. |
