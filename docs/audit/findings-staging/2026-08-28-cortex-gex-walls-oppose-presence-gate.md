> **kind:** FINDING

## Cortex now blocks on a real, live gex-walls oppose below the decisive floor — a measured signal that was sitting unused — FIXED

| **Status** | Fixed in PR (fix/cortex-gex-walls-oppose-presence) |
|---|---|

**Symptom:** Deep-dive into "why are we still getting losses" pulled this week's real graded
record (`GET /api/market/zerodte/record?days=7`, 66 graded plays across 6 sessions): 34.8% win
rate, avg P&L −4.82%. Of 32 losing/losing-adjacent rows, **22 had an active Cortex `gex-walls`
oppose present at commit** — the setup was taken anyway because the net Cortex score still cleared
the PASS floor. Score-decile of losers skewed HIGH (80s/90s/100 = 20 of 32) — nominal setup score
was not protecting against this pattern.

**Root cause:** `docs/audit/INTENTIONAL-DESIGN.md` item #6 (`cortex-oppose-magnitude-ab.mjs`,
341 graded plays, 90-day window, also run 2026-08-28) had already measured this shape and reached
a real, evidenced conclusion: the MAGNITUDE-graduated theory ("bigger oppose = worse") was **NOT
monotonic** (the [0.40,0.60) weight band graded *better* than [0.20,0.40)), but a coarser PRESENCE
finding held cleanly — **any active `gex-walls` oppose in [0.20,0.60) graded 31-43% WR, worse than
the 48.3% WR clean-signal baseline** — independent of whether the net Cortex score stayed
non-negative. That doc explicitly concluded "no gate changed" at the time, framing the open
question narrowly as magnitude-vs-no-change and not considering a presence-based gate.

`assessCortexVerdict` (`cortex-gate.ts`) only ever blocked on the NET score (`< 0` → NET_NEGATIVE)
or on CONTESTED (both sides individually clearing `CONTESTED_MIN_MAGNITUDE = 0.75`). A gex-walls
oppose at 0.2-0.6 is invisible to both checks: too small to trip CONTESTED, and easily outweighed
by supports so the net score stays positive. The measured evidence was sitting unused — this
week's live record independently reproduced the same pattern the 90-day sample found, which is
what crossed the bar for acting on it now (two independent samples agreeing, not one).

**Fix:** New decision `OPPOSE_UNRESOLVED` in `cortex-gate.ts`: when an active `gex-walls` oppose
item (weight ≥ `GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT = 0.2`, the AB script's own lower bucket
boundary) is present AND the net score is below `CONVICTION_A_MIN_SCORE` (the same "decisive floor"
CONTESTED already uses), the commit blocks with `cortex_gex_walls_oppose_unresolved` instead of
silently passing. Mirrors CONTESTED's own philosophy ("below the decisive floor, don't let
unresolved opposition pass silently") at a lower bar, because this specific source is now
evidenced to matter at a lower bar. A setup whose support has already decisively won (score ≥
CONVICTION_A_MIN_SCORE) still PASSes — same as CONTESTED — because residual opposition at that
point is expected noise, not evidence of a real risk.

**Deliberately NOT done:** a full VETO (this is a "grades worse," not "never wins" finding —
31-43% WR is degraded, not zero) or a magnitude-graduated threshold (the AB script's own
conclusion: the pattern is not monotonic, so a magnitude-scaled gate would be fitting noise). Also
did not touch NET_NEGATIVE's existing `score < 0` check — the two are independent and can both
apply to the same score band from different directions.

**Blast radius:**
- `src/lib/zerodte/cortex-gate.ts` — new decision `OPPOSE_UNRESOLVED`, new constant
  `GEX_WALLS_OPPOSE_PRESENCE_MIN_WEIGHT`, new block-rendering branch in `cortexGateBlocks`, module
  doc updated.
- `src/lib/zerodte/board.ts` — `ZeroDteGateFailure` union extended with
  `cortex_gex_walls_oppose_unresolved`.
- `src/lib/zerodte/thesis-health.ts` — `cortexScore`'s decision-to-health-score mapping now
  recognizes the new decision (scores it 0, same as VETO/NET_NEGATIVE/CONTESTED).
- `src/lib/zerodte/pane.ts` — `PaneCortexView`'s decision union + `CORTEX_DECISIONS` set extended
  so the pane doesn't silently drop the new decision to `null`.
- `src/lib/admin-zerodte-funnel.ts` — friendly gate label added.
- `src/lib/zerodte/cortex-gate.test.ts` — 4 new tests: fires at weight ≥ 0.2 below the decisive
  floor; does NOT fire below 0.2 (never measured that small); does NOT fire once score clears the
  decisive floor; does NOT generalize to a same-weight oppose from a different source (the
  evidence is gex-walls-specific).

**Evidence of correctness:** `src/lib/zerodte/*.test.ts` + `src/lib/zerodte/thesis/*.test.ts` +
`src/lib/nighthawk/cortex/*.test.ts` + `src/lib/admin-zerodte-funnel.test.ts`: 1279/1279 pass (1
pre-existing skip). `npx tsc --noEmit` clean. Node 20.
