> **kind:** FINDING

## 0DTE G-18 (`early_window_prime_score`) is forgoing winners at a ~71% rate over a real 30-45 day window — needs an operator/product decision, not a unilateral fix

| | |
|---|---|
| **Status** | OPEN — holding per the standing escalation policy for a gate change with real capital-risk impact ("ambiguous/live-picks-logic → report, hold"). This changes what commits in the [10:00, 10:45) ET window; it should not be resolved by flipping a hard gate without a fresh, targeted decision. |
| **Lane** | Night Hawk 0DTE (Ask 0DTE deep-dive, 2026-09-16, operator directive: "only focus on 0dte... fix up all shit") |
| **Severity** | P2 (a hard-block gate appears to be materially miscalibrated against its own stated rationale — real forgone EV, not a crash) |
| **File** | `src/lib/zerodte/gates.ts` (G-18, `early_window_prime_score`), measured via `scripts/audit/g18-g19-counterfactual.mjs` (already-shipped tool, BO-P1-0004, never previously run live during RTH per its own staged-finding status) |

### Root cause / what's measured

G-18 unconditionally rejects every non-condor FLOW/BREAKOUT/PIN setup scoring below 75 inside the
`[10:00, 10:45) ET` window — no corroboration or Vector-alignment exemption (deliberately removed
2026-09-09, operator-approved CTO gate-architecture review). The gate's own code comment states the
rationale: *"the early window is the SPECIFIC replay-measured worst-timed slice of the session"* —
i.e., sub-75 scores in this window are assumed to be clearly negative EV.

Running the already-built, never-previously-executed-live counterfactual tool
(`npm run counterfactual:0dte-g18-g19`, which calls the real production
`POST /api/market/zerodte/calibration?grade_skips=1` skip-grading endpoint —
`src/lib/zerodte/skip-grading.ts`, the same `gradePlanFromBars` grader used everywhere else in this
codebase, not a reimplementation) against live production data:

- **14-day window (2026-09-02 → 2026-09-16): n=6 graded, 5 would_have_won (83.3%).**
- **30-day window (2026-08-17 → 2026-09-16): n=14 graded, 10 would_have_won (71.4%).**
- **45-day window: identical n=14/10 (71.4%)** — the skip-grading backfill scans a fixed 200-row
  cap, so 30d and 45d hit the same underlying population; 30 days is effectively the full currently
  reachable sample, not an artifact of a narrow window.

The tool's own built-in interpretation (`interpretGate` in `g18-g19-counterfactual.mjs`) fires
`REVIEW — gate may be forgoing too many winners in early window` for any rate above 55%; both runs
clear that bar by a wide margin, and n=14 clears the codebase's own `LOW_N_THRESHOLD` (5) for a
"not low_n" reading.

### Why this isn't a simple flip

This is the SAME shape as the Legacy fillability finding held OPEN in this directory
(2026-09-13): a real, well-measured, evidence-backed signal that a gate might be wrong — but:
1. The gate's unconditional design was a **deliberate, recent (2026-09-09), CTO-approved decision**
   that specifically REMOVED a prior Vector-alignment exemption, because that exemption "was never
   itself measured as curing the early-window effect." Reintroducing any exemption without fresh,
   targeted evidence about what actually distinguishes these winners would risk repeating the same
   mistake in reverse.
2. **No per-candidate detail is currently retrievable** to design a smart, narrow fix. The
   `calibration` route's `blockedValueLines()` (`calibration.ts`) only returns aggregated
   `BlockedValueLine` counts (n / would_have_won / rate), not the underlying tickers, scores,
   corroboration, or origin of the 14 graded candidates — there is no admin export route for
   `zerodte_scan_rejections` counterfactual rows (checked: no route under `src/app/api/admin`
   references skip-grading or scan-rejections), and raw Postgres is blocked from this sandbox.
   Without knowing WHY these 10 winners won (score band, origin, corroboration, market regime),
   loosening the gate blindly is exactly the kind of unilateral, ungrounded change this repo's
   issue-handling discipline warns against.
3. n=14 is real and clears `LOW_N_THRESHOLD`, but is still well below the ~30 this codebase treats
   as a comfortable bar for other gate-calibration decisions in `0DTE-RESEARCH.md` — worth
   re-checking as the reachable population grows (the 200-row scan cap means this needs either a
   wider skip-grading fetch or more elapsed trading days, not just a wider `--days` flag).

### Recommended next step (not yet built)

Build a small admin export route (mirroring `tier-export.ts`'s pattern) that surfaces the raw
`zerodte_scan_rejections` counterfactual rows for `gate_failed='early_window_prime_score'` with
their frozen score/origin/corroboration context, so any future fix can target the SPECIFIC shape
of setup this gate is wrongly rejecting (e.g., "only exempt triple-confluence BREAKOUT setups,"
mirroring G-17's own three-band conditional-admission restructure) rather than a blanket
loosen/revert. Flagging for the 0DTE-owning lane / operator decision; re-run
`npm run counterfactual:0dte-g18-g19 --days=30` as the population grows.

### Evidence

```
window: 2026-08-17 .. 2026-09-16 (30d)
skip-grade backfill: scanned=200 graded=183 ungradeable=17

G-18 — early_window_prime_score (sub-prime in [10:00, 10:45) ET)
graded: 14  ungradeable: 0  would_have_won: 10
false-block rate (would-have-won %): 71.4
→ REVIEW — gate may be forgoing too many winners in early window.
```

No gate changed by this finding. G-19 (`score_top_band`) remains INSUFFICIENT_DATA — consistent
with it having been downgraded from a hard block to non-blocking telemetry on 2026-09-09 (same PR
that restructured G-17), so it no longer produces gradeable "blocked" counterfactual rows at all.
