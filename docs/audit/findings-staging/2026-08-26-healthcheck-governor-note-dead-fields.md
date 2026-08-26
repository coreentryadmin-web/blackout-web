> **kind:** `FINDING`

## `zerodte-e2e-healthcheck.mjs` stage-B governor note always printed "governor ?" — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `stageB_discovery()` in `scripts/audit/zerodte-e2e-healthcheck.mjs` built its
governor note with `gov.state ?? gov.status ?? "?"`. The board's real governor payload is
`ZeroDteGovernorSummary` (`src/lib/zerodte/governor.ts:733`), which has neither a `state` nor a
`status` field — it carries `halted`, `open_plans`, `stops`, `realized_losers`, `session_pnl_pct`,
`loss_halt_count`, etc. So the expression could never resolve to anything but the literal string
`"?"` whenever `board.governor` was truthy, discarding every real signal (is the session
loss-halted? how many stops? how many opens?) that this diagnostic exists to surface. This was
never a live-market bug — the governor itself worked correctly — but the tool built to *diagnose*
zero-commit/discovery-gated sessions was silently blind on the one field that would distinguish
"gates are just strict today" from "the desk halted itself on realized losses."

**Evidence.** Live run against production during today's RTH session (2026-08-26) consistently
printed `... · governor ? · gates seen: ...` across multiple healthcheck invocations (0 committed
plays, 27 live watch-only setups). Confirmed the type mismatch by reading `ZeroDteGovernorSummary`
directly — no `state`/`status` field exists anywhere in `src/lib/zerodte/governor.ts`, and no API
route (`src/app/api/market/zerodte/board/route.ts` → `getZeroDteBoardPayload`) ever attaches one.

**Fix.** Added `formatGovernorNote(gov)` to `scripts/audit/lib/zerodte-healthcheck-eval.mjs` (pure,
unit-tested) reading the real fields — `governor unavailable` when absent, `governor HALTED (N
stop(s), X.X% session P&L)` when `halted`, else `governor live (N open, N stop(s))`. Wired into
`zerodte-e2e-healthcheck.mjs` in place of the dead expression. Verified live: the same stage now
prints `governor live (0 open, 0 stop(s))`.

**Blast radius.** Single call site — `govNote` is only built and consumed within
`stageB_discovery()`. No other script reads `board.governor.state`/`.status`.

**Fix rationale.** Kept the fix as a pure, testable helper in the existing eval lib rather than
inlining the field reads a second time, matching the file's stated purpose ("split out so ... logic
is unit-testable with plain fixtures"). Left `ZeroDteGovernorSummary` itself untouched — it already
carries everything needed; only the healthcheck's *reading* of it was wrong.
