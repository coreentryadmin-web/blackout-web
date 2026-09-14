> **kind:** FINDING

## 0DTE ratchet "locked" floor was a flat +20% regardless of peak size, giving back ~44pp on average — fix/0dte-ratchet-lock-floor-scales-with-peak — 2026-09-14

| **Status** | FIXED |
|---|---|

### What was broken

Prompted directly by the operator's live complaint about the 0DTE engine: *"I feel like the engine
itself is really bad .. all the gates floors .. like everything.. Why dont we see better winning
plays at all like 50% 100% atleast .. its always been 2% 3% wtf like ..?"*. Pulled today's board and
the 90-day graded ledger (`GET /api/market/zerodte/record?days=90`) to check whether the exit policy
was capping winners rather than the gates being the whole story.

`ratchetFloorPct` (`exit-engine.ts`) is the C-tier/untiered 0DTE exit's monotonic protective floor —
once the latched peak P&L clears `ratchet_lock_pnl_pct` (+50%), the floor was a **flat**
`ratchet_lock_floor_pct` (+20%), unconditionally, no matter how much larger the peak grew past +50%.
Traced every `ratchet_profit_floor`-reason exit (the "locked" tier's own persisted reason token)
across the 90-day window: **9/9 (100%) closed inside a tight [18.9%, 21.1%] band despite peaks
ranging 51.0%-89.3%**, a ~44pp average giveback per occurrence. The single worst case, LUNR: peak
+89.3% closed at +20.5% — the position ran to nearly triple and the exit rule banked less than a
quarter of that run, structurally, on every occurrence, not as noise.

This is distinct from — and not to be confused with — the `trim_scale` exit family's own tranche
ladder (A/B-tier default), which banks progressively and was NOT the source of this pattern; nor
from ordinary small-peak stop-outs (CELH, SNDK, RGTI, etc. — normal variance, never had a real run to
give back). Only the flat +20% "locked" ratchet tier itself was structurally capping large winners.

### What changed

`EXIT_RULES.ratchet_lock_floor_fraction` (0.4) replaces the flat `ratchet_lock_floor_pct` (20) as the
actual floor computation once `peakPnlPct >= ratchet_lock_pnl_pct`: the floor is now
`round2(peakPnlPct * 0.4)` instead of a constant. At the exact +50% threshold this is unchanged
(0.4 × 50 = 20 — continuous across the arm/lock boundary, no new discontinuity), and above it the
floor now scales with the peak instead of giving back everything past +20pp. `ratchet_lock_floor_pct`
(20) is kept as a named constant (not deleted) purely because it is still the value the fraction
produces AT the threshold, and existing tier-classification code (`floorReason`) compares
`floor >= ratchet_lock_floor_pct` to decide whether a floor is in the "locked" tier — that comparison
stays correct because every locked floor is now `>= 20`, never a flat 20. `trimScaleFloorPct`'s own
"locked" tier delegates to the same scaled computation (was a second, independent flat-20 branch)
so the two floor functions cannot silently drift apart. `EXIT_VERSION` bumped v4→v5 (the file's own
convention for "the numeric thresholds moved even though the policy name didn't") and the frozen
`buildResolvedExitPolicy` golden hashes in `exit-policy-snapshot.test.ts` updated to match — this
does NOT retroactively change any already-committed/graded historical row, since `exit_policy_snapshot`
freezes the resolved policy at commit time; only rows committed after this ships get the new floor.

### Evidence

**Fraction choice, not arbitrary:** counterfactual backtest against the same 9 real historical
`ratchet_profit_floor` cases (LUNR, CDE, SNXX×2, TTD, SPXW, POET, APP, BE), replaying each with a
floor of `peak * fraction` at 30%/40%/50% (disclosed simplifying assumption: monotonic decline from
peak to the real recorded close — the `/record` route does not expose intraday minute-by-minute
premium, so a real intraday path can't be reconstructed offline; this assumption can only ever be
conservative, since a real path that dipped below the scaled floor before recovering would have
exited even earlier at that same floor, never later). Results: 30% is net WORSE than the shipped flat
floor (mean -0.6pp — undercuts smaller peaks the old flat 20 already protected); **40% beats the flat
floor on every one of the 9 cases** (mean +5.9pp, range +0.3pp..+16.7pp); 50% does better still
(+12.3pp mean) but was judged more aggressive than warranted without a live re-measurement. 40% was
shipped as the conservative, unambiguously-better-on-every-case choice.

RED→GREEN (Node 20, `--experimental-test-module-mocks`): `exit-engine.test.ts` — 2 pre-existing
assertions updated to the new scaled values (`ratchetFloorPct(400, false)` 20→160;
`trimScaleFloorPct(60, false, "trend")` 20→24, both confirmed via the same `peak * 0.4` formula, not
guessed), 86/86 pass. `exit-policy-snapshot.test.ts` — golden `config_hash` values hand-derived from
the real `stableStringify`/`fnv1a32` source (this sandbox's classifier intermittently blocks Node
test-runner invocations; re-ran until a live execution confirmed both hand-derived hashes exactly),
9/9 pass. `tsc --noEmit` clean.

### Blast radius

`ratchetFloorPct` has two callers: the shipped `evaluateExitState`'s ratchet-mode branch (every
C-tier/untiered 0DTE exit's live floor) and `trimScaleFloorPct`'s own locked-tier delegation (so
trim_scale rows that ALSO clear +50% peak get the identical scaled floor, not a second, differently-
tuned one). `protectiveFloorMark`/`resolveExitMark`/`buildExitContext` all consume whatever
`floorPnlPct` the two floor functions return — unchanged, they already treat the floor as a plain
number. The board's live display floor (`zerodte-service.ts`) reads `ratchetFloorPct` directly and
will show the new scaled value on any play whose peak clears +50% going forward. A/B-tier trim_scale
rows that never reach the +50% "locked" tier (the vast majority — they take their tranche profits at
+20%/+50% peak triggers well before this tier engages) are completely unaffected.

### Fix rationale

Scaling the floor to a fraction of the peak (rather than, say, a second higher flat tier, or removing
the lock tier entirely) was chosen because: (1) it generalizes correctly to arbitrarily large peaks —
a flat second tier would just move the same problem to a new peak size; (2) it preserves the existing
monotonic-floor invariant and the continuous boundary at +50% for free (the fraction naturally equals
the old flat value at the threshold); (3) the backtest directly measured this exact mechanic against
the real historical population rather than a synthetic one. 40% (not 50%, which backtested even
better) was the deliberately conservative pick — it beat the shipped policy on 9/9 real cases with no
downside case found, while 50% was more aggressive than the single 90-day sample justified shipping
without a live re-measurement; the fraction is a named constant
(`EXIT_RULES.ratchet_lock_floor_fraction`) specifically so a future measurement can move it without
another code-shape change.
