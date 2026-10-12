> **kind:** FINDING

## `thesis_break` exit narrative omitted peak context a trader needs — ENHANCED

| | |
|---|---|
| **Status** | ENHANCED (narrative enrichment, no behavior/gate change) |
| **Area** | Night Hawk 0DTE — exit engine (`src/lib/zerodte/exit-engine.ts`) |
| **Severity** | P3 (product/UX enhancement — aggressive-mode improvement-hunt, not a correctness bug) |

### What was missing

Both `thesis_break` exit-detail constructions in `exit-engine.ts` (one in `decideTrimScale`,
one in the main `evaluateExitState` ratchet path) built their narrative from only the current
P&L and the breaking evidence sentence:

```
Thesis broken (veto) at -6.73% — exiting the remaining position at market, not hoping:
[gex-walls] short target path crosses dominant put wall 35 ...
```

The adjacent floor-exit branch, a few lines above each thesis_break branch, already states
its peak (`"...armed by a +5.62% peak..."`) — but `thesis_break` (which can fire at *any*
P&L, including immediately after commit) never mentioned `peakPnlPct` even though it was
already in scope at both call sites. A trader reading only the narrative has no way to tell
an immediate failure (never moved favorably) apart from a real give-back (a double-digit
peak that reversed) — two very different trading experiences that currently read identically
except for the raw exit percentage.

### Evidence this is a real gap, not a hypothetical

Found while auditing three real `thesis_break:gex-walls` losses from the same live session
(2026-10-12): IONQ (-6.73%, `peak_pnl_pct: 0`), TTMI (-7.14%, `peak_pnl_pct: 0`), and QQQ
(-8.47%, `peak_pnl_pct: 2.02`). All three structured rows carry the real peak — only the
human-readable `detail` string omitted it. The first two are indistinguishable from the
third in the narrative alone, despite representing a meaningfully different situation (never
worked at all vs. had a small real move).

### Fix

Added `thesisBreakPeakClause(peakPnlPct: number | null)` next to the existing `floorReason`
helper, reusing `EXIT_RULES.ratchet_arm_pnl_pct` (the same +20% threshold the ratchet floor
itself uses to decide whether a peak was a "real move") as the dividing line:

- `peakPnlPct == null` → no clause (defensive; both callers have peak available in practice).
- `peakPnlPct >= 20` → `" (had reached a +X% peak before the thesis broke)"` — a real give-back.
- `0 < peakPnlPct < 20` → `" (peaked at only +X%, never cleared the ratchet's own +20% arm
  threshold)"` — a real but sub-threshold move (QQQ's shape).
- `peakPnlPct <= 0` → `" (never moved favorably before the thesis broke)"` — an immediate
  failure (IONQ/TTMI's shape).

Wired into both call sites, ahead of the existing `bankedTranchesClause` (which still needs
to stay last — tested).

### Blast radius

Both `thesis_break` detail constructions in `exit-engine.ts` (ratchet-mode main path and
`decideTrimScale`). No other file constructs this string. Purely additive to the `detail`
string — `reason`, `action`, `floorPnlPct`, and every other field on `ExitDecision` are
untouched, so nothing that gates on the exit decision (board display logic, grading, the
record route) is affected; only the free-text narrative a trader/Largo reads is richer.

### Fix rationale

Reused the ratchet's own existing arm threshold (`EXIT_RULES.ratchet_arm_pnl_pct`) rather
than inventing a new constant — the distinction a trader cares about ("was this a real move
that reversed, or did it never work") is the same distinction the ratchet mechanism itself
already uses to decide whether to arm a protective floor, so borrowing it keeps the narrative
consistent with mechanics the trader already sees elsewhere in the exit text. Left
`gex-walls.ts`/`detectThesisBreak`/the gate/veto pipeline entirely untouched — this is a pure
narrative enrichment on an already-decided exit, not a change to when or why `thesis_break`
fires.

### Verification

- New tests in `exit-engine.test.ts` (4 added: 3 ratchet-mode peak bands + 1 trim_scale-mode
  parity check reusing an existing fixture) proven RED (4 fail) without the fix via
  `git stash`, GREEN (102/102) with it.
- `src/lib/zerodte/record.test.ts` (35/35), `exit-sync.test.ts` (17/17) — no regressions.
- `npx tsc --noEmit -p .` — clean.
- Full `npm test` run in progress at time of writing (background), Node 20.
