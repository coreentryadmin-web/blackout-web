## 2026-10-21 — [FINDING, swing] counterThesisLine() counted a mechanical, DTE-driven Theta budget fade as an "independent read" — Ask Largo round-3 deep-dive

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (evidence-weight framing overstates conviction near expiry — Largo C6 calibration violation) |
| **Surface** | `src/lib/swing/play-brief-narrative.ts` — `counterThesisLine()` |

### Root cause

The Counter-thesis bullet's "corroborated across N independent reads" framing (C6/C7) folded a
mechanical, DTE-countdown-only pillar fade (Theta budget) into the same `reasons[]` array as genuine
market reads (dealer gamma, Vector bias, HELIX flow, Night Hawk, 0DTE, MACD, structure break),
inflating the apparent evidentiary weight of the counter-thesis with something that fires regardless
of what the market actually did.

`thetaBudgetScore()` (`thesis-health.ts`) is confirmed purely a function of `dte` and `subLane`'s
cliff/migration thresholds — no price, flow, or any other market signal. The function's own comment
says so explicitly: "time decay is the whole point of the pillar." `counterThesisLine()` did
`play.thesisHealth?.pillars?.find(p => p.status === "lost" || p.status === "faded")` with no
distinction for pillar kind, and unconditionally pushed `fading pillar **${faded.label}**` into the
same array the "corroborated across N independent reads" weight label is derived from
(`reasons.length >= 2`).

### Evidence

Live TSLA committed position (positionId 60): "Counter-thesis (bear case) — corroborated across 2
independent reads — dealer long-gamma pins rallies · fading pillar Theta budget." The same
envelope's Thesis-health section showed Theta budget was the ONLY non-intact pillar (Δ -3.0 pts,
label "DTE 2 migrate"); Persistence/Entry geometry/Signal stack/Regime fit were all Δ +0.0 — so
"corroborated across 2" combined one genuine market signal (dealer gamma) with one purely
mechanical, direction-agnostic fact (days-to-expiry).

Decisively, this exact distinction — time/DTE-driven signals must NOT be conflated with genuine
thesis-invalidating evidence — is already an established, fixed principle in the SAME FILE:
`sellReasonClause()` (fixed 2026-09-10, live repro NRG) explicitly renders `expiry_risk`/`time_stop`
manage rungs as "— time-based: DTE nearing the lane's theta cliff (**thesis still intact**)"
specifically BECAUSE a generic framing that lets time-decay read as if the thesis broke was found to
be a real, member-misleading bug. `counterThesisLine()` never received the analogous fix.

Added a new test (`play-brief-narrative.test.ts`) building a real `ThesisHealthPayload` via
`computeSwingThesisHealth` with `dte: 2, subLane: "TACTICAL"` (genuinely fades the Theta budget
pillar per `thetaBudgetScore`'s real cliff/migration thresholds) plus exactly one genuine market push
(dealer long-gamma). RED→GREEN, git-stash-verified on the source file alone: 141/142 (the line read
"corroborated across 2 independent reads" instead of "a single, uncorroborated signal") before the
fix, 142/142 after. Broader regression sweep: `play-brief.test.ts` + `play-brief-narrative-coaching.
test.ts` + `thesis-health.test.ts` — 376/376.

### Blast radius

Single function. The fading-pillar fact is still shown in the rendered bullet — only the count the
weight label is derived from changed.

### Fix

Track the fading-pillar reason separately from the directional `reasons[]`: push it into a new
`fadedPillarReason` local instead of `reasons`, still append it to the displayed clauses (`shown`),
but base `weight` (`reasons.length >= 2` ? "corroborated..." : "a single, uncorroborated signal") on
`reasons.length` alone — the directional-only count. Mirrors the same "time-based ≠ directional
corroboration" distinction `sellReasonClause()` already applies, just applied here to the
evidence-weight label instead of the exit-reason label.

### Why not a bigger fix

No change to `thetaBudgetScore()`/`thesis-health.ts` — the pillar fade itself is correct and useful
information, still surfaced in the bullet. No change to the other 9 reason-gathering blocks in
`counterThesisLine()` — they're all genuine market reads and correctly continue to count toward
corroboration.
