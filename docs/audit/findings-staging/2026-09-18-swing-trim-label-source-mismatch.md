> **kind:** `FINDING`

## Night Hawk Swings command-deck TRIM label falsely implied the profit ladder had fired — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings command-deck (`src/features/nighthawk/command-deck/play-card-lifecycle.ts`) — shared display code, whole desk blast radius, found via the Ask Largo standing mandate |
| **Severity** | P2 (a member-facing label could read "trim now, price hit the trigger" on a position where nothing had fired and the system wasn't acting — a real, misleading signal, not just a missing-data gap) |
| **PR** | fix/swing-trim-label-source-mismatch |

### Root cause

`swingActionDisplay()` (`play-card-lifecycle.ts`) unconditionally borrowed
`exitPolicy.trim_levels`'s next-unfired rung's `trigger_pct` for the "TRIM N%" label whenever
`recommendation === "TRIM"`. But `manage.ts`'s `TAKE_PARTIAL`/`EXIT_RUNNER` actions (both of which
map to `recommendation:"TRIM"` via `recommendationFromManageAction`) come from MULTIPLE
independent rungs — only `"profit_ladder"` (manage.ts:341-342) actually fires off the ladder.
`catalyst_shift`/`regime_shift`/`flow_decay`/`rel_strength_loss`/`vol_collapse` (manage.ts:335,
338, 345, 348, 351) are evidence-only advisories with a generic "consider trimming" reason
completely unrelated to the ladder's own trigger_pct.

Live repro, found via the Ask Largo standing mandate's 5-engine health-check deep-dive (CRWD
position #39): the position's recommendation was TRIM via `catalyst_shift` (advisory-only,
`manageEnforced:false`, position genuinely unchanged, +15.4% P&L nowhere near the ladder's +100%
trigger), yet the desk-wide command-deck label read "TRIM 100%" — read by a trader as "the +100%
trigger just fired, trim now," when nothing had fired and the system wasn't acting. This is shared
code rendering on the terminal command-deck display generally, not just the Ask Largo brief, so
blast radius is the whole desk.

### Evidence

Grep evidence (pre-fix, on `origin/main`, which already includes #5194):
- `play-card-lifecycle.ts:304-307` (pre-fix): unconditional `play.exitPolicy?.trim_levels?.find((t)
  => !t.fired)` lookup whenever `recommendation === "TRIM"`, no check of what produced the
  recommendation.
- `adapters.ts:175-187`: `recommendationFromManageAction` maps BOTH `TAKE_PARTIAL` and
  `EXIT_RUNNER` to `"TRIM"` — a single output value from multiple distinct action sources.
- `manage.ts:335,338,341-342,345,348,351`: `catalyst_shift`/`regime_shift`/`profit_ladder`/
  `flow_decay`/`rel_strength_loss`/`vol_collapse` — six distinct rungs, only `profit_ladder`
  (line 342) genuinely tied to `exitPolicy.trim_levels`.
- `types.ts:275-287`: `TerminalPlay.manageReason?: SwingManageRung | null` — the exact rung name
  is already carried on the play, confirming the fix had a real, already-available signal to
  distinguish the cases rather than needing a new field.
- Existing test coverage checked before touching anything: `play-card-lifecycle.test.ts`'s only
  prior TRIM test ("TRIM recommendation wins over STILL BUY") sets `recommendation: "TRIM"`
  directly without ever setting `manageReason`, so it exercises the pre-existing (now
  `manageReason == null`) fallback path — it does NOT assert the mislabeling behavior as
  intentional for the advisory-rung case, confirming this was a genuine unguarded gap, not an
  accepted tradeoff.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-trim-label-source-mismatch`
branch off the actual latest `origin/main`, which already includes #5194's merge):
- Reverted `play-card-lifecycle.ts`, kept the tests. `npx tsx --experimental-test-module-mocks
  --test src/features/nighthawk/command-deck/play-card-lifecycle.test.ts`: **1 failure** (the new
  catalyst_shift-mismatch test) — the expected "guard doesn't exist yet" shape. 53/54 pass,
  nothing pre-existing broke.
- Reapplied. Re-ran the same file: **54/54 pass**. Broader sweep (all command-deck test files +
  `live-plays.test.ts` + `manage.test.ts`): **496/496 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.
- Full `npm test` suite (Node 20): result to be appended once the background run completes.

### Blast radius

Single-file, single-branch fix:
- `src/features/nighthawk/command-deck/play-card-lifecycle.ts` — `swingActionDisplay()`'s TRIM
  branch only. `zeroDteActionDisplay()`'s own separate TRIM branch (line ~348, 0DTE's exit-sync
  ratchet system) was deliberately left untouched — 0DTE has no `manageReason` concept and its
  TRIM recommendation is genuinely always ladder-sourced (confirmed via grep — no equivalent
  multi-rung advisory system exists on the 0DTE side), so applying the same guard there would be
  scope creep onto a system that doesn't have this bug.

`swingActionDisplay` is shared render logic — every surface that calls it (the command-deck
terminal display and any Ask Largo brief code path that reuses `TerminalPlay`'s label) benefits
from the fix at this one call site.

### Fix rationale

Minimal, targeted: only gate the existing ladder-citing behavior on a positive `manageReason`
check, using a field (`SwingManageRung`) that was already carried on `TerminalPlay` and already
fully populated by the same pipeline this session's earlier `manageEnforced`/`manageReasonDetail`
fixes threaded through — no new data model changes needed. The `manageReason == null` branch
deliberately preserves the exact pre-existing behavior (most swing rows have no live manage tick
yet, so treating absence as "assume ladder" avoids silently downgrading every untouched row's
label — only a POSITIVELY confirmed non-ladder rung suppresses the percentage).

### Verification

- Independent re-verification performed from scratch on a fresh branch off actual latest
  `origin/main` (which already includes #5194's merge), not the originating research agent's own
  working-tree state — every claimed pre-existing behavior (`recommendationFromManageAction`'s
  mapping, `manage.ts`'s six rung-to-action mappings, `TerminalPlay.manageReason`'s existing
  field) independently grep-verified, diff applied cleanly, RED/GREEN reproduced independently,
  tsc clean, and confirmed the existing test suite did NOT already treat this mismatch as accepted
  behavior before writing new tests.
- Full suite result to be appended once the background run completes.
