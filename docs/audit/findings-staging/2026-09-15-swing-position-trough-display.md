> **kind:** FINDING

## Position section showed a live position's best excursion (Peak) but silently dropped its worst (Trough), even though both are fully computed on every row — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `troughDisplay` (`src/features/nighthawk/command-deck/adapters.ts:475-480`) — the
position's worst excursion, computed **symmetrically alongside `peakDisplay`** two lines above
(469-474), condor-aware (sign-flipped for a credit condor's seller P&L, identical to how `peak` is
handled) — is threaded onto every `TerminalPlay` row as `play.trough` (`types.ts:137`, sibling field
to `peak`). But `pnlSection` (`src/lib/swing/play-brief.ts`, the Position section builder) only ever
read `play.peak` (`Peak: **${fmtPct(play.peak)}**`). Grepped the whole `src/lib/swing/` tree for
`.trough` outside test files and `adapters.ts` itself: zero consumers. The field was fully computed
and threaded on every live and closed row, then silently dropped before ever reaching the rendered
brief.

**Live evidence (2026-09-14/15, real committed swing position, SWING:CRWD positionId 19):**
`troughPremium $7.13` at the position's low (**-57.2%** from the $16.65 entry) before it rallied to
`peakPremium $43.5` (**+161.3%**). A trader reading this brief's Position section right now sees
only `"Peak: +161.3%"` — no way to know from the brief that this same position was down 57% before
it worked. This is conviction-relevant history a trade manager would want to cite ("this one tested
you early, don't flinch on the next drawdown scare"), and the data already existed on the object —
this was a rendering gap, not a missing computation.

**Fix:** added one line to `pnlSection`, immediately after Peak: `` `Trough: **${fmtPct(play.trough)}**` ``
— same `fmtPct` helper (renders `"—"` on null, never fabricates a value), same unconditional-render
convention Peak already uses (both fields are always computed together in `adapters.ts` and are
null together exactly when entry/premium data is missing, so the two lines stay symmetric).

**Fix rationale:** zero new data plumbing required — the field was already computed and already on
the `TerminalPlay` object; this only wires an existing, already-correct computation into the one
place a trader actually reads it. Mirrored Peak's own render pattern exactly (same helper, same
unconditional inclusion, same styling) rather than inventing a new convention or gating condition.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed both new regression tests — one
asserting Trough renders alongside Peak off the real CRWD repro shape, one asserting a null trough
renders the honest `"—"` rather than being fabricated or omitted — fail against pre-fix code with no
"Trough" line at all; restored and confirmed both pass green). Full `src/lib/swing/*.test.ts` suite
(1144 tests, up from 1142) green, `tsc --noEmit` and `eslint` clean on both changed files.
