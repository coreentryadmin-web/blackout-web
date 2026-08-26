/**
 * Per-contract evidence for the Vector pick drawer — structured, grounded sections a member can
 * audit. Built from the same desk context the chart already computed (no second model, no news
 * fabrication). Sections with no grounded data are omitted entirely.
 */
import type { PlayTechnicals } from "./vector-play-engine";
import type { VectorRegimePosture } from "./vector-regime";
import type { PlayPlatformFlowPrint, PlayPlatformInputs } from "./vector-play-platform";
import { darkPoolNearReference, summarizeSessionFlowBias } from "./vector-play-platform";
import type { VectorDarkPoolLevel } from "./vector-dark-pool-levels";
import type { ConfluenceZone } from "./vector-confluence";

export type VectorPickEvidenceItem = {
  label: string;
  value: string;
  detail?: string;
};

export type VectorPickEvidenceSection = {
  id: "strike" | "flow" | "positioning" | "structure" | "technicals" | "liquidity" | "session";
  title: string;
  items: VectorPickEvidenceItem[];
};

export type VectorPickEvidenceInput = {
  side: "call" | "put";
  strike: number;
  expiry: string;
  dte: number;
  premium: number;
  role: string;
  targetStrike: number;
  spot: number;
  callWall: number | null;
  putWall: number | null;
  magnetStrike: number | null;
  gammaFlip: number | null;
  regimePosture: VectorRegimePosture | null;
  technicals: PlayTechnicals | null;
  platformInputs: PlayPlatformInputs | null;
  confluenceZones: readonly ConfluenceZone[] | null;
  playStarred: readonly string[];
  caveat?: "premium_high" | "low_liquidity" | "premium_high_low_liquidity";
};

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function pctDist(a: number, b: number): string {
  if (!(b > 0)) return "—";
  const p = ((a - b) / b) * 100;
  const sign = p >= 0 ? "+" : "";
  return `${sign}${p.toFixed(2)}%`;
}

function flowsAtStrike(
  flows: readonly PlayPlatformFlowPrint[] | null | undefined,
  strike: number,
  side: "call" | "put"
): PlayPlatformFlowPrint[] {
  if (!flows?.length) return [];
  const want = side === "call" ? "CALL" : "PUT";
  return flows
    .filter((f) => {
      const s = f.option_type?.toUpperCase();
      return s === want && typeof f.strike === "number" && f.strike === strike;
    })
    .sort((a, b) => (b.premium ?? 0) - (a.premium ?? 0))
    .slice(0, 3);
}

function confluenceAtStrike(
  zones: readonly ConfluenceZone[] | null | undefined,
  strike: number,
  spot: number
): ConfluenceZone | null {
  if (!zones?.length || !(spot > 0)) return null;
  const tol = spot * 0.006;
  let best: ConfluenceZone | null = null;
  for (const z of zones) {
    const dist = Math.abs(z.center - strike);
    if (dist > tol) continue;
    if (!best || z.score > best.score) best = z;
  }
  return best;
}

const ROLE_LABEL: Record<string, string> = {
  "primary-long": "Primary long leg",
  "primary-short": "Primary short leg",
  "fade-dip": "Range fade — buy the dip",
  "fade-rip": "Range fade — sell the rip",
  "flow-whale": "HELIX whale anchor",
};

/**
 * Build grounded evidence sections for one ranked contract. Omits empty sections — never invents
 * catalysts or Thermal numbers we did not receive in context.
 */
export function buildVectorPickEvidence(input: VectorPickEvidenceInput): VectorPickEvidenceSection[] {
  const sections: VectorPickEvidenceSection[] = [];
  const { spot, strike, side, role, targetStrike } = input;

  // —— Strike thesis ——
  const strikeItems: VectorPickEvidenceItem[] = [
    {
      label: "Contract",
      value: `${fmt(strike)}${side === "call" ? "C" : "P"} · ${input.dte === 0 ? "0DTE" : `${input.dte}D`}`,
      detail: `@ $${input.premium.toFixed(2)} mid`,
    },
    {
      label: "Role",
      value: ROLE_LABEL[role] ?? role,
    },
    {
      label: "Anchor level",
      value: fmt(targetStrike),
      detail:
        Math.abs(strike - targetStrike) / (spot || 1) <= 0.004
          ? "Strike matches the keyed level"
          : `${pctDist(strike, targetStrike)} from anchor`,
    },
  ];
  sections.push({ id: "strike", title: "Why this strike", items: strikeItems });

  // —— HELIX flow ——
  const atStrike = flowsAtStrike(input.platformInputs?.sessionFlows, strike, side);
  const flowSummary = summarizeSessionFlowBias(input.platformInputs?.sessionFlows);
  const flowItems: VectorPickEvidenceItem[] = [];
  for (const f of atStrike) {
    const prem = f.premium ?? 0;
    flowItems.push({
      label: "Print at strike",
      value: `$${prem >= 1_000_000 ? `${(prem / 1_000_000).toFixed(1)}M` : `${Math.round(prem / 1000)}K`}`,
      detail: f.expiry ? `exp ${f.expiry.slice(5).replace("-", "/")}` : undefined,
    });
  }
  if (flowSummary && !atStrike.length) {
    const callM = Math.round(flowSummary.callPremium / 1_000_000);
    const putM = Math.round(flowSummary.putPremium / 1_000_000);
    flowItems.push({
      label: "Session tape",
      value: `${flowSummary.bias.toUpperCase()} bias`,
      detail: `${callM}M calls / ${putM}M puts (≥$200K prints)`,
    });
  }
  if (flowItems.length) {
    sections.push({ id: "flow", title: "HELIX flow", items: flowItems });
  }

  // —— Positioning (walls / flip / magnet — dealer gamma context) ——
  const posItems: VectorPickEvidenceItem[] = [];
  if (input.regimePosture && input.regimePosture !== "unknown") {
    const regimeLabel =
      input.regimePosture === "long"
        ? "Long gamma — dealers fade extremes"
        : input.regimePosture === "short"
          ? "Short gamma — dealers amplify breaks"
          : "Transition — sitting on the gamma flip";
    posItems.push({ label: "Regime", value: regimeLabel });
  }
  if (input.gammaFlip != null && spot > 0) {
    posItems.push({
      label: "Gamma flip",
      value: fmt(input.gammaFlip),
      detail: `Spot ${pctDist(spot, input.gammaFlip)} vs flip`,
    });
  }
  if (input.callWall != null) {
    posItems.push({
      label: "Call wall",
      value: fmt(input.callWall),
      detail: `Strike ${pctDist(strike, input.callWall)} vs wall`,
    });
  }
  if (input.putWall != null) {
    posItems.push({
      label: "Put wall",
      value: fmt(input.putWall),
      detail: `Strike ${pctDist(strike, input.putWall)} vs wall`,
    });
  }
  if (input.magnetStrike != null) {
    posItems.push({
      label: "Max pain / magnet",
      value: fmt(input.magnetStrike),
      detail: `Strike ${pctDist(strike, input.magnetStrike)} vs magnet`,
    });
  }
  if (posItems.length) {
    sections.push({ id: "positioning", title: "Positioning", items: posItems });
  }

  // —— Structure (confluence + dark pool) ——
  const structItems: VectorPickEvidenceItem[] = [];
  const zone = confluenceAtStrike(input.confluenceZones, strike, spot);
  if (zone) {
    structItems.push({
      label: "Confluence zone",
      value: fmt(zone.center),
      detail: `${zone.kinds.length} kinds stacked · score ${zone.score.toFixed(1)}`,
    });
  }
  const dp = darkPoolNearReference(input.platformInputs?.darkPoolLevels, strike, spot);
  if (dp) {
    structItems.push({
      label: "Dark pool",
      value: fmt(dp.strike),
      detail: `${dp.pct.toFixed(0)}% of session dark-pool tape near this strike`,
    });
  }
  if (structItems.length) {
    sections.push({ id: "structure", title: "Structure", items: structItems });
  }

  // —— Technicals (chart summary — only fields present) ——
  const t = input.technicals;
  const techItems: VectorPickEvidenceItem[] = [];
  if (t?.vwap != null && spot > 0) {
    techItems.push({
      label: "VWAP",
      value: fmt(t.vwap),
      detail: `Spot ${pctDist(spot, t.vwap)} vs VWAP`,
    });
  }
  if (t?.emaStack) {
    techItems.push({
      label: "EMA 9/21/50",
      value: t.emaStack === "up" ? "Stacked bullish" : t.emaStack === "down" ? "Stacked bearish" : "Mixed",
    });
  }
  if (t?.rsi != null) {
    techItems.push({
      label: "RSI",
      value: String(Math.round(t.rsi)),
      detail: t.rsi >= 70 ? "overbought" : t.rsi <= 30 ? "oversold" : "neutral",
    });
  }
  if (t?.macd) {
    techItems.push({ label: "MACD", value: t.macd === "bull" ? "Bullish cross" : "Bearish cross" });
  }
  if (t?.structure) {
    techItems.push({
      label: "Market structure",
      value: `${t.structure.type} ${t.structure.direction}`,
      detail: `@ ${fmt(t.structure.level)}`,
    });
  }
  if (t?.goldenPocket) {
    techItems.push({
      label: "Golden pocket",
      value: `${fmt(t.goldenPocket.low)}–${fmt(t.goldenPocket.high)}`,
    });
  }
  if (techItems.length) {
    sections.push({ id: "technicals", title: "Chart technicals", items: techItems });
  }

  // —— Liquidity ——
  const liqItems: VectorPickEvidenceItem[] = [];
  if (input.caveat === "premium_high") {
    liqItems.push({ label: "Premium", value: "Above standard cap", detail: "Size down or use a limit" });
  } else if (input.caveat === "low_liquidity") {
    liqItems.push({ label: "Open interest", value: "Thin", detail: "Use a limit order" });
  } else if (input.caveat === "premium_high_low_liquidity") {
    liqItems.push({ label: "Liquidity", value: "Thin OI + high premium", detail: "Verify size" });
  } else {
    liqItems.push({ label: "Liquidity", value: "Passes Night Hawk gates", detail: "OI + premium within caps" });
  }
  sections.push({ id: "liquidity", title: "Liquidity", items: liqItems });

  // —— Session watch items (from play starred — already fused on chart) ——
  const starred = input.playStarred.filter(Boolean).slice(0, 4);
  if (starred.length) {
    sections.push({
      id: "session",
      title: "On the desk now",
      items: starred.map((line, i) => ({ label: i === 0 ? "Primary" : "Watch", value: line })),
    });
  }

  return sections;
}
