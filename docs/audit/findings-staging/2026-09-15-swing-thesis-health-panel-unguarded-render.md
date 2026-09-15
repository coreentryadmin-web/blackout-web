> **kind:** FINDING

## A second, un-gated UI consumer still rendered Ask Largo's fabricated-precision thesis-health panel for Banger-origin swing positions after PR #5027's fix — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**What was broken:** live-verified against `https://blackouttrades.com/nighthawk?view=swings&ticker=RBLU`
(a real Banger-origin SWING position), AFTER PR #5027 (merged, deployed, confirmed live — the
`ECR push (production)` workflow's `Roll ECS production web` step completed successfully) fixed
`thesisHealthUncalibrated()` to correctly flag Banger-origin rows as uncalibrated: the page's top
"THESIS STRENGTH" figure correctly stopped showing the fabricated 80 (now falls back to the honest
play score, 68 — `terminal-display.ts`'s `thesisStrengthPct` reads the fixed guard). But a SEPARATE
widget lower on the same page — the "Swing thesis health" section rendered by
`ZeroDteCommandPanel.tsx` via `SwingThesisHealthPanel` — still rendered the full byte-identical
fabricated breakdown (MINOR rung, 80, ENTRY 83 → CURRENT 80, Δ -3, per-pillar rows including
`"Regime fit: BREAKOUT · BANGER"` verbatim). PR #5027 fixed the DATA gate
(`thesisHealthUncalibrated`) but this render site never checked it.

**Root cause:** `ZeroDteCommandPanel.tsx:402`'s section gate was `{play.thesisHealth && (...)}` —
testing only whether `play.thesisHealth` is non-null, never whether it's calibrated. Every OTHER
consumer of `play.thesisHealth` on this same page already applies the guard:
`terminal-display.ts`'s own (private, now exported) `healthIsCalibrated` helper for
`thesisStrengthPct`, and `adapters.ts:204`'s inline check for the Management/Verdict recNote
overlay. This was the one remaining render site nobody had pointed the same guard at — found only
by re-screenshotting production AFTER PR #5027 deployed, not from a code read alone (the JSON
envelope and the play-brief text were both already correct; only this specific React component was
still wrong).

**Blast radius:** every Banger-origin SWING position that reaches OPEN/HOLD/TRIM status (same
population PR #5027 covered) — the raw fabricated pillar breakdown was visible in this one specific
panel on `/nighthawk?view=swings`, distinct from (and in addition to) the Ask Largo play-brief text
PR #5027 already fixed.

**What changed:** exported `healthIsCalibrated` from `terminal-display.ts` (was already the
correctly-scoped SWING-only check every other consumer on this page uses) and added it to this
render site's gate: `{play.thesisHealth && healthIsCalibrated(play) && (...)}`. Zero new logic —
reuses the exact same helper, scoped identically, so 0DTE's `ThesisHealthPanel` (always calibrated)
is provably unaffected.

**Test:** RED→GREEN proven (`git stash` on the two source files): the new
`"never renders SwingThesisHealthPanel for a Banger-origin uncalibrated payload"` test — a real
React SSR render (`renderToStaticMarkup`) with the exact Banger fingerprint
(`regime` pillar `currentLabel: "BREAKOUT · BANGER"`) — fails pre-fix (the fabricated markup is
present verbatim in the rendered HTML) and passes post-fix. A companion positive test proves a
genuinely calibrated SWING position still renders the panel (no over-suppression). Full
`src/lib/swing/*.test.ts` + `src/features/nighthawk/command-deck/*.test.ts` (1590 tests, unchanged
total post-merge-in — new tests offset by none removed) green on Node 20 with
`--experimental-test-module-mocks`, `tsc --noEmit` clean.

**Process note:** this is exactly why the standing mandate's live-UI re-verification after a deploy
matters — the JSON/data-layer fix (PR #5027) was correct and fully tested, but a second render site
existed that a pure code review of `thesis-health.ts`'s consumers (via `grep -rn
thesisHealthUncalibrated`) DID find at the time (`terminal-display.ts`, `adapters.ts`,
`play-brief*.ts` were all confirmed gated) — this one slipped through because
`ZeroDteCommandPanel.tsx` reads `play.thesisHealth` directly rather than calling
`thesisHealthUncalibrated` itself, so the earlier grep for the guard's own call sites correctly
found every place that DID call it, but couldn't surface a place that SHOULD have and didn't. Only a
real post-deploy screenshot caught it.
