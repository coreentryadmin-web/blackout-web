# Ask Largo swing LIVE-play "Exit now" bullet claims "thesis or ladder fired" even when neither is true

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (member-visible, materially misleading reason on a real open production position) |
| **Area** | Swing / Ask Largo LIVE-play "Trade manager read" section, `actionNarrative()`'s SELL branch |
| **Files** | `src/lib/horizon-plays.ts` (`HorizonPlay.manageReason`), `src/lib/swing/live-plays.ts` (`manageObservablesFromEvent` now returns the deciding rung), `src/lib/swing/play-brief-resolve.ts` (threads `manageReason` into `HorizonDeckSource`), `src/features/nighthawk/command-deck/types.ts` + `adapters.ts` (`TerminalPlay.manageReason`), `src/lib/swing/play-brief-narrative.ts` (`sellReasonClause`), `src/lib/swing/play-brief-narrative.test.ts` (3 new tests) |

## Context

Live capture from `GET /api/market/swing/play-brief?playId=SWING:NRG&ticker=NRG&positionId=34`
(a real committed, still-open swing position) during the standing 5-engine live monitor cycle
(2026-09-10, ~14:00 UTC):

```
Verdict: "EXIT — NRG 110C 8DTE" ... Manage engine: EXIT
Trade manager read: "• Exit now — thesis or ladder fired. Flatten per manage engine. ..."
What to watch: "Thesis intact / Premium stop rail: $1.96 — thesis breaks if mark closes below"
Management: "Trim ladder: +100% / next trim at +100% (not yet fired)"
```

The same brief, in the same response, asserts a broken thesis or a fired ladder ("Exit now —
thesis or ladder fired") in one section while two OTHER sections of the identical response
correctly say the thesis is still intact and the trim ladder has not fired. A member reading only
the headline bullet would reasonably conclude the setup failed; reading the rest of the brief
shows it didn't — the real reason NRG's manage engine forced EXIT was `expiry_risk` (8 DTE
remaining, `manage.ts`'s own doc comment on that rung: "too little time / theta cliff for the
lane → force manage (**intact thesis**)"), a purely time-based force-manage with no thesis
degradation at all.

## Root cause

`actionNarrative()`'s SELL branch (`play-brief-narrative.ts`) always rendered the identical
hardcoded line regardless of WHY `manageAction` resolved to `EXIT`/`STOP_OUT`:

```ts
} else if (rec === "SELL") {
  lines.push("**Exit now** — thesis or ladder fired. Flatten per manage engine.");
}
```

`manage.ts` computes a specific deciding rung (`expiry_risk`, `structural_stop`, `thesis_stop`,
`premium_stop`, `catalyst_shift`, `regime_shift`, `time_stop`, ...) via
`manageObservablesFromEvent()` in `live-plays.ts` — but that rung was only used internally to
resolve `manageAction`/`thesisLevel` and then discarded; it never reached `HorizonPlay`,
`TerminalPlay`, or the narrative layer. The narrative had no way to know which of several very
different real reasons produced the SELL recommendation, so it always guessed the same (wrong,
for NRG) generic phrasing. Also worth noting: "ladder fired" never made semantic sense in this
branch at all — a fired trim rung produces `rec === "TRIM"` (a separate branch just above, "Desk
says TRIM"), never `rec === "SELL"` — so the clause was misleading by construction, not just for
this one live case.

## Evidence

New tests in `src/lib/swing/play-brief-narrative.test.ts` (RED→GREEN, verified via `git stash` on
`play-brief-narrative.ts` only — pre-fix all three assert on the new `manageReason`-driven text
and fail against the old hardcoded line; post-fix all pass):
- `SELL from expiry_risk states time-based reason, not a false thesis/ladder claim` — asserts the
  exact NRG-shaped text and that the old false claim is absent.
- `SELL from a real thesis break still says thesis broke` — confirms a genuine
  `structural_stop`/`thesis_stop` rung still gets an accurate (not softened) message.
- `SELL with unknown reason and no detected thesis break states no mechanism` — confirms the
  honest-omission fallback (no manage-sync snapshot yet) states no false mechanism rather than
  guessing.

Full `npm test` (Node 20) + `npx tsc --noEmit`: clean (see PR).

## Blast radius

`grep -rn "manageReason"` across the changed files confirms one clean chain:
`manage.ts` (rung, unchanged) → `live-plays.ts`'s `manageObservablesFromEvent` (now returns it) →
`HorizonPlay.manageReason` (`horizon-plays.ts`, new optional field) →
`play-brief-resolve.ts`'s `horizonRowToDeckSource` → `HorizonDeckSource.manageReason`
(`adapters.ts`, new optional field) → `terminalPlayFromHorizon` → `TerminalPlay.manageReason`
(`types.ts`, new optional field) → `play-brief-narrative.ts`'s new `sellReasonClause()`. Every
field is optional/nullable end-to-end, so no existing caller that doesn't populate it changes
behavior (falls through to the honest-omission default). No schema/API shape change beyond the
additive field. `recommendationFromManageAction()` (adapters.ts, decides SELL vs TRIM vs HOLD) was
read but not changed — this fix only changes what SELL's own coaching text says, not when SELL
fires.

## Fix rationale — what was deliberately left unchanged

Considered inferring the reason purely from data already on `TerminalPlay` (e.g. DTE ≤ some
threshold ⇒ assume expiry risk) instead of threading the real rung through — rejected because that
re-derives a decision `manage.ts` has already made authoritatively, and could drift from the
actual lane-specific `expiryRiskDte` threshold (`manage.ts`'s per-sub-lane params) the real gate
uses. Threading the actual rung is the same "narrate what's real, never re-derive and risk
disagreeing with the source of truth" discipline this repo already applies elsewhere (e.g. the
2026-09-10 trim-ladder-`fired`-ignores-`enforced`-gate fix).

Kept the spot-only structural-break fallback (`structuralBreakFromSpot` in `live-plays.ts`, used
before any manage-sync snapshot exists) working via `thesisLevel` rather than inventing a
synthetic rung for it — `sellReasonClause()` checks `thesisLevel?.level === "break"` as a
secondary signal specifically for that case, so a genuine spot-detected break still says "thesis
broke" even with no `manageReason` rung populated yet.
