## 2026-10-13 — [Vector] `VECTOR_0DTE_WALL_COUNT` doc comment no longer cites the wrong "(8)" baseline — FIXED (doc-only, zero behavior change)
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Vector / documentation hygiene | P4 — comment-only correction, no behavior change | FIXED |

### What was wrong

The 2026-10-12 FINDINGS.md entry "[Vector] 0DTE wall-count override is a no-op at the desk's
default 3m timeframe" explicitly separated two different things found in
`src/features/vector/lib/vector-bar-timeframes.ts`:

1. A **safe, mechanical text fix** — the doc comment on `VECTOR_0DTE_WALL_COUNT` said it was
   "wider than the 3m default (8)", but `wallCountForTimeframe`'s own `tf<=3` branch is
   `Math.max(VECTOR_0DTE_WALL_COUNT, 11) = 11`, not 8. The "(8)" was simply the wrong baseline for
   the desk's actual default timeframe.
2. A **deeper, not-mine-to-decide design question** — whether the 0DTE override was ever meant to
   widen the rail past 11 at tf=3, and whether `VECTOR_0DTE_WALL_COUNT` (member-tuned before, per
   its own revision history) should be bumped to restore that effect. That entry correctly declined
   to touch this and left it open for Vector's owning lane.

This entry fixes only (1).

### Fix

Rewrote the doc comment on `VECTOR_0DTE_WALL_COUNT`
(`src/features/vector/lib/vector-bar-timeframes.ts:18`) to state the real mechanics: at the desk's
3m default, `wallCountForTimeframe`'s own floor of 11 already dominates the constant's `Math.max`,
so the override has no effect there — it only widens the rail at `tf<=1` (8 → 10). The comment now
points at the open FINDINGS.md entry for the unresolved design question instead of silently
describing a 3m-default effect the constant doesn't actually produce.

**No logic changed** — `VECTOR_0DTE_WALL_COUNT`'s value (10), `wallCountForTimeframe`, and
`wallCountForHorizon` are byte-identical to before this PR. Verified via `tsc --noEmit` (clean) and
the full `src/features/vector/lib/vector-bar-timeframes.test.ts` suite (15/15 pass, unchanged).

### Blast radius

Single file, comment-only. No other call site reads this constant's doc comment; `grep` for
`VECTOR_0DTE_WALL_COUNT` confirms the only consumers are `wallCountForTimeframe` and
`wallCountForHorizon` in the same file, both untouched.

### What was deliberately left unchanged

The design question from the 2026-10-12 entry (whether to bump `VECTOR_0DTE_WALL_COUNT` to restore
a real 0DTE-vs-non-0DTE visual difference at the 3m default) — that entry stays OPEN in
`FINDINGS.md` for Vector's owning lane; this PR does not resolve it.
