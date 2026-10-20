## 2026-10-20 — [FINDING, P2 Night Hawk 0DTE] Board mislabels an unstamped CLOSED row as "time_stop" when it was never a time-stop — FIXED

> **kind:** FINDING

**Context.** Member audit directive on today's live 0DTE book: "Verify quote freshness,
executable exit prices, stop execution, thesis invalidation, time stops, and correlated
exposure. Don't dismiss this as normal chop... Fix and verify the missing SNXX return field
too." Investigating the "missing SNXX return field" (`exit_pnl_pct: null` on a CLOSED row)
surfaced a more specific root cause than a simple write-timing gap: the board's
`closed_reason` field was actively **mislabeling** the row, not just omitting data.

**Root cause.** `mapLedgerRow` (`src/lib/platform/zerodte-service.ts`, `boardClosedReason`)
derives the member-facing close label as: `stopped` (pinned) → else, if the exit-engine
stamped a reason (`entry_context.exit`, written by `stampZeroDteExitContext` on an
exit-engine EXIT) → that category (`ratchet`/`thesis`/`flat`/`target`/`stop`) → **else a
blind fallback literal `"time_stop"`, unconditionally, any time `status === "CLOSED"` and
no engine category exists.**

That fallback conflates two completely different situations:
1. A **genuine** 15:50 ET hard time-stop (`PLAN_RULES.time_stop_et_minutes`, `plan.ts`) —
   which never stamps an exit-engine context at all, so `"time_stop"` is the correct, only
   available label.
2. A row the **exit engine already closed** (ratchet floor / thesis break / flat-timeout /
   plan stop / trim-scale runner target) whose `stampZeroDteExitContext` write simply
   **hasn't landed in Postgres yet**. `status` and `entry_context.exit` are written by two
   separate, unsynchronized UPDATE statements from the ~1s live-marks lane
   (`src/lib/zerodte/live-marks.ts`) / the ~2min cron sync (`src/lib/zerodte/scan.ts`):
   `evaluateLedgerRowExit` (`exit-sync.ts`) stamps the exit context FIRST, then the caller
   flips `status` to `CLOSED` via `updateZeroDteLiveState` SECOND — but either write can
   also originate from `derivePlayStatus`'s own direct close path, which never calls the
   stamp at all for some closes, and a board read landing inside that window sees
   `status=CLOSED` with no stamp yet. Under the old code, case (2) was **indistinguishable**
   from case (1) and silently printed the same specific, meaningful-sounding label.

**Evidence (live, 2026-10-20).** SNXX committed ~10:11 ET (BREAKOUT origin, nowhere near the
15:50 ET boundary). A board read at 15:23 UTC showed:
```
status: CLOSED, closed_reason: "time_stop", exit_pnl_pct: null, exit_reason: null
```
A second read six minutes later (15:29 UTC), once the real stamp had landed, showed:
```
status: CLOSED, closed_reason: "ratchet", exit_pnl_pct: 14.04, exit_reason: "ratchet"
```
The `"time_stop"` label shown in the first read was never true — the real close was a
ratchet-floor exit. `live_pnl_pct` (computed independently from `last_mark`/`entry_premium`,
not from the stamp) correctly showed +14.04% in BOTH reads, so the raw P&L number was never
wrong — only `closed_reason` (and, transiently, `exit_pnl_pct`) misrepresented *why* and
*exactly how much* the trade closed by.

**Fix.** Gate the `"time_stop"` fallback on the row's own **frozen** `last_mark_at`
(CASE-guarded to the close instant once `status='CLOSED'` — see `updateZeroDteLiveState` in
`db.ts`) genuinely falling at/after `PLAN_RULES.time_stop_et_minutes` (with 2 minutes of
slack for the sync lanes' own tick latency, via the existing `etMinutes()` ET-wall-clock
helper, `src/features/spx/lib/spx-play-session-time.ts`). When it does not — i.e., no
evidence this was a real end-of-day close — report `closed_reason: null` ("exit reason not
yet persisted") instead of a specific reason the row cannot yet support. This makes
`closed_reason` consistent with `exit_pnl_pct`/`exit_reason` (which already read `null`
honestly in this window) rather than contradicting them with a wrong label.

**Blast radius.** Single call site (`mapLedgerRow`), consumed by every reader of the board
payload: `/api/market/zerodte/board`, Largo's `get_zerodte_plays` tool, and the BIE
composers — all three funnel through `buildZeroDteBoardPayload()`/`mapLedgerRow`, so the fix
applies uniformly; no second implementation of this derivation exists elsewhere.

**Evidence of fix.** `src/lib/platform/zerodte-service.test.ts`: the pre-existing test
("a plain 15:30 close... reads closed_reason 'time_stop'") asserted the OLD, wrong fallback
as correct — it never actually set `last_mark_at`, so it was testing the bug, not a genuine
time-stop. Replaced with two tests: (1) a CLOSED row with no engine stamp and `last_mark_at`
at 10:30 ET now correctly reads `closed_reason: null` (RED on the pre-fix code, confirmed via
`git stash` on just the source file: `not ok`); (2) a CLOSED row with no engine stamp and
`last_mark_at` genuinely at 15:50 ET still correctly reads `closed_reason: "time_stop"`
(passes on both old and new code — the genuine case was never broken). Full suite:
`npx tsx --experimental-test-module-mocks --test src/lib/platform/zerodte-service.test.ts` —
25/25 pass. `tsc --noEmit` clean.

**What was deliberately left unchanged.** The underlying two-write race itself (status flip
and exit-context stamp as separate, unsynchronized DB writes) is not fixed here — that would
require either wrapping both writes in a single transaction or merging them into one UPDATE,
a larger change across `live-marks.ts`/`scan.ts`/`exit-sync.ts`/`db.ts` than this finding's
scope. This fix stops the board from actively MISLABELING the row during that window;
`exit_pnl_pct` continuing to read `null` for a few seconds/minutes until the real stamp lands
is the existing, already-honest behavior and is unchanged.
