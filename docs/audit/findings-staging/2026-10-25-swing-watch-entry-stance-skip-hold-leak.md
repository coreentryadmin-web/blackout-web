## 2026-10-25 — [FINDING, P3 Night Hawk Swings / Ask Largo] `watchEntrySection`'s own "Entry stance" label leaks the overloaded SKIP→"HOLD" value the 2026-10-21 fix already named as fixed for three sibling call sites — a fourth, unnamed site — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Swing play-brief "Entry" section — `src/lib/swing/play-brief.ts`'s `watchEntrySection()` |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate — fresh envelope-completeness dig against a live PASSED/SKIP-bucket brief, 2026-10-25 |

### Symptom

Live repro: `GET /api/market/swing/play-brief?playId=SWING:TSLA&ticker=TSLA&expandIntel=1` on
2026-10-25 (a RESEARCH-bucket candidate, `TSLA 377.5P 7DTE`, internal `status: "SKIP"`). The
"Entry" section read:

```
**Entry stance:** HOLD

Serving section: RESEARCH
```

but the SAME response's "Trade manager read" section, two sections later, read:

```
• Entry stance — PASSED. 3 gates blocking entry — see below.
```

and the Verdict/headline both correctly said `PASSED` too — one brief, one play, the identical
phrase "Entry stance" carrying two contradictory values a few lines apart.

### Root cause

`swingVerdictVerb` (`play-brief.ts:138-141`) was built on 2026-10-21 specifically to kill this bug
shape: a RESEARCH/SKIP candidate (`play.status === "SKIP"` — the desk declining a setup, nothing
ever entered) leaves `swingActionDisplay(play)` null by design, so the naive fallback chain
`action?.label ?? play.recommendation ?? play.status` falls straight through to
`play.recommendation`, which `entry-verdict.ts`'s RESEARCH branch stamps the literal string
`"HOLD"` even though nothing is being held. That fix's own doc comment (lines 129-136) explicitly
enumerates and closes three call sites sharing this exact fallback shape: the headline/Verdict line
(fixed directly in `swingVerdictVerb` itself), `actionNarrative`'s "Entry stance" bullet, and
`degradedReadLine`'s "Live read" bullet (both fixed by exporting `swingVerdictVerb` for reuse).

`watchEntrySection`'s own "Entry stance:" label — a fourth, separate rendering of the identical
concept in the same file, a few hundred lines below — was never named in that enumeration and was
never updated:

```ts
const label =
  swingActionDisplay(play)?.label ??
  play.swingEntryAction?.toUpperCase() ??
  play.recommendation ??
  "WAIT";
```

Same shape, same gap: `swingActionDisplay(play)?.label` is null for SKIP by design,
`play.swingEntryAction` is always null for a never-enterable RESEARCH row, so this fell straight
through to the literal `"HOLD"` — leaking the exact contradiction `swingVerdictVerb` exists to
prevent, one call site over from the three it had already closed.

### Fix

`watchEntrySection` now special-cases `play.status === "SKIP"` first and reuses the already-exported
`swingVerdictVerb(play, action)` — the same pattern `actionNarrative` already uses — before falling
through to the existing, unchanged chain for every other status. Every non-SKIP play (WATCH,
WAITING_FOR_ENTRY with a real `swingEntryAction`, etc.) renders byte-identically to before; only the
SKIP case changes, from `"HOLD"` to `"PASSED"`.

### Blast radius

Checked every other reader of this label and of `swingVerdictVerb`'s own fallback shape in this
file (`briefThesis`, the headline, the Verdict line, `actionNarrative`, `degradedReadLine`) — all
already correct per the 2026-10-21 fix; `watchEntrySection` was the only site still leaking.

### Tests

`src/lib/swing/play-brief.test.ts` — new test
`"composeSwingPlayBrief: Entry section's own 'Entry stance' label agrees with Verdict/Trade-manager-read for a SKIP candidate"`.
Confirmed RED on pre-fix code (`**Entry stance:** HOLD`) via `git stash`, GREEN after the fix.
Full `src/lib/swing/*.test.ts` (2039 tests) and `npx tsc --noEmit` both clean post-fix.
