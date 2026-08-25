import type { FlowQuality } from "../../flow-quality";
import type { FlowClass, RailHit } from "../types";

export type FlowRailInput = {
  ticker: string;
  direction: "long" | "short";
  gross_premium: number;
  flow_quality: FlowQuality | null;
  print_count?: number;
};

export function classifyFlowCampaign(fq: FlowQuality | null, gross: number): FlowClass {
  if (!fq) return gross >= 2_000_000 ? "CAMPAIGN" : "EVENT";
  const persistent = fq.components.persistence >= 10 && fq.momentum.spanMin >= 15;
  const accelerating = fq.momentum.accelerating;
  if (persistent && (accelerating || gross >= 1_500_000)) return "CAMPAIGN";
  return "EVENT";
}

export function scoreFlowRail(input: FlowRailInput): RailHit | null {
  const { ticker, direction, gross_premium, flow_quality } = input;
  if (gross_premium < 200_000 && (flow_quality?.score ?? 0) < 50) return null;

  const fqScore = flow_quality?.score ?? 0;
  const grossBoost = gross_premium >= 5_000_000 ? 12 : gross_premium >= 1_000_000 ? 6 : 0;
  const score = Math.min(100, Math.round(Math.max(fqScore, 40) + grossBoost));
  const flow_class = classifyFlowCampaign(flow_quality, gross_premium);

  return {
    rail: "FLOW",
    ticker: ticker.toUpperCase(),
    direction,
    score,
    flow_class,
    summary:
      flow_quality?.reason ??
      `$${(gross_premium / 1e6).toFixed(1)}M ${direction === "long" ? "call" : "put"} bias · ${flow_class}`,
    meta: { gross_premium, print_count: input.print_count ?? null },
  };
}
