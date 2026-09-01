/**
 * THESIS HEALTH — Entry Truth vs Current Truth for OPEN 0DTE ledger rows.
 *
 * Answers: "If I were flat right now, would I still take this trade?" by comparing the
 * FROZEN commit snapshot (entry_context + feature_vector) against live reads each board
 * cycle. Weighted by the evidence that actually drove entry (why_now, factor_breakdown,
 * discovery_origin) — not a universal template.
 *
 * PURE throughout — no IO. Board build + client overlay both call the same functions.
 */

import type { MarketBias } from "./intraday";
import { computeConfluence, type ZeroDteConfluence } from "./confluence";
import type { EnrichedZeroDteSetup } from "./board";
import type { ZeroDteFlowAccumulation } from "./flow-accumulation-context";
import type { WhyNowReason } from "./why-now";

export type ThesisPillarId =
  | "flow"
  | "tape"
  | "vwap"
  | "market"
  | "confluence"
  | "cortex"
  | "dealer"
  | "structure"
  | "darkpool"
  | "rel_volume"
  | "momentum"
  | "volatility";

export type ThesisHealthRung =
  | "INTACT"
  | "MINOR"
  | "WEAKENING"
  | "DEGRADED"
  | "BROKEN"
  | "OPPOSITE";

export type ThesisPillarStatus = "intact" | "faded" | "lost" | "na" | "strengthened";

export interface ThesisPillarState {
  id: ThesisPillarId;
  label: string;
  /** Normalized weight used in health (sums to 1 across scored pillars). */
  weight: number;
  commitScore: number;
  currentScore: number;
  commitLabel: string;
  currentLabel: string;
  status: ThesisPillarStatus;
  /** Points this pillar contributed to health (weight × currentScore × 100). */
  contributionPts: number;
  /** Health delta from commit baseline for this pillar alone. */
  deltaPts: number;
}

export interface ThesisHealthPayload {
  /** 0–100 preservation of the original thesis (capped). */
  health: number;
  /** Conviction index at commit (same formula, commit reads). */
  entryIndex: number;
  /** Conviction index now (live reads). */
  currentIndex: number;
  /** currentIndex − entryIndex (can be negative). */
  delta: number;
  rung: ThesisHealthRung;
  rungLabel: string;
  pillars: ThesisPillarState[];
  /** Cortex evidence lines pinned at commit (honest static until live cortex ships). */
  cortexSources?: CortexSourceLine[];
  /** Human-readable lines explaining what moved. */
  moves: string[];
  committedAtEt: string | null;
  computedAtEt: string;
  advisory: string;
  /** Maps to TerminalPlay.thesisBreak for backward-compatible monitor strip. */
  thesisBreakLevel: "intact" | "warn" | "break" | "unknown";
  thesisBreakNote: string;
}

export interface ThesisLiveInputs {
  direction: "long" | "short";
  /** Live enriched setup when the scan still surfaces this ticker; null = ledger-only. */
  setup: EnrichedZeroDteSetup | null;
  /** Session tape bias (SPY) — from fetchZeroDteSessionContext or board session cache. */
  spyBias: MarketBias | null;
  nowEtMinutes: number;
  computedAtEt: string;
}

type CommitBlob = Record<string, unknown> | null | undefined;
type FeatureVector = Record<string, unknown> | null | undefined;

export interface CortexSourceLine {
  source: string;
  kind: "support" | "oppose" | "veto" | "absent";
  detail: string;
}

const PILLAR_LABELS: Record<ThesisPillarId, string> = {
  flow: "Flow build",
  tape: "Tape bias",
  vwap: "VWAP side",
  market: "Market align",
  confluence: "Confluence",
  cortex: "Cortex",
  dealer: "Dealer regime",
  structure: "Intraday structure",
  darkpool: "Dark pool",
  rel_volume: "Rel volume",
  momentum: "Momentum",
  volatility: "Volatility",
};

/** Default pillar weights before evidence-profile adjustment. */
const DEFAULT_WEIGHTS: Record<ThesisPillarId, number> = {
  flow: 0.28,
  tape: 0.09,
  vwap: 0.12,
  market: 0.12,
  confluence: 0.12,
  cortex: 0.1,
  dealer: 0.05,
  structure: 0.04,
  darkpool: 0.03,
  rel_volume: 0.02,
  momentum: 0.02,
  volatility: 0.01,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function fin(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function biasAlignsPlay(bias: MarketBias | null, direction: "long" | "short"): number | null {
  if (bias == null) return null;
  if (bias === "flat") return 0.85;
  if (direction === "long") return bias === "up" ? 1 : 0;
  return bias === "down" ? 1 : 0;
}

function fmtBias(b: MarketBias | null): string {
  if (b == null) return "—";
  return b === "up" ? "↑ bull" : b === "down" ? "↓ bear" : "→ flat";
}

function flowScore(
  direction: "long" | "short",
  acc: ZeroDteFlowAccumulation | null | undefined,
): { score: number; label: string } | null {
  if (!acc) return null;
  const aligned = acc.aligned;
  if (aligned == null) return { score: 0.5, label: `${acc.days ?? 0}d · neutral` };
  const ok = aligned === true;
  const days = acc.days ?? 0;
  const strength = fin(acc.strength);
  const base = ok ? 0.7 + Math.min(0.3, days * 0.08) : 0;
  const boost = strength != null ? Math.min(0.15, strength / 500) : 0;
  return {
    score: clamp01(ok ? base + boost : 0),
    label: ok ? `${days}d ${acc.direction} · aligned` : `${days}d · fighting flow`,
  };
}

function vwapScore(direction: "long" | "short", vwapOk: boolean | null | undefined): number | null {
  if (vwapOk == null) return null;
  return vwapOk ? 1 : 0;
}

function marketScore(aligned: boolean | null | undefined): number | null {
  if (aligned == null) return null;
  return aligned ? 1 : 0;
}

function confluenceScore(conf: ZeroDteConfluence | null | undefined): { score: number; label: string } | null {
  if (!conf) return null;
  const c = conf.confirmations ?? 0;
  const score = c >= 2 ? 1 : c === 1 ? 0.55 : 0.15;
  return { score, label: `${c}/2` };
}

function cortexScore(blob: Record<string, unknown> | null | undefined): { score: number; label: string } | null {
  if (!blob) return null;
  if (blob.abstained === true) return { score: 0.5, label: "abstained" };
  const decision = String(blob.decision ?? "");
  const score = fin(blob.score);
  if (
    decision === "VETO" ||
    decision === "VETO_BLIND" ||
    decision === "NET_NEGATIVE" ||
    decision === "THIN_EVIDENCE" ||
    decision === "CONTESTED" ||
    decision === "OPPOSE_UNRESOLVED"
  ) {
    return { score: 0, label: `${decision}` };
  }
  if (score == null) return null;
  const normalized = clamp01((score + 1) / 3);
  return { score: normalized, label: `PASS ${score >= 0 ? "+" : ""}${score}` };
}

function dealerScore(regime: string | null | undefined): { score: number; label: string } | null {
  if (!regime) return null;
  const r = regime.toLowerCase();
  if (r.includes("long")) return { score: 0.85, label: regime };
  if (r.includes("short")) return { score: 0.85, label: regime };
  return { score: 0.6, label: regime };
}

function structureScore(
  direction: "long" | "short",
  intraday: EnrichedZeroDteSetup["intraday"] | null | undefined,
): { score: number; label: string } | null {
  if (!intraday?.last || !intraday.vwap) return null;
  const above = intraday.last > intraday.vwap;
  const withPlay = direction === "long" ? above : !above;
  const trend =
    intraday.trend_5m === "flat"
      ? "flat"
      : (intraday.trend_5m === "up") === (direction === "long")
        ? "with"
        : "against";
  let score = withPlay ? 0.7 : 0.2;
  if (trend === "with") score += 0.15;
  else if (trend === "against") score -= 0.25;
  if (intraday.or_break && intraday.or_break !== "inside") {
    const orWith = (intraday.or_break === "above") === (direction === "long");
    score += orWith ? 0.1 : -0.15;
  }
  return { score: clamp01(score), label: `${withPlay ? "VWAP ok" : "VWAP wrong"} · ${trend} trend` };
}

function structureFromFeatureVector(
  direction: "long" | "short",
  fv: FeatureVector,
): { score: number; label: string } | null {
  if (!fv) return null;
  const orBreak = fv.or_break as string | null | undefined;
  const trend = fv.trend_5m as string | null | undefined;
  const vwapDist = fin(fv.vwap_dist_pct);
  if (orBreak == null && trend == null && vwapDist == null) return null;
  let score = 0.55;
  if (vwapDist != null) {
    const withPlay = direction === "long" ? vwapDist > 0 : vwapDist < 0;
    score += withPlay ? 0.2 : -0.25;
  }
  if (trend === "up" || trend === "down") {
    const withTrend = (trend === "up") === (direction === "long");
    score += withTrend ? 0.12 : -0.18;
  }
  if (orBreak && orBreak !== "inside") {
    const orWith = (orBreak === "above") === (direction === "long");
    score += orWith ? 0.1 : -0.12;
  }
  const parts = [
    vwapDist != null ? `VWAP ${vwapDist > 0 ? "+" : ""}${vwapDist}%` : null,
    orBreak ? `OR ${orBreak}` : null,
    trend ? `${trend} trend` : null,
  ].filter(Boolean);
  return { score: clamp01(score), label: parts.join(" · ") || "structure" };
}

function darkPoolScore(
  direction: "long" | "short",
  bias: string | null | undefined,
): { score: number; label: string } | null {
  if (!bias) return null;
  const b = bias.toLowerCase();
  if (b === "mixed") return { score: 0.5, label: "mixed" };
  const bull = b.includes("bull");
  const bear = b.includes("bear");
  if (!bull && !bear) return { score: 0.5, label: bias };
  const ok = direction === "long" ? bull : bear;
  return { score: ok ? 0.85 : 0.15, label: bias };
}

function relVolumeScore(rv: number | null | undefined): { score: number; label: string } | null {
  if (rv == null || !Number.isFinite(rv)) return null;
  const score = rv >= 1.5 ? 0.9 : rv >= 1.0 ? 0.7 : rv >= 0.7 ? 0.45 : 0.25;
  return { score, label: `${Math.round(rv * 100) / 100}×` };
}

function momentumScore(
  direction: "long" | "short",
  trend: string | null | undefined,
): { score: number; label: string } | null {
  if (!trend) return null;
  if (trend === "flat") return { score: 0.55, label: "flat" };
  const withPlay = (trend === "up") === (direction === "long");
  return { score: withPlay ? 0.85 : 0.2, label: `${trend} trend` };
}

function volatilityScore(vix: number | null | undefined): { score: number; label: string } | null {
  if (vix == null || !Number.isFinite(vix)) return null;
  // F-1 measured band: calm 15-17 best; elevated 17-20 worse — evidence-only scoring.
  const score = vix < 17 ? 0.85 : vix < 20 ? 0.45 : 0.25;
  return { score, label: `VIX ${vix}` };
}

export function extractCortexSources(entryContext: CommitBlob): CortexSourceLine[] {
  const cortex = entryContext?.cortex as Record<string, unknown> | undefined;
  if (!cortex || cortex.abstained === true) {
    return cortex?.reason
      ? [{ source: "cortex", kind: "absent", detail: String(cortex.reason) }]
      : [];
  }
  const out: CortexSourceLine[] = [];
  const supports = Array.isArray(cortex.supports) ? cortex.supports : [];
  const opposes = Array.isArray(cortex.opposes) ? cortex.opposes : [];
  const vetoes = Array.isArray(cortex.vetoes) ? cortex.vetoes : [];
  const absent = Array.isArray(cortex.absent) ? cortex.absent : [];
  for (const s of supports.slice(0, 4)) {
    const item = s as { source?: string; detail?: string };
    out.push({ source: String(item.source ?? "support"), kind: "support", detail: String(item.detail ?? "") });
  }
  for (const o of opposes.slice(0, 2)) {
    const item = o as { source?: string; detail?: string };
    out.push({ source: String(item.source ?? "oppose"), kind: "oppose", detail: String(item.detail ?? "") });
  }
  for (const v of vetoes.slice(0, 2)) {
    const item = v as { source?: string; detail?: string };
    out.push({ source: String(item.source ?? "veto"), kind: "veto", detail: String(item.detail ?? "") });
  }
  for (const a of absent.slice(0, 3)) {
    out.push({ source: String(a).split(":")[0] ?? "absent", kind: "absent", detail: String(a) });
  }
  return out;
}

/** Evidence-aware weight profile from pinned commit blobs. */
export function buildThesisWeightProfile(
  entryContext: CommitBlob,
  featureVector: FeatureVector,
): Record<ThesisPillarId, number | null> {
  const weights = { ...DEFAULT_WEIGHTS };
  const why = entryContext?.why_now as { reason?: WhyNowReason } | undefined;
  const origins = entryContext?.discovery_origin as string[] | undefined;
  const fb = entryContext?.factor_breakdown as Record<string, number> | undefined;

  if (why?.reason === "accumulation" || origins?.includes("FLOW")) {
    weights.flow += 0.15;
    weights.vwap -= 0.04;
    weights.structure -= 0.02;
  }
  if (origins?.includes("BREAKOUT")) {
    weights.structure += 0.12;
    weights.vwap += 0.06;
    weights.flow -= 0.06;
  }
  if (origins?.includes("PIN")) {
    weights.dealer += 0.12;
    weights.flow -= 0.06;
  }

  if (fb && typeof fb === "object") {
    const total = Object.values(fb).reduce((s, v) => s + (typeof v === "number" ? Math.abs(v) : 0), 0);
    if (total > 0) {
      const map: Record<string, ThesisPillarId> = {
        flow: "flow",
        tech: "structure",
        positioning: "dealer",
        news: "structure",
        smart_money: "flow",
      };
      for (const [k, v] of Object.entries(fb)) {
        if (typeof v !== "number" || v <= 0) continue;
        const pid = map[k];
        if (pid) weights[pid] += (v / total) * 0.2;
      }
    }
  }

  const fv = featureVector ?? {};
  if (fv.fq_score != null) weights.flow += 0.05;
  if (fv.gamma_regime != null) weights.dealer = Math.max(weights.dealer, 0.08);
  if (fv.dark_pool_bias != null) weights.flow += 0.03;

  const cortex = entryContext?.cortex as Record<string, unknown> | undefined;
  if (cortex && cortex.abstained !== true && fin(cortex.score) != null && (cortex.score as number) >= 1) {
    weights.cortex += 0.08;
  }

  return weights;
}

function normalizeWeights(raw: Record<ThesisPillarId, number | null>): Map<ThesisPillarId, number> {
  const out = new Map<ThesisPillarId, number>();
  let sum = 0;
  for (const [id, w] of Object.entries(raw) as [ThesisPillarId, number | null][]) {
    if (w == null || w <= 0) continue;
    out.set(id, w);
    sum += w;
  }
  if (sum <= 0) return out;
  for (const [id, w] of out) out.set(id, w / sum);
  return out;
}

function pillarStatus(commit: number, current: number): ThesisPillarStatus {
  if (current >= commit - 0.05 && current >= 0.75) return current > commit + 0.05 ? "strengthened" : "intact";
  if (current >= commit - 0.2 && current >= 0.45) return "faded";
  if (current < 0.35 && commit >= 0.65) return "lost";
  if (current < commit - 0.25) return "lost";
  return "faded";
}

function healthRung(health: number): { rung: ThesisHealthRung; label: string } {
  if (health >= 90) return { rung: "INTACT", label: "Thesis intact" };
  if (health >= 75) return { rung: "MINOR", label: "Minor deterioration" };
  if (health >= 60) return { rung: "WEAKENING", label: "One important pillar shifted" };
  if (health >= 40) return { rung: "DEGRADED", label: "Multiple pillars weakened" };
  if (health >= 20) return { rung: "BROKEN", label: "Original thesis mostly invalid" };
  return { rung: "OPPOSITE", label: "Trade premise reversed" };
}

function convictionIndex(pillars: ThesisPillarState[]): number {
  if (pillars.length === 0) return 0;
  let sum = 0;
  let w = 0;
  for (const p of pillars) {
    if (p.status === "na") continue;
    sum += p.weight * p.currentScore;
    w += p.weight;
  }
  return w > 0 ? Math.round((sum / w) * 100) : 0;
}

function thesisBreakFromHealth(health: number, rung: ThesisHealthRung, moves: string[]): {
  level: ThesisHealthPayload["thesisBreakLevel"];
  note: string;
} {
  if (health >= 75) return { level: "intact", note: "Entry thesis pillars largely unchanged." };
  if (health >= 40) {
    const top = moves[0] ?? "Key pillars shifted";
    return { level: "warn", note: top };
  }
  if (health >= 0) {
    return { level: "break", note: moves.slice(0, 2).join(" · ") || `${rung} — thesis no longer matches entry.` };
  }
  return { level: "unknown", note: "Insufficient commit context to score thesis health." };
}

/** Format ET stamp for display — "HH:mm ET" portion of committed_at_et when present. */
export function formatComputedEt(nowMs: number): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(nowMs));
  return `${time} ET`;
}

/**
 * Compute thesis health for one working ledger row. Returns null when the row has no
 * entry_context (pre-wire-in legacy) or is not a working position.
 */
export function computeThesisHealth(
  entryContext: CommitBlob,
  featureVector: FeatureVector,
  live: ThesisLiveInputs,
  opts?: { status?: string | null },
): ThesisHealthPayload | null {
  const st = String(opts?.status ?? "").toUpperCase();
  if (!["OPEN", "HOLD", "TRIM"].includes(st)) return null;
  if (!entryContext || typeof entryContext !== "object") return null;

  const direction = live.direction;
  const commitConf = entryContext.confluence as ZeroDteConfluence | undefined;
  const commitFlow = entryContext.flow_accumulation as ZeroDteFlowAccumulation | undefined;
  const commitBias = (entryContext.spy_bias as MarketBias | null) ?? null;
  const commitGamma = (entryContext.gamma_regime as string | null) ?? null;
  const commitCortex = entryContext.cortex as Record<string, unknown> | undefined;

  const setup = live.setup;
  const liveConf = setup ? computeConfluence(setup, live.nowEtMinutes) : null;
  const liveFlow = setup?.flow_accumulation ?? null;
  const liveBias = live.spyBias;

  const rawWeights = buildThesisWeightProfile(entryContext, featureVector);
  const weights = normalizeWeights(rawWeights);

  const pillarDefs: Array<{
    id: ThesisPillarId;
    commit: { score: number; label: string } | null;
    current: { score: number; label: string } | null;
  }> = [];

  // Flow
  pillarDefs.push({
    id: "flow",
    commit: flowScore(direction, commitFlow),
    current: flowScore(direction, liveFlow ?? commitFlow),
  });

  // Tape (SPY bias)
  const commitTape = biasAlignsPlay(commitBias, direction);
  const liveTape = biasAlignsPlay(liveBias ?? commitBias, direction);
  if (commitTape != null) {
    pillarDefs.push({
      id: "tape",
      commit: { score: commitTape, label: fmtBias(commitBias) },
      current: { score: liveTape ?? commitTape, label: fmtBias(liveBias ?? commitBias) },
    });
  }

  // VWAP
  const commitVwap = vwapScore(direction, commitConf?.vwap_ok);
  const liveVwap = setup ? vwapScore(direction, liveConf?.vwap_ok) : commitVwap;
  if (commitVwap != null) {
    pillarDefs.push({
      id: "vwap",
      commit: { score: commitVwap, label: commitConf?.vwap_ok ? "✓ side" : "✗ wrong" },
      current: {
        score: liveVwap ?? commitVwap,
        label: liveConf?.vwap_ok ? "✓ side" : liveConf ? "✗ wrong" : "—",
      },
    });
  }

  // Market align
  const commitMkt = marketScore(commitConf?.market_ok);
  const liveMkt = setup ? marketScore(setup.market_aligned === true) : commitMkt;
  if (commitMkt != null) {
    pillarDefs.push({
      id: "market",
      commit: { score: commitMkt, label: commitConf?.market_ok ? "aligned" : "counter" },
      current: {
        score: liveMkt ?? commitMkt,
        label: setup?.market_aligned === true ? "aligned" : setup ? "counter" : "—",
      },
    });
  }

  // Confluence
  pillarDefs.push({
    id: "confluence",
    commit: confluenceScore(commitConf),
    current: confluenceScore(liveConf ?? commitConf),
  });

  // Cortex
  pillarDefs.push({
    id: "cortex",
    commit: cortexScore(commitCortex),
    current: cortexScore(commitCortex),
  });

  // Dealer
  pillarDefs.push({
    id: "dealer",
    commit: dealerScore(commitGamma),
    current: dealerScore(setup?.gamma_regime ?? commitGamma),
  });

  // Structure (OR/trend) — commit from pinned feature_vector; live from setup intraday
  const fv = featureVector ?? {};
  const commitStruct = structureFromFeatureVector(direction, fv);
  const liveStruct = structureScore(direction, setup?.intraday ?? null);
  if (commitStruct || liveStruct) {
    pillarDefs.push({
      id: "structure",
      commit: commitStruct,
      current: liveStruct ?? commitStruct,
    });
  }

  // Tier B — only when pinned at commit (feature_vector) or live on setup
  const commitDp = (fv.dark_pool_bias as string | null) ?? null;
  const liveDp = setup?.dark_pool_bias ?? commitDp;
  if (commitDp) {
    pillarDefs.push({
      id: "darkpool",
      commit: darkPoolScore(direction, commitDp),
      current: darkPoolScore(direction, liveDp),
    });
  }

  const commitRv = fin(fv.rel_volume);
  const liveRv = fin(setup?.rel_volume) ?? commitRv;
  if (commitRv != null) {
    pillarDefs.push({
      id: "rel_volume",
      commit: relVolumeScore(commitRv),
      current: relVolumeScore(liveRv),
    });
  }

  const commitTrend = (fv.trend_5m as string | null) ?? null;
  const liveTrend = setup?.intraday?.trend_5m ?? commitTrend;
  if (commitTrend) {
    pillarDefs.push({
      id: "momentum",
      commit: momentumScore(direction, commitTrend),
      current: momentumScore(direction, liveTrend ?? undefined),
    });
  }

  const commitVix = fin(fv.vix) ?? fin(entryContext.vix_open as number);
  const liveVix = commitVix;
  if (commitVix != null) {
    pillarDefs.push({
      id: "volatility",
      commit: volatilityScore(commitVix),
      current: volatilityScore(liveVix),
    });
  }

  const pillars: ThesisPillarState[] = [];
  const moves: string[] = [];

  for (const def of pillarDefs) {
    const w = weights.get(def.id);
    if (w == null || w <= 0) continue;
    if (!def.commit || !def.current) {
      pillars.push({
        id: def.id,
        label: PILLAR_LABELS[def.id],
        weight: w,
        commitScore: 0,
        currentScore: 0,
        commitLabel: "n/a",
        currentLabel: "n/a",
        status: "na",
        contributionPts: 0,
        deltaPts: 0,
      });
      continue;
    }

    const status = pillarStatus(def.commit.score, def.current.score);
    const contributionPts = Math.round(w * def.current.score * 1000) / 10;
    const deltaPts = Math.round(w * (def.current.score - def.commit.score) * 1000) / 10;

    if (status === "lost" || status === "faded") {
      moves.push(
        `${PILLAR_LABELS[def.id]}: ${def.commit.label} → ${def.current.label}${deltaPts !== 0 ? ` (${deltaPts >= 0 ? "+" : ""}${deltaPts} pts)` : ""}`,
      );
    } else if (status === "strengthened") {
      moves.push(`${PILLAR_LABELS[def.id]}: strengthened (${def.current.label})`);
    }

    pillars.push({
      id: def.id,
      label: PILLAR_LABELS[def.id],
      weight: w,
      commitScore: def.commit.score,
      currentScore: def.current.score,
      commitLabel: def.commit.label,
      currentLabel: def.current.label,
      status,
      contributionPts,
      deltaPts,
    });
  }

  if (pillars.filter((p) => p.status !== "na").length === 0) return null;

  let health = 0;
  let wSum = 0;
  for (const p of pillars) {
    if (p.status === "na") continue;
    health += p.weight * p.currentScore;
    wSum += p.weight;
  }
  health = wSum > 0 ? Math.round(clamp01(health / wSum) * 100) : 0;

  const entryPillars = pillars.map((p) => ({
    ...p,
    currentScore: p.commitScore,
    currentLabel: p.commitLabel,
  }));
  const entryIndex = convictionIndex(entryPillars);
  const currentIndex = convictionIndex(pillars);
  const delta = currentIndex - entryIndex;

  const { rung, label: rungLabel } = healthRung(health);
  const br = thesisBreakFromHealth(health, rung, moves);

  let advisory = "Hold while thesis health supports the plan.";
  if (health < 40) advisory = "Thesis materially degraded — consider trimming or exiting regardless of price.";
  else if (health < 60) advisory = "Thesis weakening — tighten management; partial trim may be prudent.";
  else if (health < 75) advisory = "Minor thesis drift — monitor pillars; hold if price rails intact.";
  else if (delta > 5) advisory = "Thesis intact with strengthening conviction — let the runner work.";

  return {
    health,
    entryIndex,
    currentIndex,
    delta,
    rung,
    rungLabel,
    pillars,
    cortexSources: extractCortexSources(entryContext),
    moves: moves.length > 0 ? moves : ["All scored pillars unchanged since commit."],
    committedAtEt: typeof entryContext.committed_at_et === "string" ? entryContext.committed_at_et : null,
    computedAtEt: live.computedAtEt,
    advisory,
    thesisBreakLevel: br.level,
    thesisBreakNote: br.note,
  };
}

/** Merge thesis-aware management note with price-based recommendation. */
export function thesisManagementOverlay(
  baseRec: "BUY" | "HOLD" | "TRIM" | "SELL",
  baseNote: string,
  health: ThesisHealthPayload | null | undefined,
  pnlPct: number | null,
): { recommendation: "BUY" | "HOLD" | "TRIM" | "SELL"; recNote: string } {
  if (!health) return { recommendation: baseRec, recNote: baseNote };
  const p = pnlPct ?? 0;

  if (health.health < 25 && baseRec !== "SELL") {
    return {
      recommendation: p > 5 ? "TRIM" : "SELL",
      recNote: `Thesis health ${health.health}% (${health.rungLabel}) — ${health.moves[0] ?? "premise reversed"}. Price ${p >= 0 ? "+" : ""}${p.toFixed(1)}% — exit thesis before price.`,
    };
  }
  if (health.health < 45 && baseRec === "HOLD" && p >= 10) {
    return {
      recommendation: "TRIM",
      recNote: `Price +${p.toFixed(1)}% but thesis health ${health.health}% — ${health.moves[0] ?? "pillars eroded"}. Trim into strength.`,
    };
  }
  if (health.health >= 85 && baseRec === "HOLD" && p > 0) {
    return {
      recommendation: baseRec,
      recNote: `${baseNote} Thesis health ${health.health}% — entry case intact.`,
    };
  }
  if (health.health < 60 && baseRec === "HOLD") {
    return {
      recommendation: baseRec,
      recNote: `${baseNote} Thesis health ${health.health}% — ${health.advisory}`,
    };
  }
  return { recommendation: baseRec, recNote: baseNote };
}
