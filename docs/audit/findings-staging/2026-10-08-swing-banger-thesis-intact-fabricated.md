## 2026-10-08 — [FINDING, largo-narrative] Ask Largo swing play-brief rendered "Thesis **intact**" for Banger-origin positions off a hardcoded constant, not a calibrated read — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (narrative/UX honesty — a Largo C6 "fabricated certainty" violation; no trade-management action or sizing depends on this field, but a member reads it as a calibrated green light) |
| **Component** | `src/lib/swing/play-brief-intel.ts` (`watchForSection`) |
| **PR** | fix/swing-banger-thesis-intact-largo-brief |

### Root cause

`horizonPlayFromBangerPosition` (`src/lib/swing/banger-lane-merge.ts:159`) stamps
`thesisLevel: "intact"` as a fixed literal on **every** Banger-origin merged Swing position,
regardless of price action — there is no per-position 7-pillar thesis dossier for this lane (the
same root cause the file's own header comment and `BANGER_LEDGER_REGIME_LABEL` sentinel already
document for the `regime` field, and that `thesis-health.ts`'s `thesisHealthUncalibrated()` +
`calibratedThesisPillars()` already exist to catch for the aggregate **Thesis health** panel).

That existing coverage stops at the aggregate panel. `watchForSection` in `play-brief-intel.ts`
separately renders a one-line `Thesis **${play.thesisBreak.level}** — ${play.thesisBreak.note}`
sentence for every non-closed-bucket play whenever `thesisBreak` is set at all — with no check for
the Banger-ledger sentinel. For a Banger-origin row, `thesisBreak.level` traces straight back to
that hardcoded `"intact"`, so this line rendered **"Thesis intact"** unconditionally, including for
positions sitting a few percent from a hard stop-out, right next to the SAME section's own honest
"Premium stop rail" / "Premium target rail" lines (which do carry the real, computed cushion).

### Evidence

Live repro via `GET /api/market/swing/play-brief?playId=SWING:<T>&ticker=<T>&positionId=<id>&status=OPEN`
(2026-10-08, pre-market, authenticated via `mintClerkPremiumSession`):

- **SWING:CRI:1510** — `signalKinds: ["BANGER"]`, live P&L **-59.1%** (entry $0.55, mark $0.23).
  Brief body: `"Thesis **intact** — below the 2× partial and above the hard stop\n\n...\n\nPremium
  stop rail: **$0.22** — 2% cushion from current mark — thesis breaks if mark closes
  below\n\nPremium target rail: **$1.10** — **389%** move still needed..."` — i.e. "intact" sitting
  two lines above the honest disclosure that the position is a 2% move from its own stop.
- **SWING:GLW:1479** — same shape, live P&L **-56.1%** (entry $3.20, mark $1.41), "Thesis
  **intact**" again, 9% cushion from the stop rail.
- Cross-check: the SAME two briefs' "Thesis health" section already correctly said *"Inputs not
  wired for committed positions — aggregate score withheld; pillar breakdown not shown"* — proving
  the aggregate-panel guard works exactly as designed, while this separate one-line sentence,
  fed from the same underlying hardcoded field, had no equivalent guard.
- Confirmed via `GET /api/market/nighthawk/horizons?view=swings`: of 81 committed SWING rows, 78
  carry `signalKinds: ["BANGER"]` (matches `swing/record`'s `bangerOpens: 78` of 80 total opens) —
  this is the majority of the live committed book, not an edge case.

Added two regression tests to `play-brief-intel.test.ts`: (1) a Banger-origin fixture
(`regime: BANGER_LEDGER_REGIME_LABEL`, `thesisBreak: {level:"intact", note:"below the 2× partial
and above the hard stop"}`) must render NEITHER `"Thesis **"` NOR the note text; (2) a sibling
NATIVE-position fixture (ordinary `regime` string) must still render `"Thesis **intact** —
structure holding"` unchanged — proving the suppression is scoped to the Banger sentinel, not a
blanket removal of the whole feature. Confirmed RED pre-fix via `git stash` (test 1 failed, test 2
passed) and GREEN post-fix: full `play-brief-intel.test.ts` suite 210/210 pass. Related suites
(`play-brief.test.ts`, `thesis-health.test.ts`) 156/156 pass. `npx tsc --noEmit` clean (0 errors).

### Fix rationale

Guarded the existing line with `play.regime === BANGER_LEDGER_REGIME_LABEL` — the exact sentinel
check `thesisHealthUncalibrated()` and `serving-lane.ts`'s `attachThesisExplanation` guard already
use to detect "this is a Banger-ledger row with no real per-position read," rather than inventing a
second detection mechanism. Suppression (not a reworded line) was chosen because the sentence's
only substantive content — how close the position sits to its own scale-out stop/target — is
*already* stated, more precisely (exact $ rail + exact % cushion), by the two lines immediately
below it in the same section; a reworded "Thesis: mechanical hold, not calibrated" line would just
be a third restatement of the same fact already covered twice. Scoped to this one line only — the
closed-bucket suppression immediately above it, and every other section's rendering of
`thesisBreak`, are untouched.

### Blast radius

Single call site (`watchForSection`'s one `lines.push` for the thesis line). Does not touch
`calibratedThesisPillars`/`thesisHealthUncalibrated` (the aggregate panel, already correct) or any
NATIVE swing position's rendering (the sibling regression test proves this explicitly). No other
reader of `play.thesisBreak` was found to lack an equivalent Banger-origin guard in this pass —
`play-brief.ts:1307-1308`'s `thesisBreak?.level === "break"` branch only fires on an actual
`"break"` level, which a Banger row can never produce (hardcoded to `"intact"`), so it was not
independently reachable here and is left untouched rather than speculatively changed.
