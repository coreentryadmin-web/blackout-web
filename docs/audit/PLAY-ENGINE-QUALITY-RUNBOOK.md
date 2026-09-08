# PLAY-ENGINE-QUALITY-RUNBOOK — how to check, validate, and improve the 4 play engines

Written 2026-09-04 during a live-market deep-dive requested by the operator: *"check each and
every play coming on all these boards .. see how good they are .. we planned to get 100-500%
winning plays on 0dte board after all our changes .. see if thats happening and how we can
improve the engines."* This doc is the reusable method + the concrete findings from that
session, so a future session (or a market-open validation pass) doesn't have to re-derive the
same queries from scratch.

The 4 boards in scope: **SPX Slayer** (`/terminal`, `/api/market/spx/desk`), **Legacy** (Night
Hawk's next-day digest, `/api/market/nighthawk/legacy-marks` + `/edition`), **Night Hawk 0DTE**
(`/nighthawk`, `/api/market/zerodte/board` + `/record`), **Vector** (`/vector`,
`/api/market/vector/universe` + `/api/market/gex-heatmap`).

## 1. How to check play QUALITY (not just health)

A 200 status and non-null data prove the pipe works. They prove nothing about whether the plays
are actually good. Use this instead:

```bash
# Authenticated read against the /record endpoint (90-day window is enough sample size)
GET /api/market/zerodte/record?days=90
```

Pull the **per-play array** (`r.plays`), not just the top-level aggregate — the aggregate hides
the distribution. For each play, the useful fields are `plan_outcome`/`plan_pnl_pct` (mechanical
mid-price grade), `managed_outcome`/`managed_pnl_pct` (as-actually-managed), and
`entry_context.exit` (`{at, mark, detail, reason, pnl_pct, peak_pnl_pct, mark_observed}` — this is
where the real story is: **`peak_pnl_pct` vs `pnl_pct`** shows how much of the play's actual
in-flight gain was captured vs given back).

Concrete queries that matter:
- **Win-rate / avg P&L, overall and by `by_outcome`/`by_score_band`/`by_direction`** — already on
  the `/record` response, no extra work needed.
- **Distribution of realized P&L** — bucket `plan_pnl_pct`/`managed_pnl_pct` across all graded
  plays. If the user's target is "100-500% winners," count how many plays actually land in that
  band. (Measured 2026-09-04, 90-day window, 372 plays: **0 plays exceeded 100%, only 4.7% hit
  exactly 100%** — see finding #1 below for why "exactly 100%" is a tell, not a coincidence.)
- **Forgone-gain audit** — group by `entry_context.exit.reason` and compare `peak_pnl_pct` to the
  realized `pnl_pct` for each reason. A reason where peak is consistently high but realized is
  consistently ~0 is a real, quantifiable value leak (see finding #2).
- **Live board right now** — `/api/market/spx/desk`, `/api/market/zerodte/board` for open plays;
  cross-check `score == sum(factors[].weight)`, `direction` matches net signed weight, no NaN.

Reusable script from this session: `/tmp/.../scratchpad/play-quality-deep.mjs` (not committed —
recreate from this doc if the scratchpad is gone; it's ~100 lines, straightforward fetch+reduce
against `mintClerkPremiumSession`). Consider committing a cleaned-up version as
`scripts/audit/zerodte-play-quality.mjs` if this becomes a recurring check (it isn't yet).

## 2. Findings from the 2026-09-04 pass

### Finding #1 — the mechanical "doubled" grade hard-caps every winner at exactly +100%
`gradePlanFromBars` (`src/lib/zerodte/plan.ts` ~line 450) sets `target = entryPremium * (1 +
targetPct/100)` with `targetPct` defaulting to 100, and exits the INSTANT price touches it. This
is why the entire 90-day sample's `plan_pnl_pct` never exceeds 100% — it structurally cannot,
under this grading lane. This does not mean the LIVE board never lets a play run past 2x (the
`trim_scale` runner third can, per `entry_context.exit` on a `trim_scale_runner_target`/
`runner_close` exit) — but the MECHANICAL grade used for the headline win-rate/avg-P&L never
reflects it. If "100-500% winners" is meant literally, check `managed_pnl_pct` and
`entry_context.exit.peak_pnl_pct` on `runner_close` exits specifically, not the aggregate
`avg_pnl_pct`, which is dominated by the capped mechanical lane.

### Finding #2 (the big one) — a documented "dead zone" between the protective floor and the trim ladder is erasing real winners
Measured 2026-09-04, 90-day window, 372 graded plays:
- **37 plays (9.9%) exited via `ratchet_breakeven_floor`** after peaking at **+20% to +48.56%**
  (median +26.67%) — **all 37 were closed at ~0%**, the entire peak gain given back.
- Two concrete examples from 2026-09-03: `BULL` peaked +20.45% → closed 0%; `CLS` peaked +31.18%
  → closed 0%.

Root cause (`src/lib/zerodte/exit-engine.ts`, `decideTrimScale` ~line 290-425 and
`ratchetFloorPct` ~line 184): under the shipped `trim_scale` exit mode (A/B tier default per
`resolveExitModeForTier` in `exit-sync.ts`), TWO independent threshold tables govern a play —
- the shared protective floor arms breakeven (floor=0%) at a **fixed peak ≥ 20%** across all
  regimes (`EXIT_RULES.ratchet_arm_pnl_pct`);
- the trim-tranche ladder arms its FIRST profit-bank at a **regime-conditioned** peak — the
  `trend` regime's first tranche doesn't arm until **+40%**.

Anything peaking in the resulting **20–39% gap** (widest in the `trend` regime) has the
breakeven floor already armed but nothing banked yet to protect instead, so the floor dumps the
WHOLE position. The code comment explicitly calls this "not a bug," a small accepted residual —
the 2026-09-04 measurement shows it is **not small**: ~1 in 10 graded plays, averaging ~27% of
peak gain erased to zero.

This is exactly the shape `docs/audit/0DTE-RESEARCH.md`'s "E5" section already diagnosed at the
strategy level ("the ratchet buys win-rate, not EV — a textbook green≠profitable result") but
that section's own fixes (trim_scale itself, graduated for A/B tier) did not close this specific
sub-gap. **A regime-conditioned backtest to measure/fix this dead zone was scoped as the next
concrete step in that doc and had never been built** before this session — see the companion
task this doc's write-up is paired with (check `docs/audit/findings-staging/` and open/merged
PRs dated 2026-09-04 for the outcome: either a shipped fix with a regression test, or a
measured-and-documented "inconclusive, don't touch" result, per the same evidence bar as the
existing `tier-exit-mode-ab.mjs`/`cortex-oppose-magnitude-ab.mjs` measurements).

## 3. What "improve the engine" should mean here — and what it should NOT mean

- **Do** measure before changing anything (this repo's standing discipline, CLAUDE.md's
  performance-mandate section generalizes cleanly to strategy tuning: a low average with a
  high-variance tail is a different problem than a uniformly-bad one, and the fix looks
  different).
- **Do** reuse the existing mark-faithful backtest pattern (`tier-exit-mode-ab.mjs`,
  `zerodte-sim.mjs`'s `gradeThroughExitEngine`) — it replays REAL historical contracts through
  the SAME shipped exit-decision function, so a backtest result can't silently drift from what
  the board actually does.
- **Do not** flip a live risk-management default (exit mode, floor threshold, tier routing) on a
  single ambiguous sample — the existing "HOLD vs ratchet" study in 0DTE-RESEARCH.md found the
  calibration window and the out-of-sample window disagreed on the OPTIMAL config even though
  they agreed on the DIRECTION, and correctly left the live gate untouched pending a
  regime-conditioned sweep. The dead-zone gap above is a much narrower, more mechanical
  question (are two threshold tables miscoordinated?) than "which whole strategy is better,"
  so it's more tractable — but the same discipline applies: don't ship a change that isn't
  robust across regime/date splits.
- **Do not** conflate "more 100%+ winners" with "better EV." A change that lets more plays touch
  +100%+ by loosening the protective floor could also let more plays round-trip to a real loss
  that the floor currently prevents. Report win-rate AND avg-P&L together, always, for any
  candidate change — win-rate alone is the exact trap the E5 study already documents ("the
  ratchet buys win-rate, not EV").

## 4. Live-UI checklist (visual, not just API)

Data correctness and rendered correctness are different failure classes — a correct API response
can still render with a clipped column, a stale-looking timestamp, or a broken chart on a given
viewport. Use `proxy-browser.cjs` (see `docs/audit/LIVE-UI-CONNECTION.md`) against:
- `/nighthawk` (Night Hawk 0DTE board) — look for: play cards rendering with real numbers (not
  "—"/NaN), exit-status badges matching the API's `plan_outcome`/`managed_outcome`, no console
  errors, no horizontal overflow at 1440px and at a mobile viewport.
- `/vector` — GEX heatmap painting, wall markers at plausible strikes relative to spot, contract
  picks panel not stuck on a stale ticker.
- `/terminal` (SPX Slayer) — score/factor breakdown visible and internally consistent with the
  API, gate-block reasons human-readable.
- `/heatmap` — Matrix + Depth tabs both load (Depth requires Matrix first, a known harness
  gotcha, not a product bug).

Screenshot outputs from the 2026-09-04 pass (if still present): scratchpad `ui-shots/*.png` —
these are NOT committed anywhere; re-run if a future session needs current screenshots.

**2026-09-04 live-UI pass results (RTH, ~9:35-9:40 AM ET, market just opened):** all 4 pages
render correctly at desktop 1440px — `/nighthawk` (session analytics header matches the API:
WIN 34.6% / -3.7% AVG), `/vector` (GEX matrix, wall chart, live Helix tape, Suggested Play card
all populated with real numbers), `/terminal`, `/heatmap` (thermal state, king node/flip/walls,
net-flow column all populated). No visual defects found. Two gotchas hit during capture, both
confirmed harness noise, not product bugs: (1) a first `/vector` capture landed mid-load ("no
SPX session bars yet") — pure timing, a clean re-capture a minute later rendered fully; (2) two
API calls (`vector/walls`, `vector/contract-picks`) timed out inside the Chromium tunnel — direct
`fetch` against the same endpoints outside the tunnel returned in 1.5s and 88ms respectively, so
this was proxy-tunnel contention under the browser's own concurrent request load, not backend
latency. Lesson for next time: **always give proxy-browser.cjs a `--wait` of 8s+ and treat a
single capture's timeout warnings as inconclusive until confirmed by a direct API timing check**,
consistent with CLAUDE.md's own "a check seconds after a deploy proves nothing" caution.

## 5. Next concrete steps (unblocked, ready to pick up)

1. **Close or formally park the dead-zone finding** (Finding #2) — see whatever PR/finding file
   resulted from the backtest task paired with this doc.
2. **Re-run the play-quality distribution check periodically** (weekly, or after any exit-engine
   change) — the query in §1 is cheap (one authenticated GET + a reduce) and is the single most
   direct answer to "is this actually working" for the operator's stated goal.
3. **If Finding #2 ships a fix**, add a market-open validation entry (per CLAUDE.md's
   `MARKET-OPEN-VALIDATION.md` convention) naming the specific thing to check next session: do
   trend-regime plays that peak 20-39% now bank a partial trim instead of round-tripping to
   breakeven.
4. **Runner-target reach** (Finding #1) — if there's appetite to actually see plays clear 200%+,
   that requires either raising `PLAN_RULES.target_pct` past 100 (mechanical grade) or checking
   whether the `trim_scale` runner third is EVER actually let run that far live (a "does the
   runner-third's own distribution reach past 100%" measurement, separate from this session's
   scope) — flagged here, not yet investigated.
