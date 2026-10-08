## 2026-10-08 — [FINDING, zerodte] The 0DTE board's shared-snapshot "soft-stale, serve anyway" branch was dead code — a snapshot's age ceiling and the Redis TTL it was stored under were the SAME number, so a real board was replaced by the empty `upstream_ok:false` fallback under ordinary RTH load — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (no bad numbers served — the synthetic fallback is structurally honest, `upstream_ok:false`/empty arrays — but real members and Largo/BIE consumers got an empty board in place of a real, slightly-aging one, repeatedly, during live RTH trading) |
| **Component** | `src/lib/platform/zerodte-service.ts` (`getZeroDteBoardPayload`, `BOARD_SNAPSHOT_TTL_SEC`, `BOARD_SNAPSHOT_SERVE_MAX_AGE_MS`, `BOARD_STALE_SERVE_MAX_AGE_MS`, new `BOARD_SHARED_SNAPSHOT_STALE_MAX_AGE_MS`) |
| **PR** | fix/zerodte-board-shared-snapshot-stale-serve |
| **Found via** | 5-engine live monitor sweep, `GET /api/market/zerodte/board` health check, cross-checked against CloudWatch |

### Root cause

`getZeroDteBoardPayload()` reads a shared Redis snapshot (`zerodte:board:snapshot:v1`) and branches
on its age in two tiers, per its own comments: (1) fresh — serve immediately, kicking a locked
background refresh past 5s; (2) soft-stale — still serve immediately (never 504 the route), but kick
an *unlocked* cold rebuild instead. Tier 2 exists specifically so a slow/overloaded rebuild (board
builds measured live at 20-45s, worse under UW-queue backpressure) still has a real, aging board to
fall back on rather than nothing.

The bug: `BOARD_SNAPSHOT_SERVE_MAX_AGE_MS` (tier-1 ceiling), `BOARD_STALE_SERVE_MAX_AGE_MS` (tier-2
ceiling), and `BOARD_SNAPSHOT_TTL_SEC * 1000` (the Redis key's own hard TTL) were **all the same
number** (600_000ms / 600s). Tier 2's condition (`shared.ageMs <= BOARD_STALE_SERVE_MAX_AGE_MS`) can
only ever be reached for a snapshot tier 1 did NOT already serve — i.e. one older than 600s. But the
Redis key itself expires at exactly 600s (`redis.set(key, payload, "EX", 600)`), so by the instant a
snapshot's age would cross into "stale but still servable," `readSharedBoardSnapshot()` has already
returned `null` for that key (Redis evicted it at the same boundary). Tier 2 was therefore
**unreachable in production** — every read past the 10-minute mark fell straight to the cold-build-
and-block path (`blockMs` default 3000ms), which under real load (board builds measured live at
20-45s) routinely times out and serves the synthetic empty `upstream_ok:false` fallback instead of
the real board that was sitting in Redis moments earlier.

### Evidence

Live `GET /api/market/zerodte/board` (temp Clerk session) returned, repeatedly, during RTH:

```
{"upstream_ok":false,"setups":[],"ledger":[],
 "discovery_health":{"BREAKOUT":{"status":"disabled","setups":0},"PIN":{"status":"disabled","setups":0}}}
```

Three re-polls ~15-20s apart all returned the identical degraded payload. In the SAME window,
CloudWatch (`/ecs/blackout-production`) shows the real discovery pipeline finding real setups every
cycle:

```
[zerodte-scan] discovery rail mix total=214 FLOW=27 BREAKOUT=197 PIN=0 multi=10 merge_policy=v2
[zerodte-breakout] 239 breakouts + 255 breakdowns (pool), built 202 setup(s) (91L/111S) ...
```

and the degraded-fallback log line firing repeatedly — 11 occurrences in one 30-minute RTH window:

```
[zerodte-board-fallback] cold build still running past maxBlockMs=3000ms with no Redis snapshot
or local last-good board to serve — returning the minimal empty fallback (upstream_ok:false).
```

i.e. the board had real, recent data to serve and served an empty one instead, exactly because the
dead branch could never reach the real snapshot sitting in Redis one tick earlier.

### Fix

Decoupled the shared-snapshot stale-serve ceiling into its OWN constant,
`BOARD_SHARED_SNAPSHOT_STALE_MAX_AGE_MS` (20 minutes), distinct from:
- `BOARD_SNAPSHOT_SERVE_MAX_AGE_MS` (10 min, unchanged) — the "fully fresh" ceiling.
- `BOARD_STALE_SERVE_MAX_AGE_MS` (10 min, unchanged) — `localBoardIsServable`'s OWN ceiling for a
  completely different mechanism (the per-replica last-good-board fallback), which has its own
  explicit 10m/11m regression test guarding a real historical `as_of`-regression incident. Reusing
  that constant for the shared-snapshot branch would have silently widened an already-correct,
  already-tested guard — deliberately left untouched.
- Raised `BOARD_SNAPSHOT_TTL_SEC` (the Redis key's own TTL) from 600 to 1200 so the key now
  genuinely outlives the new 20-minute stale-serve ceiling, giving tier 2 real room to fire.

### Regression test

`src/lib/platform/zerodte-board-convergence.test.ts` — new test stamps a shared-snapshot entry 12
minutes old (past the 10-minute fresh ceiling) with an `expiresAt` consistent with the production
Redis TTL, then asserts `getZeroDteBoardPayload()` serves THAT board's own `upstream_ok`/`setups`
(not the empty fallback) and kicks a background rebuild. RED against the pre-fix constants
(`git stash` of only `zerodte-service.ts`, keeping the new test) — `served.setups` came back `[]`
(the dead branch swallowed the stale board and a fresh, empty-setups cold rebuild served instead).
GREEN after the fix — 11/11 tests pass in the file. Full suite (`npm test`, Node 20): pending this
cycle's run (prior confirmed baseline 15819 pass / 0 fail / 3 skip). `tsc --noEmit` clean.

### Blast radius

Only `zerodte-service.ts`'s three timing constants and the one `if` condition changed (`main` branch
read confirmed before editing — no open PR touches this file). `runColdBoardBuild`'s own internal
race-check (guards against a slow cold build overwriting a fresher concurrent publish) intentionally
still uses the "fresh" ceiling — it asks "is the snapshot fresh NOW", a different, correctly-scoped
question from the stale-serve branch's "is there anything servable at all." No other reader of
`getZeroDteBoardPayload()` (the member route, Largo/BIE tools) needed changes — they already treat
whatever board comes back as the current board; this fix only changes how often that board is the
real one versus the synthetic fallback.
