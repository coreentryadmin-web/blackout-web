/**
 * Premium PlayTerminal display helpers — pure, grounded in TerminalPlay payload fields.
 */

import type { ThesisHealthPayload, ThesisPillarState } from "@/lib/zerodte/thesis-health";
import type { TerminalExitLadder } from "@/lib/zerodte/terminal-ladder";
import type { DeckStatus, ExitModel, Recommendation, TerminalPlay } from "./types";
import { playQualityPct } from "./play-card-display";

export type ChecklistItem = { label: string; ok: boolean | null };

export type ConvictionDisplay = {
  grade: string | null;
  score: number | null;
  max: number;
};

export type ManagementActionDisplay = {
  verb: string;
  sizePct: number | null;
  urgency: "NOW" | "WATCH" | "HOLD";
  reason: string;
  /** Grounded confidence — thesis health, ratchet proximity, or null. */
  probabilityPct: number | null;
};

/** Thesis strength 0–100 — thesis health when wired, else null (never fabricated). */
export function thesisStrengthPct(play: TerminalPlay): number | null {
  if (play.thesisHealth?.health != null && Number.isFinite(play.thesisHealth.health)) {
    return Math.round(Math.max(0, Math.min(100, play.thesisHealth.health)));
  }
  if (play.thesisBreak?.level === "intact") return null;
  if (play.thesisBreak?.level === "warn") return 45;
  if (play.thesisBreak?.level === "break") return 15;
  return null;
}

function pillarOk(p: ThesisPillarState | undefined): boolean | null {
  if (!p || p.status === "na") return null;
  return p.status === "intact" || p.status === "strengthened";
}

function findPillar(health: ThesisHealthPayload | null | undefined, ids: string[]): ThesisPillarState | undefined {
  if (!health) return undefined;
  for (const id of ids) {
    const p = health.pillars.find((x) => x.id === id);
    if (p && p.status !== "na") return p;
  }
  return undefined;
}

/** Six-lens confluence grid from thesis-health pillars. */
export function confluenceChecklist(play: TerminalPlay): ChecklistItem[] {
  const h = play.thesisHealth;
  return [
    { label: "Dealer", ok: pillarOk(findPillar(h, ["dealer"])) },
    { label: "Flow", ok: pillarOk(findPillar(h, ["flow"])) },
    { label: "VWAP", ok: pillarOk(findPillar(h, ["vwap"])) },
    { label: "Breadth", ok: pillarOk(findPillar(h, ["market", "confluence"])) },
    { label: "Gamma", ok: pillarOk(findPillar(h, ["structure", "dealer"])) },
    { label: "Vol", ok: pillarOk(findPillar(h, ["volatility"])) },
  ];
}

/** Engine checklist — gates + thesis pillars when available. */
export function engineChecklist(play: TerminalPlay): ChecklistItem[] {
  const h = play.thesisHealth;
  const hardGate = play.gates.find((g) => /hard/i.test(g.label));
  const tapeGate = play.gates.find((g) => /tape/i.test(g.label));
  return [
    { label: "Flow", ok: h ? pillarOk(findPillar(h, ["flow"])) : null },
    { label: "Trend", ok: h ? pillarOk(findPillar(h, ["tape", "momentum"])) : null },
    { label: "Gamma", ok: h ? pillarOk(findPillar(h, ["dealer", "structure"])) : null },
    { label: "Breadth", ok: h ? pillarOk(findPillar(h, ["market"])) : (tapeGate?.ok ?? null) },
    { label: "VWAP", ok: h ? pillarOk(findPillar(h, ["vwap"])) : null },
    { label: "Dealer", ok: h ? pillarOk(findPillar(h, ["dealer"])) : (hardGate?.ok ?? null) },
  ];
}

export function convictionDisplay(play: TerminalPlay): ConvictionDisplay {
  const grade = play.tierLabel?.trim() || null;
  const q = playQualityPct(play);
  const score =
    q ??
    (play.thesisHealth?.currentIndex != null && Number.isFinite(play.thesisHealth.currentIndex)
      ? Math.round(play.thesisHealth.currentIndex)
      : play.score > 0
        ? Math.round(play.score)
        : null);
  return { grade, score, max: 100 };
}

function managementReason(
  recommendation: Recommendation,
  exitModel: ExitModel,
  play: TerminalPlay,
): string {
  if (recommendation === "SELL") {
    if (play.recNote?.toLowerCase().includes("thesis")) return "Thesis break";
    if (play.exitModel === "SCALE_OUT") return "Plan stop";
    return "Stop ratchet";
  }
  if (recommendation === "TRIM") {
    return exitModel === "SCALE_OUT" ? "Trim ladder" : "Ratchet target";
  }
  if (play.thesisHealth && play.thesisHealth.health < 60) return "Thesis fading";
  return "Hold plan";
}

function actionProbability(
  play: TerminalPlay,
  recommendation: Recommendation,
  progress: number | null,
): number | null {
  if (play.thesisHealth?.health != null && Number.isFinite(play.thesisHealth.health)) {
    if (recommendation === "SELL") {
      return Math.round(Math.max(0, Math.min(99, 100 - play.thesisHealth.health)));
    }
    return Math.round(Math.max(0, Math.min(99, play.thesisHealth.health)));
  }
  if (progress != null && recommendation === "SELL") {
    return Math.round(Math.max(10, Math.min(95, (1 - progress) * 100)));
  }
  const q = playQualityPct(play);
  return q != null ? Math.round(q) : null;
}

export function managementActionDisplay(
  play: TerminalPlay,
  recommendation: Recommendation,
  progress: number | null,
): ManagementActionDisplay {
  let verb = recommendation;
  let sizePct: number | null = null;
  if (recommendation === "TRIM" && play.exitPolicy?.trim_levels) {
    const next = play.exitPolicy.trim_levels.find((t) => !t.fired);
    sizePct = next ? Math.round(next.fraction * 100) : 33;
    verb = "TRIM";
  } else if (recommendation === "SELL") {
    sizePct = 100;
    verb = "SELL";
  } else if (recommendation === "BUY") {
    verb = "BUY";
    sizePct = null;
  } else {
    verb = "HOLD";
    sizePct = null;
  }

  const urgency: ManagementActionDisplay["urgency"] =
    recommendation === "SELL" ? "NOW" : recommendation === "TRIM" ? "NOW" : "HOLD";

  return {
    verb,
    sizePct,
    urgency,
    reason: managementReason(recommendation, play.exitModel, play),
    probabilityPct: actionProbability(play, recommendation, progress),
  };
}

export type TrimLadderVisual = {
  label: string;
  fill: number;
  state: "banked" | "live" | "pending";
  triggerPct: number | null;
};

/** Visual trim ladder segments for the management tab. */
export function trimLadderVisual(exitPolicy: TerminalExitLadder | null | undefined): TrimLadderVisual[] {
  if (!exitPolicy || exitPolicy.policy !== "trim_scale") return [];
  const rows: TrimLadderVisual[] = exitPolicy.trim_levels.map((t, i) => ({
    label: `Target ${i + 1}`,
    fill: t.fired ? 1 : 0.15,
    state: t.fired ? "banked" : "pending",
    triggerPct: t.trigger_pct,
  }));
  const anyFired = exitPolicy.trim_levels.some((t) => t.fired);
  rows.push({
    label: "Runner",
    fill: anyFired ? 0.55 : 0.2,
    state: anyFired ? "live" : "pending",
    triggerPct: null,
  });
  return rows;
}

export type TradeOutcomeDisplay = {
  verdict: "WIN" | "LOSS" | "FLAT" | "OPEN";
  closePct: number | null;
  bestPct: number | null;
  worstPct: number | null;
};

export function tradeOutcomeDisplay(play: TerminalPlay): TradeOutcomeDisplay {
  const closePct = play.status === "CLOSED" ? play.pnlPct : play.pnlPct;
  const bestPct = play.peak ?? null;
  const worstPct = play.trough ?? null;
  if (play.status !== "CLOSED") {
    return { verdict: "OPEN", closePct: closePct ?? null, bestPct, worstPct };
  }
  const p = closePct ?? 0;
  return {
    verdict: p > 0 ? "WIN" : p < 0 ? "LOSS" : "FLAT",
    closePct: closePct ?? null,
    bestPct,
    worstPct,
  };
}

/** ASCII strength bar — 10 blocks, grounded pct. */
export function strengthBarBlocks(pct: number | null, width = 10): string {
  if (pct == null || !Number.isFinite(pct)) return "—".repeat(width);
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

/** Filled segments for animated React strength bars. */
export function strengthBarSegmentFills(pct: number | null, width = 10): boolean[] {
  if (pct == null || !Number.isFinite(pct)) return Array.from({ length: width }, () => false);
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return Array.from({ length: width }, (_, i) => i < filled);
}

export function isZeroDtePremiumTerminal(play: TerminalPlay): boolean {
  return play.horizon === "ZERO_DTE";
}

export function decisionWindowLabel(minutesRemaining: number): { mins: string; secs: string } {
  const totalSec = Math.max(0, minutesRemaining * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return { mins: String(m), secs: String(s).padStart(2, "0") };
}
