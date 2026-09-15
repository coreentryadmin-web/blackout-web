> **kind:** FINDING

## 0DTE counterfactual skip-grader ("did this gate block a winner") was never scheduled — silently non-functional since its 2026-09-12 logic fix — FIXED

| | |
|---|---|
| **Status** | FIXED (this commit) |
| **Severity** | P2 (observability/calibration — no live-trading-path impact, but the instrument this repo built specifically to answer "is a gate over-blocking" was producing nothing) |
| **Surface** | `runSkipGrading` (`src/lib/zerodte/skip-grading.ts`), reached via `GET /api/market/zerodte/calibration`'s `blocked_value` field |

### Root cause

`runSkipGrading` (the counterfactual "would a blocked 0DTE setup have won" grader) was reachable
by exactly one caller: `POST /api/market/zerodte/calibration?grade_skips=1`, an admin-gated,
manually-triggered route (see that route's own header comment: "This is the only write this route
performs"). **No cron ever called it.** A repo-wide grep for `runSkipGrading` confirms the only
call site outside its own tests is that POST handler.

A real logic bug (session_date/timezone mishandling, fixed 2026-09-12 — see `skip-grading.ts`'s
own long comment on the bug, docs/audit/0DTE-RESEARCH.md's "Gate-overlap ablation" entry) meant
every rejection graded `ungradeable` with a generic "no bar data"/"no underlying bar at/after the
block time" reason before that fix. But fixing the logic without anything ever invoking it again
left the fix inert: found live 2026-09-15 that `GET /api/market/zerodte/calibration?days=30`'s
`blocked_value` array still showed **every gate at n=0/all-ungradeable**, three days after the
fix — the exact pre-fix signature, because nobody had POSTed to the admin route since.

### Evidence

- Live GET (30-day window) before any manual trigger: `score_floor` gate showed
  `{"n":0,"ungradeable":320,"would_have_won":0,"would_have_won_rate_pct":null}` — same shape
  for every other gate in the report.
- Manually invoked `POST /api/market/zerodte/calibration?grade_skips=1` with `{"days":14}`:
  `{"ok":true,"scanned":200,"graded":170,"ungradeable":30,"errors":0}` — 85% of the previously-stuck
  backlog graded cleanly on the first invocation, confirming the 2026-09-12 fix works and the only
  missing piece was a scheduled caller.
- Re-pulled `GET /api/market/zerodte/calibration?days=30` after the manual trigger: `score_floor`
  now reads `n=34, would_have_won=15 (44.1%)`; other gates similarly populated (`max_itm_pct` 91.7%
  n=12, `opening_window` 46.5% n=86, `thesis_rank_reject` 42.3% n=26).

### Fix

Added `src/app/api/cron/zerodte-skip-grade/route.ts` — a cron-authorized (`isCronAuthorized`, same
idiom as the sibling `zerodte-grade` route, not admin-gated) route that calls the real
`runSkipGrading` directly (nothing reimplemented), gated on `isTradingDayEt` (force=1 bypasses,
same holiday-guard shape as `zerodte-grade`). Registered in `cron-registry.ts` as
`zerodte-skip-grade`, scheduled once daily at 17:00 ET (21:00 UTC) post-close. Manually created the
matching EventBridge rule + `hit-cron` Lambda target + invoke permission via boto3 (verified live)
and recorded it in `blackout-infra`'s `cron-jobs.json` (PR #53) — per the standing "manual creation
+ terraform record, never `terraform apply` against a drifted stack" discipline.

### Fix rationale

Did not lower the admin gate on the existing manual POST route (it stays admin-only by design —
policy decisions read that report) — the gap was purely "nothing schedules the grading step," so a
dedicated cron calling the same underlying `runSkipGrading` function is the minimal fix. The
grader itself is already bounded (`MAX_SKIP_GRADE_DAYS`=14, `MAX_ROWS_PER_RUN`=200) and idempotent
(only fills `NULL counterfactual_json` cells), so a daily cadence is safe — no overlap guard
needed, and a missed or re-run day is harmless.

### Blast radius

Single new route + one cron-registry entry + one terraform record. No existing route, gate, or
scoring logic touched. The admin manual-trigger route is untouched and still works as a way to
force an out-of-band regrade (e.g. widening the window past what the daily cron processes).

### Test

`src/app/api/cron/zerodte-skip-grade/route.test.ts` — source-text assertions (matching the sibling
`zerodte-grade/route.test.ts` pattern) confirming: auth gate runs before the trading-day gate,
which runs before `runSkipGrading(...)` is called; `force=1` bypasses the holiday gate; the route
imports and calls the real `runSkipGrading` (not a reimplementation); and the route is NOT
admin-gated (`requireAdminApi` absent), keeping it distinct from the manual trigger route. `tsc
--noEmit` clean, full `npm test` green. The live evidence above (manual trigger graded 170/200
previously-stuck rows) is the actual RED→GREEN proof for the underlying grading pipeline; this
route's own test proves the wiring (auth → gate → call order), since there is no meaningful
"pre-fix" state for a brand-new file to diff against.

### Provenance

Found while answering a live user question about what's blocking today's 0DTE setups and whether
those gates have historically blocked winners — the calibration report's `blocked_value` field is
exactly the tool built to answer that, and it was silently returning nothing.
