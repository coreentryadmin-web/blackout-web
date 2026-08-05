/**
 * Premium PlayTerminal display helpers — pure, grounded in TerminalPlay payload fields.
 */

import type { ThesisHealthPayload, ThesisPillarState } from "@/lib/zerodte/thesis-health";
import type { TerminalExitLadder } from "@/lib/zerodte/terminal-ladder";
import type { DeckStatus, ExitModel, Recommendation, TerminalPlay } from "./types";
import { playQualityPct } from "./play-card-display";
import { ARCHETYPE_META, SWING_SUB_LANES, type SwingArchetype, type SwingSubLane } from "@/lib/swing/taxonomy";

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
  const tapeGate = play.gates.find((g) => /tape/i.test(g.label));
  return [
    { label: "Flow", ok: h ? pillarOk(findPillar(h, ["flow"])) : null },
    { label: "Gamma", ok: h ? pillarOk(findPillar(h, ["dealer", "structure"])) : null },
    { label: "Structure", ok: h ? pillarOk(findPillar(h, ["structure"])) : null },
    { label: "Breadth", ok: h ? pillarOk(findPillar(h, ["market"])) : (tapeGate?.ok ?? null) },
    { label: "Momentum", ok: h ? pillarOk(findPillar(h, ["tape", "momentum"])) : null },
  ];
}

/** ONE merged pass/fail checklist — replaces the old separate Engine Checklist (5 rows) and
 *  Confluence Grid (6 cells) render, which described the SAME underlying thesis-health pillars
 *  under two different label vocabularies with real overlap (Flow/Breadth/Gamma appeared in
 *  both). Kept `engineChecklist`/`confluenceChecklist` above unchanged (pure, still unit-tested,
 *  still valid data shapes) — this is a presentation-layer dedup on top of them, not a rewrite
 *  of the underlying pillar math. Picks confluence's vocabulary (Dealer/Flow/VWAP/Breadth/
 *  Gamma/Vol — the clearer of the two) and adds Momentum, the one engine-checklist-only signal
 *  with no confluence equivalent, so no distinct signal is lost. See docs/audit/FINDINGS.md
 *  2026-08-04 (Night Hawk panel declutter). */
export function unifiedChecklist(play: TerminalPlay): ChecklistItem[] {
  const h = play.thesisHealth;
  return [
    { label: "Dealer", ok: pillarOk(findPillar(h, ["dealer"])) },
    { label: "Flow", ok: pillarOk(findPillar(h, ["flow"])) },
    { label: "VWAP", ok: pillarOk(findPillar(h, ["vwap"])) },
    { label: "Breadth", ok: pillarOk(findPillar(h, ["market", "confluence"])) },
    { label: "Gamma", ok: pillarOk(findPillar(h, ["structure", "dealer"])) },
    { label: "Vol", ok: pillarOk(findPillar(h, ["volatility"])) },
    { label: "Momentum", ok: pillarOk(findPillar(h, ["tape", "momentum"])) },
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
  // WATCH/SKIP rows have no committed position — never paint score-as-confidence on candidates.
  if (play.status === "WATCH" || play.status === "SKIP") return null;
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

/** Which horizons get the richer "Terminal v2" visual grammar (dense trade hero, unified checklist
 *  stack, ManagementActionCard, TradeOutcomePanel, …) instead of the plain text/key-value fallback.
 *
 *  Was ZERO_DTE-only (`isZeroDtePremiumTerminal`, name kept for git-blame continuity — no other
 *  module imports this beyond PlayTerminal.tsx, confirmed 2026-08-05). Extended to SWING: a Swing
 *  play carries the SAME conceptual fields this grammar renders (ticker/direction/status, current +
 *  peak, a recommended action + reason + confidence, an outcome verdict) — a member trading both
 *  lanes was relearning the UI switching tabs for no data reason (docs/audit/FINDINGS.md 2026-08-05).
 *  LEAPS/LEGACY are deliberately NOT included here — LEAPS wasn't audited in this pass (out of
 *  scope; same shape as Swing so likely a clean follow-up) and LEGACY has its own dedicated
 *  stock-position renderers.
 *
 *  Genuinely 0DTE-only SAME-SESSION mechanics (the 15:50 hard time-stop clock, the iron-condor tent,
 *  the frozen trim-scale ladder) are NOT toggled by this flag — those stay gated on an explicit
 *  `play.horizon === "ZERO_DTE"` (or the condor/trim-scale predicates in terminal-guards.ts) at each
 *  call site, so extending this flag can never leak a same-day countdown onto a multi-week Swing. */
export function isZeroDtePremiumTerminal(play: TerminalPlay): boolean {
  return play.horizon === "ZERO_DTE" || play.horizon === "SWING";
}

/** Engine confidence 0–100 — same grounded stack as conviction display. */
export function engineConfidencePct(play: TerminalPlay): number | null {
  const c = convictionDisplay(play);
  return c.score;
}

export function decisionWindowLabel(minutesRemaining: number): { mins: string; secs: string } {
  const totalSec = Math.max(0, minutesRemaining * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return { mins: String(m), secs: String(s).padStart(2, "0") };
}

export type MarketContextItem = {
  label: string;
  value: string;
  tone: "pos" | "neg" | "neutral";
};

/** Human-readable market context from thesis-health pillars — replaces empty greeks row. */
export function marketContextItems(play: TerminalPlay): MarketContextItem[] {
  const h = play.thesisHealth;
  if (!h) return [];

  const gamma = findPillar(h, ["dealer", "structure"]);
  const trend = findPillar(h, ["tape", "momentum"]);
  const dealer = findPillar(h, ["dealer"]);

  const items: MarketContextItem[] = [];

  if (gamma && gamma.status !== "na") {
    const pos = gamma.status === "intact" || gamma.status === "strengthened";
    items.push({
      label: "Gamma",
      value: pos ? "Positive" : "Negative",
      tone: pos ? "pos" : "neg",
    });
  }
  if (trend && trend.status !== "na") {
    const bull = trend.status === "intact" || trend.status === "strengthened";
    const bear = trend.status === "lost" || trend.status === "faded";
    items.push({
      label: "Trend",
      value: bull ? "Bullish" : bear ? "Bearish" : "Neutral",
      tone: bull ? "pos" : bear ? "neg" : "neutral",
    });
  }
  if (dealer && dealer.status !== "na") {
    const sup = dealer.status === "intact" || dealer.status === "strengthened";
    items.push({
      label: "Dealer",
      value: sup ? "Supportive" : "Headwind",
      tone: sup ? "pos" : "neg",
    });
  }
  return items;
}

/** Expected move % from frozen target premium vs entry — null when not grounded. */
export function expectedMovePct(play: TerminalPlay): number | null {
  const entry = play.entry;
  const target = play.exitPolicy?.target_premium ?? null;
  if (entry == null || target == null || entry <= 0) return null;
  const pct = ((target / entry) - 1) * 100;
  return Number.isFinite(pct) ? Math.round(pct) : null;
}

/** Risk unit label — 1R when plan geometry exists. */
export function riskUnitLabel(play: TerminalPlay): string | null {
  if (play.rrRatio != null && Number.isFinite(play.rrRatio)) return "1R";
  const entry = play.entry;
  const stop = play.exitPolicy?.stop_premium ?? null;
  if (entry != null && stop != null && entry > 0) return "1R";
  return null;
}

/** Dollar P&L from entry mark delta (long premium framing). */
export function markDollarPnl(play: TerminalPlay): number | null {
  if (play.entry == null || play.mark == null) return null;
  const d = play.mark - play.entry;
  return Number.isFinite(d) ? d : null;
}

/** Peak mark from entry + peak % when both grounded. */
export function peakMark(play: TerminalPlay): number | null {
  if (play.entry == null || play.peak == null) return null;
  const m = play.entry * (1 + play.peak / 100);
  return Number.isFinite(m) ? m : null;
}

export type TradeSummaryDisplay = {
  ticker: string;
  direction: string;
  grade: string | null;
  confidence: number | null;
  peakPct: number | null;
  currentPct: number | null;
  status: string;
  origin: string | null;
  contract: string;
  horizonLabel: string;
  dollarPnl: number | null;
};

/** Title-case a SCREAMING_SNAKE enum value into a human phrase — "AT_TRIGGER" → "At trigger". Used
 *  ONLY for enum-shaped swing observables with no dedicated label map (setupState/entryStatus/
 *  servingSection); archetype/subLane have their own ARCHETYPE_META/SWING_SUB_LANES labels below. */
function humanizeEnum(v: string): string {
  const s = v.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type SwingStatusDisplay = {
  setup: string | null;
  entry: string | null;
  archetype: string | null;
  subLane: string | null;
  section: string | null;
};

/** The pre-entry/live-position OBSERVABLES the swing serving router (serving.ts) keys on — routing
 *  logic already reads these upstream; this is the FIRST time they're surfaced to the member, so a
 *  Swing name sitting in WATCH/WAITING_FOR_ENTRY has an honest "why" instead of just a bare score.
 *  Every field is independently optional — a play carrying only some of them (or none, e.g. a
 *  degraded/legacy read) renders only what it has. Never fabricates a value the adapter didn't set. */
export function swingStatusDisplay(play: TerminalPlay): SwingStatusDisplay | null {
  if (play.horizon !== "SWING") return null;
  const setup = play.setupState ? humanizeEnum(play.setupState) : null;
  const entry = play.entryStatus ? humanizeEnum(play.entryStatus) : null;
  const archetype = play.archetype
    ? (ARCHETYPE_META[play.archetype as SwingArchetype]?.label ?? humanizeEnum(play.archetype))
    : null;
  const subLane = play.subLane
    ? (SWING_SUB_LANES[play.subLane as SwingSubLane]?.label ?? humanizeEnum(play.subLane))
    : null;
  const section = play.servingSection ? humanizeEnum(play.servingSection) : null;
  if (!setup && !entry && !archetype && !subLane && !section) return null;
  return { setup, entry, archetype, subLane, section };
}

/** One clearly-labeled status line for the Thesis panel — the compact render of `swingStatusDisplay`.
 *  Null when the play carries none of the observables (never an empty "Setup: —" line). */
export function swingStatusLine(play: TerminalPlay): string | null {
  const d = swingStatusDisplay(play);
  if (!d) return null;
  const parts: string[] = [];
  if (d.setup) parts.push(`Setup ${d.setup}`);
  if (d.entry) parts.push(`Entry ${d.entry}`);
  if (d.archetype) parts.push(d.archetype);
  if (d.subLane) parts.push(d.subLane);
  if (d.section) parts.push(`→ ${d.section}`);
  return parts.join(" · ");
}

export function tradeSummaryDisplay(play: TerminalPlay): TradeSummaryDisplay {
  const conviction = convictionDisplay(play);
  return {
    ticker: play.ticker,
    direction: play.direction,
    grade: conviction.grade,
    confidence: conviction.score,
    peakPct: play.peak ?? null,
    currentPct: play.pnlPct ?? null,
    status: play.status,
    origin: play.discoveryOrigin?.[0]?.replace(/_/g, " ") ?? null,
    contract: play.contract,
    horizonLabel: play.horizon === "ZERO_DTE" ? "0DTE" : play.horizon,
    dollarPnl: markDollarPnl(play),
  };
}
