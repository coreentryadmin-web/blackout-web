> **kind:** FINDING

## G-17's 75-floor exemption for multi-rail/FLOW commits removed — 65-74 band now needs the prime floor for every origin combo — FIXED

| **Status** | Fixed in PR (fix/g17-extend-floor-multi-rail) |
|---|---|

**Symptom:** Member observed several high-scoring WATCH plays that would have been large winners
(INTC 92P +275%, TSLA 355P +98%, IWM 297P +56%) never promoted to OPEN, alongside a live session
where 3 real losses (SNDK -50.45%, MSFT -52.07%, META -50.44%) all carried the highest-magnitude
Cortex `gex-walls` oppose of anything committed that morning. Investigation of the oppose-magnitude
theory (see the 2026-08-28 cortex-oppose-magnitude finding) did NOT hold up over a 90-day sample —
but investigating the SAME real data for G-17 (single-rail prime-band gate) surfaced a different,
better-supported signal.

**Root cause:** G-17 (`isSingleRailWithoutFlow` + `ZERODTE_SINGLE_RAIL_PRIME_MIN`) only required the
75-score prime floor for single-rail-without-flow (BREAKOUT-only or PIN-only) setups in the 65-74
band. Multi-rail and FLOW-corroborated setups were exempt, on the 2026-08-06 theory that
corroboration itself was sufficient evidence to skip the extra floor.

**Evidence (90-day window, `/api/market/zerodte/record`, 341 graded plays):**

| Population | n | Win rate | Avg P&L |
|---|---|---|---|
| Single-rail (BREAKOUT/PIN only), score ≥75 — the only single-rail population that could commit | 89 | 41.0% | -3.76% |
| Multi-rail/FLOW, score 65-74 — previously exempt from any extra floor | 34 | 35.7% | -10.43% |
| Multi-rail/FLOW, score ≥75 | 29 | 42.3% | -11.6% |

The exempt population (multi-rail/FLOW, 65-74) graded WORSE than the single-rail population G-17
was specifically strict about. The exemption was never buying safety — the whole 65-74 band is weak
EV on its own score, independent of rail composition.

**Fix:** G-17 now requires the 75 floor for EVERY origin combo in the 65-74 band (only scoped to
scores that already clear each origin's own G-3 floor, so it never produces a redundant block
alongside `score_floor` for scores already below 65). Same gate code (`single_rail_corroboration`),
generalized condition. `ZERODTE_SINGLE_RAIL_PRIME_MIN` stays at 75 (unchanged, env-overridable).

**Blast radius:**
- `src/lib/zerodte/gates.ts` — the gate condition + doc comments.
- `src/lib/zerodte/board.ts`, `src/lib/zerodte/pane.ts`, `src/lib/admin-zerodte-funnel.ts` — stale
  "single-rail" labels/comments updated to describe the now-universal 65-74 band floor.
- `src/lib/zerodte/gates.test.ts` — 18 fixtures used the shared `input()` helper's default score
  (70) or explicit scores in [65,75) with no `discovery_origin` set, which is unrealistic for real
  commits but exposed the change's full-verdict impact on tests actually targeting OTHER gates
  (G-3/G-4/G-6 boundaries). Fixed by bumping the shared default to 80 and, for boundary-specific
  tests, asserting the SPECIFIC gate code clears rather than the overall verdict.
- `src/lib/zerodte/gates-replay-2026-07-13.test.ts` — the REAL 2026-07-13 session replay fixture.
  QQQ (real score 65, real winner +76.57%) and META (real score 67, real loser -50.11%) BOTH now
  block via G-17 — the session's "1W/1L" print becomes 0 prints. This is the honest cost side of
  the change: on this one historical day, the tightened floor zeroes out a real winner along with
  the real loser it was extended to catch. The justification is the 90-day AGGREGATE, not a claim
  that every blocked play in this band was already a loser.

**Evidence of correctness:** Full `src/lib/zerodte/*.test.ts` suite: 1188/1188 pass (1 pre-existing
skip). `npx tsc --noEmit` clean. All on Node 20.
