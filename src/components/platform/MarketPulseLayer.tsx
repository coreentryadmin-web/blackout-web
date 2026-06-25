/**
 * VITALS Phase 1 — MarketPulseLayer ("the room breathes").
 *
 * One fixed, full-viewport, pointer-events-none layer that sits BEHIND content
 * (low z) and renders the signature living-terminal ambient:
 *   1. the pulse wash    — emerald breath at the market's cadence
 *   2. the EKG hairline  — one faint pip travelling left→right once per beat
 *   3. the aurora mesh   — two slow blurred brand-light pools drifting behind
 *
 * Every piece subscribes to the --pulse-* cadence vars published by
 * <MarketSessionProvider>; nothing here invents its own timing. All motion is
 * transform + opacity only (blur is set once, never animated). Each piece ships
 * a named reduced-motion still state in globals.css.
 *
 * Mounted ONCE in the platform shell alongside the existing per-variant ambient
 * — additive, it does not replace or remove any existing backdrop.
 *
 * Server-renderable (no hooks, no Date, no Math.random) — markup is identical on
 * server and client, so it cannot cause a hydration mismatch.
 */
export function MarketPulseLayer() {
  return (
    <div className="market-pulse" aria-hidden>
      <div className="market-pulse-wash" />
      <div className="market-pulse-ekg" />
      <div className="market-pulse-aurora market-pulse-aurora-a" />
      <div className="market-pulse-aurora market-pulse-aurora-b" />
    </div>
  );
}

export default MarketPulseLayer;
