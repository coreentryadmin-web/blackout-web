# Thermal Largo Synthesis Gap — No Intelligent Analysis Brief

> **kind:** FINDING
> **Owner:** Claude (Ask Largo mandate)
> **Phase:** OPEN — Design + Implementation
> **Status:** Not yet fixed; staged finding to track the improvement mandate

## Summary

Thermal exposes 6 raw-data Largo tools (positioning, heatmap, comparison strip, wall dynamics, regime events, matrix changes) with excellent LARGO-PRODUCT-CONTRACT compliance for individual fields. However, there is **no synthesized analysis brief** equivalent to Night Hawk's `get_swing_play_brief` or SPX Slayer's `get_spx_play` that intelligently combines dealer gamma, regime, wall dynamics, and intraday transitions into a cohesive narrative answer.

**Impact:** Members must assemble the story from 6 separate tool calls. A member asking "what is dealer gamma telling us on NVDA right now" receives 6 raw snapshots, not one analyst-synthesized read. Violates the mandate: "the feature has to be extremely powerful and helpful."

**Evidence:** 
- `get_positioning` returns current dealer posture + regime label + nearest wall + flip distance
- `get_gex_regime_events` returns historical flip/wall/regime transitions
- `get_thermal_compare` returns multi-ticker regime comparison
- No tool exists that says: "dealer is SHORT gamma [consequence], walls are building [evidence: what changed intraday], flip is 250bps away [implication], watch for X if [regime risk]"

## Scope

This finding does NOT include:
- Per-strike ladder presentation (already served by `get_gex_heatmap` with correct C1-C10 compliance)
- UI/rendering improvements (separate product work)
- Volatility regime calibration (already in `get_positioning`)

This finding DOES include:
- **New tool:** synthesized Thermal brief combining all signals into a narrative answer
- **Audit:** whether any computed fields (e.g., regime stability, wall-build confidence, transition causality) are being dropped before reaching the API
- **Standards:** whether the synthesized answer meets the LARGO-PRODUCT-CONTRACT's 10 points

## Root Cause

Night Hawk's brief layers flow-accumulation + risk-assessment + thesis synthesis into connected paragraphs (`play-brief-narrative.ts`). SPX Slayer's play layers confluence scoring + option-selection logic. Thermal's Largo surface was built as 6 independent tools — a **raw-data transport layer**, not an **analysis layer** — because the Thermal UI itself serves raw data (strike ladders, lens toggles). The Largo side inherited that architecture without synthesizing for the text-reasoning use case.

## Proposed Solution

**New tool: `get_thermal_brief`**

Synthesized Thermal analysis brief for one ticker, answering "what is dealer gamma telling us right now." Returns:

```ts
{
  ticker: string;
  session_date: string;
  as_of_et: string;
  freshness: "live" | "cached" | "stale";
  
  // The synthesized narrative (NOT a bullet list)
  analysis: {
    regime: {
      current: "long_gamma" | "short_gamma" | "transition";
      stability: "stable" | "fragile" | "transitioning"; // new computed field
      explanation: string; // prose: why this regime, how long held, what triggers a flip
    };
    
    walls: {
      dominant_pressure: "call_wall" | "put_wall" | "balanced";
      call_wall: { strike: number; gex_magnitude: string; relative_to_spot: string } | null;
      put_wall: { strike: number; gex_magnitude: string; relative_to_spot: string } | null;
      nearest_to_spot: number; // strike of the closer wall, signed point distance
      distance_to_flip: { percentage: number; magnitude_dollars: number }; // reproduced from get_positioning for context
      stability: "firm" | "moderate" | "thin"; // from Vector wall_integrity when available, fallback to GEX magnitude
    };
    
    intraday_context: {
      what_changed: string; // prose: material matrix changes since market open (from get_gex_matrix_changes + regime_events)
      transitions: Array<{ event: string; at_et: string; magnitude: string }>; // regime flips, wall breaks, new formations
    };
    
    cross_ticker_context: string | null; // When applicable: how this ticker's regime aligns/diverges from sector/index
    
    trader_perspective: string; // Synthesized: what this regime favors, what to watch, caution points
  };
  
  // Contract compliance
  unavailable?: { reason: string; what_is_missing: string; retryable: boolean };
}
```

**Characteristics:**
- C1 (Time): `as_of_et` + `session_date` supplied
- C2 (Freshness): `freshness` flag + implicit age via matrix_age_sec from underlying positioning call
- C3 (Absence): Explicit `unavailable` when ticker is cold
- C4 (Identity): `ticker` canonical
- C5 (Direction): Explicit `regime.current` + rich `stability` context
- C6 (Confidence): OMITTED (no calibrated confidence on regime labels — appropriately per contract)
- C7 (Evidence): Specific wall magnitudes, distances, and intraday-change magnitudes
- C8 (Provenance): Source: aggregate of Polygon positioning + wall dynamics + regime events, cohort: multi-expiry
- C9 (Precision): No rounding before boundary
- C10 (Historical): Distinct from `get_gex_regime_events` (which is the durable log); this brief contextualizes the current state against the day's history

## Implementation Steps

1. **Define the brief schema** (src/lib/thermal/thermal-brief.ts)
   - Types: ThermalBrief, RegimeAssessment, WallContext, IntraDayContext
   - Synthesize function: `analyzeThermalForBrief(positioning, regimeEvents, matrixChanges, compare?) => ThermalBrief`

2. **Compute "stability" fields** (new)
   - Regime stability: is this regime hours-old (stable) or minutes-old (fragile)?
   - Wall stability: GEX magnitude + wall-history duration → firm/moderate/thin
   - Use existing wall_integrity from Vector when available; fall back to GEX magnitude bands

3. **Add `intraday_context` synthesis**
   - Read `get_gex_matrix_changes` for material deltas since last snapshot
   - Read `get_gex_regime_events` for today's transitions
   - Prose-format the changes: "regime flipped 45min ago at SPY 580, walls built $2M call side while put wall faded, GEX still short"

4. **Route the tool**
   - Add to THERMAL_ENGINE_TOOL_NAMES
   - Wire in Largo's run-tool.ts dispatch
   - Document in tool-defs.ts

5. **Audit dead-wire fields**
   - Check if any computed fields in the Thermal codebase (e.g., regime stability, wall-build rate, transition certainty) are being computed but not exposed
   - Ensure all relevant fields reach the API response

## Trader Perspective Justification

**Why this matters:**
- A trader reading "dealer is SHORT gamma, walls are thin, regime is fragile" gets the story that drives risk management decisions
- Bullet-list of raw fields (`regime: short_gamma`, `flip_distance: 250`, `call_wall_gex: $3M`) requires them to synthesize the implications themselves
- Night Hawk brief narrates the flow story; SPX play narrates the confluence story; Thermal brief should narrate the dealer-gamma story

**Testability:**
- Unit tests comparing synthesized brief against known market snapshots
- E2E test: live Thermal read → brief → Largo LLM → verify the answer matches the narrative (LLM does not hallucinate fields or flip the direction)

## Next Steps

1. Review this finding with Cursor (collaboration mandate)
2. Design the schema (feedback on prose style, field completeness, trader-relevance)
3. Implement synthesize function + route
4. Audit for dead-wire fields in thermal codebase
5. Test live against production Thermal reads
6. Merge and validate live

---

**Generated by [Claude Code](https://claude.ai/code)**
