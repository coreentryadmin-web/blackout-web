/**
 * TRADE EXPLANATION — "Why did I exist?" (design-review priority #10).
 *
 * Every committed trade should be able to answer, in one glance, exactly why the engine took it. The good
 * news: the point-weighted evidence already EXISTS — computeFlowQuality returns per-component points, the
 * horizon scorers return {components, reason}, the gate stack returns pass/fail verdicts, entry_context pins
 * the tier factors, and the Allocation Engine returns role/sizing/reasons. This module doesn't recompute any
 * of it; it COMPOSES those pieces into one canonical, rankable, human-renderable trace — the invaluable
 * debugging + user-trust surface the review asked for.
 *
 *   COMMIT because
 *     Flow Quality      +18
 *     Sweep Persistence +12
 *     VWAP Alignment     +9
 *     Gamma Tailwind     +8
 *     No Conflict        ✓ gate
 *     Liquidity A        ✓ gate
 *     Expected Value  +0.62R
 *
 * PURE & deterministic — no IO. Factors sort by contribution (largest first) so the dominant reason leads.
 */

export type Verdict = "COMMIT" | "WATCH" | "SKIP";

/** A signed, point-weighted contributor to the decision (from a real scoring component). */
export interface ExplanationFactor {
  label: string;
  /** Points this factor added (or subtracted). */
  points: number;
}

/** A hard gate the setup passed or failed (with the reason when it failed). */
export interface ExplanationGate {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface TradeExplanationInput {
  verdict: Verdict;
  /** Point-weighted contributors (from flow-quality / scorer components, evidence sub-scores, etc.). */
  factors: ExplanationFactor[];
  /** Hard gates evaluated for this setup. */
  gates?: ExplanationGate[];
  /** Regime label + optional confidence (0–1). */
  regime?: { label: string; confidence?: number | null } | null;
  /** Liquidity grade / note, when known. */
  liquidity?: string | null;
  /** Calibrated expected value in R, when the feature store can price it (null = not yet). */
  evR?: number | null;
  /** Allocation decision, when the portfolio layer ran. */
  allocation?: { role: string; sizing: string; reasons: string[] } | null;
}

export interface TradeExplanation {
  verdict: Verdict;
  /** Factors sorted by |points| desc — dominant reason first. */
  factors: ExplanationFactor[];
  gates: ExplanationGate[];
  regime: { label: string; confidence: number | null } | null;
  liquidity: string | null;
  evR: number | null;
  allocation: { role: string; sizing: string; reasons: string[] } | null;
  /** Net points from the factor list (the score the factors argue). */
  netPoints: number;
  /** One-line summary: "COMMIT — Flow Quality +18, Sweep Persistence +12 · EV +0.62R". */
  headline: string;
  /** Multi-line human render (the block shown above). */
  lines: string[];
}

const fmtPts = (n: number): string => `${n >= 0 ? "+" : ""}${Math.round(n * 10) / 10}`;
const fmtR = (n: number): string => `${n >= 0 ? "+" : ""}${Math.round(n * 100) / 100}R`;

/** Compose the captured evidence into one canonical, ranked, renderable explanation. */
export function buildTradeExplanation(input: TradeExplanationInput): TradeExplanation {
  // Rank by magnitude so the biggest lever leads; keep only factors that actually moved the needle.
  const factors = input.factors
    .filter((f) => Number.isFinite(f.points) && f.points !== 0)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const gates = input.gates ?? [];
  const netPoints = Math.round(factors.reduce((s, f) => s + f.points, 0) * 10) / 10;
  const regime = input.regime
    ? { label: input.regime.label, confidence: input.regime.confidence ?? null }
    : null;
  const evR = input.evR != null && Number.isFinite(input.evR) ? input.evR : null;
  const allocation = input.allocation ?? null;

  const top = factors.slice(0, 3).map((f) => `${f.label} ${fmtPts(f.points)}`);
  const headline =
    `${input.verdict}` +
    (top.length ? ` — ${top.join(", ")}` : "") +
    (evR != null ? ` · EV ${fmtR(evR)}` : "");

  const lines: string[] = [`${input.verdict} because`];
  for (const f of factors) lines.push(`  ${f.label.padEnd(20)} ${fmtPts(f.points)}`);
  for (const g of gates) lines.push(`  ${g.label.padEnd(20)} ${g.passed ? "✓ gate" : `✗ ${g.detail ?? "blocked"}`}`);
  if (regime) lines.push(`  Regime               ${regime.label}${regime.confidence != null ? ` (${Math.round(regime.confidence * 100)}%)` : ""}`);
  if (input.liquidity) lines.push(`  Liquidity            ${input.liquidity}`);
  if (evR != null) lines.push(`  Expected Value       ${fmtR(evR)}`);
  if (allocation) lines.push(`  Allocation           ${allocation.role} · ${allocation.sizing}${allocation.reasons[0] ? ` (${allocation.reasons[0]})` : ""}`);

  return {
    verdict: input.verdict,
    factors,
    gates,
    regime,
    liquidity: input.liquidity ?? null,
    evR,
    allocation,
    netPoints,
    headline,
    lines,
  };
}

// ── converters from the existing component objects (so callers don't hand-build factor lists) ──

/** FlowQuality.components → factors (each component is already 0–N points). */
export function factorsFromFlowQuality(components: Record<string, number>): ExplanationFactor[] {
  const LABELS: Record<string, string> = {
    premiumDepth: "Premium Depth",
    aggression: "Aggression",
    sweepIntensity: "Sweep Intensity",
    persistence: "Sweep Persistence",
    concentration: "Strike Concentration",
    momentum: "Flow Momentum",
    institutional: "Institutional Blocks",
  };
  return Object.entries(components)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0)
    .map(([k, v]) => ({ label: LABELS[k] ?? k, points: v }));
}

/** A HorizonScore-style {components} map → factors (already point-weighted). */
export function factorsFromComponents(
  components: Record<string, number>,
  labels: Record<string, string> = {},
): ExplanationFactor[] {
  return Object.entries(components)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0)
    .map(([k, v]) => ({ label: labels[k] ?? k, points: v }));
}
