> **kind:** FINDING

## Swing play-brief `followups[]` chips were identical for every OPEN play regardless of state — FIXED

| | |
|---|---|
| **Area** | Ask Largo / Night Hawk Swings play-brief |
| **Severity** | P3 (product enhancement — not a correctness bug, per CLAUDE.md's "aggressive improvement-hunting" mandate) |
| **Status** | FIXED |
| **File** | `src/lib/swing/play-brief.ts` (`followupsFor`) |

### Root cause

`followupsFor(play)` built its five suggestion chips purely from `statusBucket(play)`
(open/watch/closed) with the ticker substituted in — it never looked at any
situational signal on the play itself, even though `play.manageAction` (the live
manage-engine verdict — HOLD/TAKE_PARTIAL/EXIT_RUNNER/STOP_OUT) is already computed
and already rendered in the brief's own Management section a few lines earlier in
the same file.

### Evidence

Live spot-check, 2026-09-23, sampling 6 committed positions spread across the board
(`GET /api/market/nighthawk/horizons?view=swings`, 77 committed) and pulling each
one's `GET /api/market/swing/play-brief`:

- SKHY #1267, -48.4% live P&L, manage action HOLD
- BTDR #1208, -59.5% live P&L, sitting almost exactly at its hard stop
- RBRK #1128, +124.4% live P&L, manage action TAKE_PARTIAL (already trimming)

All three (and the other 3 sampled) returned byte-identical `followups[]`:

```json
["What changed on <T> since entry?","Show <T> GEX walls on chart","HELIX flow on <T> last 24h","Vector technicals for <T>","Open full Largo for <T>"]
```

A position that just fired its trim ladder and a position sitting on its stop are
in genuinely different situations a trader would ask different follow-up questions
about — the chips gave no signal of that difference, purely templated boilerplate
with the ticker swapped in.

### Fix

Added `SITUATIONAL_FOLLOWUP_BY_MANAGE_ACTION`, a small lookup from
`TerminalPlay["manageAction"]` to one targeted follow-up phrase (TAKE_PARTIAL →
"Should I trim more?", EXIT_RUNNER → "Why exit the runner now?", STOP_OUT → "Why is
this at its stop?"). `followupsFor` now appends one extra chip when the play is OPEN
and carries a manage action with a mapped phrase — additive only, the existing five
generic chips are untouched, and a plain HOLD (the common case) gets no extra chip,
so the change is invisible for the majority of positions and only surfaces where it
adds real signal.

Regression tests added (`src/lib/swing/play-brief.test.ts`): TAKE_PARTIAL and
STOP_OUT each confirmed RED before the fix (generic five chips only) / GREEN after
(situational chip present); a third test confirms a plain HOLD position still gets
exactly the generic five with nothing appended, so the change can't regress into
always firing.

### Blast radius

Single call site (`followupsFor`, one caller inside `composeSwingPlayBrief`). No
other product surface reads this function.
