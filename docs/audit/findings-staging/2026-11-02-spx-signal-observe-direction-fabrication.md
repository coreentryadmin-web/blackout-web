> **kind:** FINDING

## `spx-signal-observe` fabricates a directional call for every WAIT-zone tick, corrupting every SPX Slayer accuracy stat downstream — FIXED

**Status:** FIXED (`fix/spx-signal-observe-direction-fabrication`)

### Root cause

`src/app/api/cron/spx-signal-observe/route.ts:78-79` persisted `direction` by
re-deriving it from the raw sign of `score`:

```js
const direction: "long" | "short" | null =
  score > 0 ? "long" : score < 0 ? "short" : null;
```

This has no neutral zone. The actual engine, `computeSpxConfluence()`
(`src/features/spx/lib/spx-signals.ts:921-941`), already computes the canonical
`confluence.direction`, which is correctly `null` whenever `|score| < 10` — the
`WAIT`/`bias:"neutral"` zone, i.e. "mixed confluence, stand aside, no edge." The cron
route ignored that field and recomputed its own, so any score in `(-10, 0)` or
`(0, 10)` — a genuine no-edge tick per the engine's own `action:"WAIT"` — still got
persisted with a fabricated `direction:"short"` or `direction:"long"`.

### Evidence

Pulled the 100 most recent real persisted rows (2026-10-30 RTH, via
`GET /api/admin/signal-analytics?days=30`) and re-derived the engine's own
action/bias/direction rule from each row's stored `score`, comparing it to the
stored `direction`:

- **22/100 rows**: `engine_action:"WAIT"` with a non-null `direction` that should
  have been `null`. Examples: `score=-9, action=WAIT, direction="short"`;
  `score=3, action=WAIT, direction="long"`; `score=-1, action=WAIT,
  direction="short"`.
- The remaining 78/100 (all `|score|>=10`) matched the engine's own rule exactly —
  confirming this is specifically a WAIT-zone threshold bug, not a general
  sign-flip bug. `score` vs `sum(factors[].weight)` and `direction`'s sign vs the
  signed net weight both matched exactly on all 100 rows.
- New regression test (RED before the fix, GREEN after, proven via `git stash`/
  `git stash pop`): `src/app/api/cron/spx-signal-observe/route.test.ts` asserts the
  route source assigns `direction` from `confluence.direction` and does not contain
  the raw-sign re-derivation.

### Blast radius

`direction_correct` is computed purely from this `direction` column
(`src/features/spx/lib/spx-signal-db.ts:86-92`: `CASE WHEN direction='long' AND
move>0 THEN true ... ELSE NULL END` — `NULL` only when `direction IS NULL`). Every
fabricated-direction WAIT row was therefore graded right/wrong as if the engine had
made a real call, feeding every metric on the admin Signal Analytics dashboard
(`src/app/api/admin/signal-analytics/route.ts`): `summary.overall_accuracy`,
`signal_correlations[].accuracy_pct/bullish_accuracy/bearish_accuracy` (per-factor
predictive-power stats), `score_band_performance` (the `<52` bucket mixed genuine
low-conviction calls with no-edge ticks), `session_window_performance`,
`hourly_accuracy`.

### Fix rationale

Use `confluence.direction` (already correctly computed by the canonical engine,
including the neutral-zone null) instead of recomputing it from `score`'s raw sign.
This is the minimal fix at the single site that owned the bug — no other call site
recomputes direction from score for persistence purposes. Deliberately left
unchanged: the separate, still-open Finding 2 from the same audit pass (the admin
"Gate Block Frequency" panel always reading `gates_blocked_json: []`) — that is a
different root cause (a column nobody ever writes, not a value computed wrong) and
is tracked as its own item rather than folded into this fix.
