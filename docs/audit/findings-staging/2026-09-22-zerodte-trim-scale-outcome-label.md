> **kind:** FINDING

## 0DTE record: `trim_scale_dead_zone_floor`/`trim_scale_runner_target` real exits mislabeled in `by_outcome` — FIXED

| | |
|---|---|
| **Engine** | Night Hawk 0DTE (`src/lib/zerodte/record.ts`) |
| **Severity** | P2 — data-correctness in the member/Largo-facing outcome breakdown, not P&L-affecting |
| **Status** | FIXED — PR (this branch), regression tests added, RED→GREEN proven via git-stash |

### Root cause

`managedOutcomeLabel()` (the function that maps a real, live-stamped `entry_context.exit.reason`
onto the record's `by_outcome`/`managed_outcome` vocabulary) hand-rolled its own ad hoc checks plus
a `/ratchet|runner/` substring regex, instead of reusing `categorizeExitReason` (exit-engine.ts) —
the module's OWN authoritative reason→family classifier, already imported into `record.ts` and
already trusted by `realExitIsBarWalkReproducible` a few lines above it for the exact same purpose.

Two real, live-stampable EXIT reasons from `exit-engine.ts`'s trim-scale mode (`decideTrimScale`)
fell through that ad hoc logic incorrectly:

1. **`trim_scale_dead_zone_floor`** — the trim-scale regime dead-zone's own protective floor (bank
   at HALF the peak when no tranche has armed yet — the trim-scale analogue of ratchet mode's
   `ratchet_breakeven_floor`/`ratchet_early_profit_floor`/`ratchet_profit_floor`, which all
   correctly bucket `"ratchet"`). This exact string contains neither `"ratchet"` nor `"runner"`, so
   it fell all the way through to the bare win/loss/breakeven-by-sign label — the only real EXIT
   reason the function had **no case for at all**.
2. **`trim_scale_runner_target`** — fires when both tranches are already banked AND the final third
   also tags the plan target (the trim-scale analogue of ratchet mode's `plan_target_final`, which
   correctly buckets `"doubled"`). This string DOES contain the substring `"runner"`, so the old
   regex mislabeled a genuine, full profit-TARGET capture as `"ratchet"` (a defensive floor exit) —
   conflating two outcome shapes that `by_outcome` exists specifically to keep apart.

### Evidence

**Unit-level RED→GREEN** (git-stash proof, `src/lib/zerodte/record.test.ts`):
- Pre-fix: `managedOutcomeLabel("trim_scale_dead_zone_floor", 0)` → `"breakeven"` (bare sign, not a
  named bucket).
- Pre-fix: `managedOutcomeLabel("trim_scale_runner_target", 60)` → `"ratchet"` (should be
  `"doubled"`).
- Two new tests added (`record.test.ts`) reproduce both live-reachable scenarios (a `withExit` row
  carrying only the real `entry_context.exit` stamp, no WS-11 reconstruction to supersede it) and
  assert the correct buckets. Confirmed RED (2 failures) on the pre-fix code via `git stash`, GREEN
  (35/35) after the fix.

**Live production confirmation** (`GET /api/market/zerodte/record?days=90` via a temp Clerk
session, read-only, 2026-09-22): **4 real committed rows currently show the bug live** —
TSLA (2026-09-21), MARA/RKLB (2026-09-18), SPCH (2026-09-16) all carry a real
`entry_context.exit.reason === "trim_scale_dead_zone_floor"` with `managed_source: "engine"`
(i.e. reached via the buggy path directly, no reconstruction override), and all four currently
render `managed_outcome: "win"` instead of the correct `"ratchet"` bucket. 7 further rows carry a
real `trim_scale_runner_target` exit, but all 7 happen to also carry a genuine WS-11 reconstruction
that supersedes the live-engine label in `managedGradeView`'s precedence — so the `"ratchet"`
mislabel for that reason is confirmed correct-by-code-reading but not yet observed live in a row
where it would actually surface (reachable whenever a trim_scale row's reconstruction is
absent/degenerate — a real, if less frequently hit, path).

### Blast radius

Only `record.ts`'s own `managedOutcomeLabel` — no other call site duplicates this logic (the module
comment already notes `categorizeExitReason` is the single source of truth `realExitIsBarWalkReproducible`
depends on; this fix brings the second consumer of exit-reason semantics into the same source of
truth instead of a second, drifted copy). No P&L numbers changed — `managed_pnl_pct`, `wins`,
`losses`, `win_rate_pct`, `avg_pnl_pct` are all unaffected (they come from the same `pnl_pct`
regardless of label); only the `by_outcome` bucket a play lands in, and its per-play
`managed_outcome` string, change.

### Fix rationale

Route `managedOutcomeLabel` through `categorizeExitReason`'s 5 categories (`stop`/`target`/
`ratchet`/`thesis`/`flat`) instead of duplicating a parallel, drift-prone reason→label mapping.
`categorizeExitReason`'s own prefix ordering already resolves both cases correctly (the dead-zone
floor is an exact match checked BEFORE the general `trim_scale`-prefix `"target"` bucket), so this
single change fixes both defects and removes the class of bug entirely (any future EXIT reason
`exit-engine.ts` adds gets categorized once, correctly, in one place, rather than needing a second
hand-written check here). Left unchanged: the `bySign` fallback for a `null`/unrecognized reason
(same fail-closed posture `categorizeExitReason` and `realExitIsBarWalkReproducible` already use).

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` for the next-session checklist entry.
