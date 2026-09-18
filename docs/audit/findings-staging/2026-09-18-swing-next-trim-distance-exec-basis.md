> **kind:** `FINDING`

## Ask Largo swing brief showed two different "% room to target" numbers for the identical dollar level in one brief — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief (`src/lib/swing/play-brief-narrative-coaching.ts`) — found via the Ask Largo standing mandate's 5-engine health-check deep-dive |
| **Severity** | P2 (two internally-inconsistent numbers describing the same dollar target in one member-facing brief, no basis label to explain the gap — reads as the product disagreeing with itself) |
| **PR** | fix/swing-next-trim-distance-exec-basis |

### Root cause

Two independent PRs, a day apart, computed "distance to the same dollar level" using two different
price bases, and neither referenced the other:
- `play-brief-intel.ts`'s `targetRoomPct` block (`play-brief-intel.ts:1015-1024`, shipped 2026-09-17
  PR #5173) prefers `play.execMark` (the live tradable bid) over `play.mark` (the mid) whenever
  known — the same conservative-basis convention the premium-stop cushion block above it also
  follows (`cushionBasis`/`cushionBasisIsExec`, `play-brief-intel.ts:975-978`).
- `manageLifecycleCoaching`'s `distanceSuffix` (`play-brief-narrative-coaching.ts`, shipped
  2026-09-18 PR #5192) always used `play.mark` unconditionally, with no `execMark` awareness at all.

For the common single-rung ladder, `next.premium` (the coaching bullet's own trigger) and
`exitPolicy.target_premium` (the intel section's target) are the SAME dollar level — "the price
where the position doubles." Live repro, real production data, AAPL SWING:AAPL:38 OPEN brief, same
instant: the "Trade manager read" bullet read *"mark **$5.83**, needs **$11.30** (+94% from
here)"* while "What to watch" read *"**102%** move still needed from current bid"* for the identical
$11.30 target — an 8pp gap with no basis label anywhere explaining why the two numbers disagreed.

### Evidence

- `play-brief-intel.ts:1015-1024`: `targetBasis = execMarkForTarget != null && execMarkForTarget > 0
  ? execMarkForTarget : play.mark` / `targetBasisIsExec` — confirmed the sibling pattern exists
  exactly as claimed, already shipped and already rendering the "bid"-vs-"mark" label switch.
- Pre-fix `distanceSuffix` (`play-brief-narrative-coaching.ts`): computed purely off `play.mark`,
  no `execMark` reference anywhere in the function.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-next-trim-distance-exec-basis`
branch off actual latest `origin/main`, which already includes #5195 and #5198):
- Reverted the source file via `git stash`, kept the tests. `npx tsx
  --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative-coaching.test.ts`:
  **1 failure** (the new execMark-basis test) — 110/111 pass, nothing pre-existing broke.
- Restored (`git stash pop`). Re-ran the same file: **111/111 pass**. Broader sweep (all
  `play-brief*.test.ts` files): **639/639 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Single-file fix: `src/lib/swing/play-brief-narrative-coaching.ts`'s `manageLifecycleCoaching()`
`distanceSuffix` branch only. Mirrors the already-shipped `play-brief-intel.ts` pattern rather than
inventing a new one, so the two "room to target" numbers in one brief can no longer disagree.

### Fix rationale

Minimal, targeted: added `distanceBasis`/`distanceBasisIsExec`, computed identically to
`play-brief-intel.ts`'s `targetBasis`/`targetBasisIsExec` — prefer `play.execMark` when known and
positive, else fall back to `play.mark`. The rendered label switches "mark"→"bid" to match, so the
number is self-explaining rather than requiring a reader to reconcile two unlabeled figures. No new
data source — both fields were already on `TerminalPlay`.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` (post
#5195/#5198), not the originating research agent's own working-tree state — the claimed sibling
`targetBasis` pattern grep-verified at its exact cited lines, RED/GREEN reproduced independently,
broader `play-brief*.test.ts` sweep (639/639) and `tsc --noEmit` both clean.
