> **kind:** FINDING

## `momentum_rs_floor` blocked 100% of MOMENTUM_CONTINUATION setups since it shipped (RS rail structurally unable to fire) — FIXED

| **Status** | Fixed in PR (fix/momentum-rs-floor-tautology) |
|---|---|

**Symptom:** Member observed several high-scoring WATCH plays on the live Night Hawk board that
would have been large winners (INTC 92P +275%, TSLA 355P +98%, IWM 297P +56%) never promoted to
OPEN. The INTC 92P detail panel showed rating 46, gate block `momentum_rs_floor`, note "Momentum
Continuation - tier REJECT - confluence 2/2".

**Root cause — a tautological gate, not a calibration issue:**
`archetype-gates.ts`'s `MOMENTUM_CONTINUATION` case blocked whenever `rail_scores.RS < 55`
(`momentum_rs_floor`). But `scoreRsRail` (`rails/rs.ts`) only ever returns a hit once its own
internal score (base 45 + up to 30 for aligned session alpha + up to 15 for d10 alpha) already
clears 55 — `if (score < 55) return null;`. So a "fired" RS score can never be below 55 by
construction: `rail_scores.RS` in production is either `>=55` (fired) or `undefined` (never fired,
read as `0` via `?? 0`). A floor of `< 55` is therefore mathematically identical to "RS never
fired" — not "RS fired and was weak."

Traced the full data-wiring chain to confirm RS never fires in production, not just in theory:
- `legacyBridgeExtrasFromSetup` (`rails/legacy-bridge.ts`, the real mapper from
  `EnrichedZeroDteSetup`) never sets `stock_session_pct`/`qqq_session_pct`/`sector_session_pct`.
- `thesisEvidenceToLegacyExtras` (`evidence-bundle-map.ts`) reads from `ThesisEvidenceSnapshot`,
  whose type has **no session-% fields at all** — there was never anywhere for this data to come
  from.
- `attachThesisFirstLive` (`live-pipeline.ts`) is the real, unconditional live gating path (not a
  shadow-only comparison utility — confirmed by tracing `scan.ts` → `scan-shadow.ts` →
  `live-pipeline.ts`), and it calls `evaluateArchetypeGates` on every setup every pass.
- `resolveThesisRankTier` returns `"REJECT"` directly whenever `archetype_gates.verdict === "BLOCK"`,
  regardless of the underlying `archetype_score` — so a `momentum_rs_floor` block always produced
  tier REJECT, matching the exact live evidence (INTC 92P, tier REJECT, later +275%).

**The whole MOMENTUM_CONTINUATION archetype has been permanently blocked since this gate shipped** —
not "harder to clear," unconditionally impossible to pass, independent of how good the setup was.

**Same defect, second location:** `FLOW_FOLLOWING`'s `flow_rs_weak` (`rs(input.rail_scores) < 50`
→ `pushWatch`) is the identical RS-absence tautology, one severity level down — it always fired,
demoting every FLOW_FOLLOWING setup from tier `"A"` to `"WATCH"` via `resolveThesisRankTier`'s
`verdict === "PASS"` requirement (a `WATCH`-verdict archetype-gate result can never reach `"A"`,
only `"B"` or `"WATCH"`). Directly matches the reported "best plays stuck on Watch" pattern.

**Fix:** Removed both checks rather than gating them, because there is currently no way to
distinguish "RS genuinely fetched and scored low" from "RS never fetched" — the rail's own
construction makes the two states unobservable from the caller. `MOMENTUM_CONTINUATION` keeps its
absolute `momentum_abs_floor` (`MOMENTUM >= 60`) as its real quality gate. `FLOW_FOLLOWING` keeps
its `flow_score_floor` (`FLOW >= 65`).

**Not done (separate, larger undertaking):** properly wiring real
`stock_session_pct`/`qqq_session_pct`/`sector_session_pct`/`d10_alpha` inputs into the RS rail so it
can score meaningfully. Confirmed no existing field in `EnrichedZeroDteSetup` (`board.ts`) or
`IntradayRead` (`intraday.ts`) carries a reusable day-open/session-% value — this needs new
data-fetching infrastructure, not a rewire, and is out of scope for this fix.

**Blast radius:**
- `src/lib/zerodte/thesis/archetype-gates.ts` — both checks removed, `rs()` helper deleted (now
  unused).
- `src/lib/zerodte/thesis/archetype-gates.test.ts` — new file (none existed before). 4 tests:
  MOMENTUM_CONTINUATION passes on strong MOMENTUM with no RS data; still blocks on
  `momentum_abs_floor`; FLOW_FOLLOWING passes on strong FLOW with no RS data; still blocks on
  `flow_score_floor`.
- No other call site references `momentum_rs_floor`/`flow_rs_weak` outside tests.

**Evidence of correctness:** `src/lib/zerodte/thesis/*.test.ts` + `src/lib/zerodte/*.test.ts`:
1231/1231 pass (1 pre-existing skip). `npx tsc --noEmit` clean. Both on Node 20.
