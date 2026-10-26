> **kind:** `FINDING`

## 0DTE record.ts served historical pre-2026-10-06 rows' raw unrounded `tranche_fraction` float through `GET /api/market/zerodte/record` / `get_zerodte_record`, even after the 2026-10-06 write-time fix — FIXED

**Status.** FIXED (this PR).

### Area

`src/lib/zerodte/record.ts` (`toPlay()`), `src/lib/zerodte/strategy-version.ts`
(`buildResolvedExitPolicy()`). 0DTE / Night Hawk lane.

### Background — the 2026-10-06 fix and its scope boundary

On 2026-10-06 a live audit found `buildResolvedExitPolicy()`'s `trailing_rule` string embeds
`TRIM_SCALE_RULES.tranche_fraction` (exactly 1/3) via raw template-literal interpolation, so the
string served to members/Largo read `tranche_fraction=0.3333333333333333` — a 16-digit
IEEE-754 float leaking straight past the shared `roundFloats()` response-boundary fix (which only
walks genuine JSON *number* values and can't reach a float baked into a *string*). That fix
rounds the **display** copy of `trailing_rule` to 2dp, applied strictly *after* `config_hash` is
computed from the unrounded core object — `config_hash` fingerprints the calibration cohort, so a
display-only rounding fix must never move it (the file's own comment on this is explicit: moving
it would silently fork a calibration cohort).

That fix only runs when `buildResolvedExitPolicy()` is called **fresh** — i.e. at commit time
(`scan.ts`, which freezes the result into `entry_context.exit_policy_snapshot`, an immutable
per-row blob `readFrozenExitPolicy` later reads back verbatim so graders replay a row under the
exact numbers it committed with, never under current code). Any row **committed before
2026-10-06** froze its OWN `exit_policy_snapshot.trailing_rule` string at commit time with the
OLD, unrounded raw float baked in — that string is immutable and is never rebuilt.

### Root cause (the gap this PR closes)

`src/lib/zerodte/record.ts`'s `toPlay()` served `entry_context` **verbatim** —
`entry_context: r.entry_context` — to `ZeroDteRecordPlay`, which is what
`GET /api/market/zerodte/record` (and therefore the `get_zerodte_record` Largo tool) returns.
Because this is a straight passthrough of the DB row's own frozen blob, every historical row
committed before 2026-10-06 whose policy resolved to `trim_scale` still leaked
`tranche_fraction=0.3333333333333333` through this read path, even though every FRESH commit
after 2026-10-06 was already clean. Roughly 30 historical rows were affected.

### Fix

1. **`src/lib/zerodte/strategy-version.ts`** — extracted the existing inline rounding regex out
   of `buildResolvedExitPolicy()` into a new exported, pure, idempotent function
   `roundTrailingRuleDisplay(trailingRule: string): string`. `buildResolvedExitPolicy()` now calls
   it instead of duplicating the regex inline — single source of truth, byte-identical behavior
   (its own existing tests in `exit-policy-snapshot.test.ts` pass unchanged, unmodified).
2. **`src/lib/zerodte/record.ts`** — added `withRoundedTrailingRuleDisplay()`, applied at the one
   serialization point in `toPlay()` (`entry_context: withRoundedTrailingRuleDisplay(r.entry_context)`
   in place of the old verbatim `r.entry_context`). It shallow-clones `entry_context` and its
   `exit_policy_snapshot` ONLY when a string `trailing_rule` is present and rounding actually
   changes it; otherwise it returns the exact same object reference, so the common case (fresh
   rows, condor rows, pre-WS-02 rows with no snapshot at all) allocates nothing. `config_hash` is
   never touched — not read, not recomputed, not present anywhere in the new function's write
   path — preserving the exact invariant the 2026-10-06 fix's own comment establishes. The
   original `r.entry_context` object (and its DB row) is never mutated in place.

Nothing writes to the database, nothing recomputes `config_hash`, and nothing changes what a
fresh commit stamps — this is a display-only fix on the read path for historical data, the
2026-10-06 fix's own documented discipline applied to the one call site it didn't yet cover.

### Evidence (RED → GREEN)

New regression test in `src/lib/zerodte/record.test.ts`: a fixture row whose
`entry_context.exit_policy_snapshot.trailing_rule` is byte-identical to a real pre-2026-10-06
frozen string (`tranche_fraction=0.3333333333333333`), with an arbitrary realistic
`config_hash`. Asserts (a) the served play's `trailing_rule` reads
`tranche_fraction=0.33` (rounded), (b) `config_hash` is **byte-identical** to the fixture's
original value — the critical invariant, checked explicitly — and (c) the original fixture
object is unmutated.

- **RED** (fix stashed via `git stash push -- src/lib/zerodte/record.ts
  src/lib/zerodte/strategy-version.ts`, test kept): 41/42 pass, 1 fail — the new test, with the
  exact unrounded string as `actual` vs the rounded string as `expected`.
- **GREEN** (fix restored, `git stash pop`): 42/42 pass in `record.test.ts`; 57/57 pass running
  `record.test.ts` + `exit-policy-snapshot.test.ts` together; `strategy-version.test.ts` (35
  tests incl. `tier-export.test.ts`/`terminal-frozen-policy.test.ts`/`terminal-ladder.test.ts`)
  unaffected, all green.
- `npx tsc --noEmit` (full repo): clean, no errors.
- Full suite (`npm test`, Node 20.20.2): see this PR's description for the exact pass/fail count.

### Blast radius

- **`src/lib/zerodte/board.ts`** (the live board path) calls `buildResolvedExitPolicy()` FRESH on
  every read — already covered by the 2026-10-06 fix, untouched here, not affected by this gap.
- **`src/lib/zerodte/tier-export.ts`**'s `buildTierExportRow()` has the **exact same
  verbatim-passthrough shape** for `exit_policy_snapshot` — it calls `readFrozenExitPolicy(ctx)`
  and returns the result (`frozen`) as-is, with no rounding applied, so the admin
  `GET /api/admin/zerodte/tier-export` route (and anything reading it, e.g.
  `tier-exit-mode-ab.mjs`) can serve the same raw historical float for the same ~30 rows.
  **Deliberately NOT fixed here** — admin-only surface, out of scope for this PR per the task's
  own instruction to avoid widening scope unprompted; noting it so it can be triaged/assigned
  separately (same shape, same one-line fix: `exit_policy_snapshot: frozen ? { ...frozen,
  trailing_rule: roundTrailingRuleDisplay(frozen.trailing_rule) } : null}`).
- No other call site reads `entry_context.exit_policy_snapshot.trailing_rule` directly (confirmed
  via `grep -rn "exit_policy_snapshot" src/lib/zerodte/*.ts`, excluding tests) besides
  `exit-sync.ts`'s `readFrozenExitPolicy` (the shared reader, untouched — it must keep returning
  the raw frozen numbers so the grader replays rows under the committed numbers, never a
  display-rounded copy) and `terminal-ladder.ts` (reads numeric fields only, never
  `trailing_rule`).
