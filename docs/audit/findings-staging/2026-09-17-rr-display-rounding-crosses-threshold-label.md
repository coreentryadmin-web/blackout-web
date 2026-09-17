# R:R display rounds up across its own quality-label/color threshold — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Component** | `src/features/nighthawk/command-deck/{PlayTerminal.tsx, ZeroDteCommandPanel.tsx, LegacyPlayDetailPanel.tsx}` |
| **Severity** | P3 — member-visible display self-contradiction, no financial/data impact |
| **Found by** | Cross-lane handoff from the Night Hawk Legacy lane (logged 2026-09-11 in this file's `docs/audit/nighthawk-0dte-live-journal.json` `open_findings`, id `2026-09-11-0dte-rr-preentry-display-rounding-boundary`), picked up and applied by the 0DTE lane. |

### Root cause

Five places in the Night Hawk command-deck render a play's Risk:Reward ratio as
`{rr.toFixed(1)}:1`, and four of them additionally derive a quality label or a color class from
the SAME raw, unrounded `rr` against threshold ladders at 0.5 / 1 / 2. `toFixed(1)` rounds
to-nearest, so a value just under a threshold (e.g. `rr = 0.96`) displays as the threshold itself
("1.0") while the label/color still reads the lower bucket computed from the true `0.96` — e.g.
"1.0:1 (acceptable)" printed beside a ladder where 1.0 is the "favorable" cutoff, or a neutral
(non-green) color next to a displayed "2.0" that visually implies the ">= 2 strong" bucket. A
member reading the printed number against the very ladder the label/color uses sees an apparent
contradiction between the number and its own classification.

The exact same shape was already fixed once, in a different file, for a different (but adjacent)
purpose: `src/features/nighthawk/lib/deterministic-edition.ts`'s Legacy thesis-text R:R line
(PR #4813, merged) replaced `rr.toFixed(1)` with a floor-based display value. The Legacy lane's
2026-09-11 blast-radius grep (done immediately after shipping that fix, looking for other
`toFixed(1)` + threshold-ladder pairs) found `PlayTerminal.tsx:876`'s `ZeroDtePreEntryContext` as
an identical-shaped instance and logged it as a cross-lane handoff for the 0DTE lane, since it sits
on 0DTE command-deck surface outside that session's mandate.

**Root-causing the handoff surfaced a wider blast radius than the one call site named.** Grepping
this repo for every `rrRatio` display call site (not just the one named in the handoff) found FIVE
total occurrences of the same `toFixed(1)` + raw-`rr`-threshold pattern:

1. `PlayTerminal.tsx:580` (`ThesisPanel`'s `commitSnapshot` — color only, no text label)
2. `PlayTerminal.tsx:892` (`ZeroDtePreEntryContext` inside `PnlPanel` — the one named in the
   handoff; has the full `(strong)/(favorable)/(acceptable)/(tight)` text ladder)
3. `PlayTerminal.tsx:974` (Legacy `PnlPanel`'s "R:R" row — color only)
4. `ZeroDteCommandPanel.tsx:368` (the actual live 0DTE render path — `commandSinglePanel` routes
   every `horizon === "ZERO_DTE"` play here, bypassing `ThesisPanel`/`ZeroDtePreEntryContext`
   entirely, so THIS is the one real members see on a 0DTE play's Risk:Reward row, not the one the
   handoff named; color only, no text label)
5. `LegacyPlayDetailPanel.tsx:170` (Legacy single-panel v2's "Risk : reward" row — has the
   `(strong)/(favorable)/(tight)` text ladder, same contradiction shape as #2)

All five share the identical root cause and are fixed identically here — this is a single
mechanical class of bug, not five independent ones.

### Why `ZeroDtePreEntryContext` (the handoff's named location) is currently unreachable for 0DTE

Traced while writing the regression test: `PlayTerminal`'s top-level render computes
`commandSinglePanel = play.horizon === "ZERO_DTE" || play.horizon === "SWING"` and, when true,
renders `ZeroDteCommandPanel` directly — the tabbed `ThesisPanel`/`ManagePanel`/`PnlPanel` layout
(and therefore `ZeroDtePreEntryContext`, which lives inside `PnlPanel`) is only reached for a
horizon that is neither `ZERO_DTE`, `SWING`, nor `LEGACY` — i.e. only `LEAPS` today. The function's
own name/comment ("Pre-entry context for 0DTE plays") is now stale relative to the current render
tree; the fix applied there is still correct and shipped (harmless either way — it corrects the
component for whichever horizon does reach it), but the actually-live 0DTE-member-facing instance
of this bug was `ZeroDteCommandPanel.tsx:368` (#4 above), found only by grepping for every
`rrRatio` call site rather than trusting the handoff's single named line. Not fixing the horizon
routing itself here — out of scope for a display-rounding fix and not what was reported.

### Fix

All five sites now compute a floored display value before formatting instead of rounding
to-nearest: `(Math.floor(rr * 10 + 1e-9) / 10).toFixed(1)}:1` — copied verbatim from the already-
shipped `deterministic-edition.ts` pattern (same epsilon, same rationale: a floored display can
never read at-or-above a threshold the true `rr` hasn't reached, and the epsilon guards a clean
multiple of 0.1 from landing on the wrong side of `Math.floor` due to binary floating-point
representation). The label/color logic itself is untouched everywhere — it already read the raw,
correct `rr`; only the printed number was wrong.

### Fix rationale

Reused the exact proven pattern from PR #4813 rather than inventing a new one, per this repo's own
existing precedent for the same bug shape in a sibling file. Considered fixing only the one named
handoff location, but the repo's PR write-up policy explicitly requires finding and fixing every
call site sharing the same root cause ("duplicated logic in a second file counts") — a targeted
grep found four more, including the one location (`ZeroDteCommandPanel.tsx`) that is actually the
live 0DTE path, so fixing only the handoff's named (but currently unreachable) location would have
shipped a no-op for the population that matters.

### Tests

`src/features/nighthawk/command-deck/PlayTerminal.ssr.test.ts`: 3 new tests.
- `"Thesis tab: R:R display floors instead of rounding — 1.96 must NOT display as the 2.0
  threshold it hasn't reached"` — exercises `ZeroDteCommandPanel.tsx`'s live 0DTE render path
  (confirmed via manual SSR trace during development, not by the pre-existing test's misleading
  name).
- `"pre-entry (not-yet-committed), PnL tab: ..."` ×2 (0.96/acceptable and 1.96/favorable boundary
  cases) — exercise `ZeroDtePreEntryContext` via `horizon: "LEAPS"` + the `initialTab: "pnl"` SSR
  test-only escape hatch (the only fixture shape that reaches this component under
  `renderToStaticMarkup`, which has no click simulation).

All three confirmed FAILING pre-fix (`git stash` isolating the three component files from the
test file) and PASSING post-fix. Full `src/features/nighthawk/command-deck/*.test.ts` +
`*.ssr.test.ts` suite: 431/431 pass. `npx tsc --noEmit`: clean. All on Node 20.20.2.

### Blast radius

No other consumer of `rrRatio` exists outside these five render call sites (confirmed via
repo-wide grep). No data/grading logic touched — this is purely a display-formatting fix; the
underlying `rrRatio` value, its color threshold, and its text-label threshold are all unchanged.

---
_Generated by [Claude Code](https://claude.com/claude-code)_
