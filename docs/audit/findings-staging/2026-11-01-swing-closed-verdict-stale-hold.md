## Night Hawk Swings: CLOSED Ask Largo brief headline/Verdict leaked a stale pre-close "HOLD" recommendation (live repro PANW:67) — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (Ask Largo × Night Hawk Swings standing mandate — member-facing correctness/precision defect) |
| **Surface** | `src/lib/swing/play-brief.ts::swingVerdictVerb` |

### Symptom

Live-fetched the real `GET /api/market/swing/play-brief?playId=SWING:PANW:67&ticker=PANW` brief for
a CLOSED position. Its envelope rendered:

- `headline`: `"HOLD — PANW 370C 1DTE"`
- `envelope.sections[0]` ("Outcome"): `"Exit P&L: +10.0% · Reason: target · Closed: 2026-10-29
  10:00 ET"`

The headline tells a skimming trader this position is still being actively held; the very next
section says it already closed two days earlier at +10.0%. Same contradiction propagates to the
Verdict line, `thesis`, `actionNarrative`'s "Entry stance" bullet, and `degradedReadLine`'s "Live
read" bullet — all four reuse the same `swingVerdictVerb` helper.

### Root cause

This is the same bug SHAPE as the already-fixed SKIP/PASSED headline leak (2026-10-21,
`docs/audit/findings-staging/2026-10-21-swing-skip-hold-headline-leak.md`), recurring for CLOSED.

`swingActionDisplay`'s CLOSED branch (`play-card-lifecycle.ts`) was fixed earlier the same day
(2026-11-01, live repro PANW:67) to return `null` instead of a false `"TARGET"` pill when
`closedReason === "target"` but `trimEnforcedBeforeClose` doesn't confirm a real ladder exit
(PANW:67's own peak of +96.2% never crossed the ladder's +100% trigger). That fix stopped the
wrong PILL label, but it left `swingVerdictVerb`'s fallback chain unguarded:

```ts
return action?.label ?? play.recommendation ?? play.status;
```

With `action` now correctly `null`, the chain falls through to `play.recommendation` — a
live-management-only field (`Recommendation = "BUY" | "HOLD" | "TRIM" | "SELL"`, no "closed" value)
that is never recomputed on close and so stays frozen at whatever it was while the play was still
OPEN/HOLD/TRIM. For PANW:67 that was the literal string `"HOLD"`.

### Fix

`swingVerdictVerb` now special-cases `play.status === "CLOSED"` the same way it already
special-cases `"SKIP"` — using a real `action.label` when `swingActionDisplay` confirms one
(TARGET/STOPPED/SCRATCH), otherwise falling to the generic `"CLOSED"` pill
(`playStatusDisplay`'s own vocabulary for this exact case) instead of the stale live-management
word:

```ts
export function swingVerdictVerb(play: TerminalPlay, action: { label: string } | null): string {
  if (play.status === "SKIP") return "PASSED";
  if (play.status === "CLOSED") return action?.label ?? "CLOSED";
  return action?.label ?? play.recommendation ?? play.status;
}
```

### Blast radius

`swingVerdictVerb` is exported specifically so the headline/Verdict line, `briefThesis`, and
`play-brief-narrative.ts`'s `actionNarrative`/`degradedReadLine` all share one source of truth —
all four call sites are fixed by this single change, the same discipline the 2026-10-21 SKIP fix
established. No other CLOSED-reason case changes: any row where `swingActionDisplay` DOES confirm
a real action (TARGET with `trimEnforcedBeforeClose: true`, STOPPED, SCRATCH) still supplies that
`action.label` and is unaffected — this only changes the previously-unguarded null-action case.

### Evidence (RED→GREEN proof)

Added `composeSwingPlayBrief: CLOSED headline/Verdict never leak a stale pre-close recommendation
(live repro PANW:67)` to `src/lib/swing/play-brief.test.ts`, modeled directly on the PANW:67 live
repro (`status: "CLOSED"`, `recommendation: "HOLD"`, `closedReason: "target"`,
`trimEnforcedBeforeClose: false`).

Pre-fix (confirmed by temporarily stashing just the `play-brief.ts` fix and re-running): **192
pass / 1 fail** — the new test failed, headline read `"HOLD — PANW 370C 1DTE"`.

Post-fix: `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief.test.ts
src/lib/swing/play-brief-narrative.test.ts src/features/nighthawk/command-deck/play-card-lifecycle.test.ts`
→ **425/425 pass**. `npx tsc --noEmit` clean. Ran on Node 20 (`/opt/node20`, v20.20.2).
