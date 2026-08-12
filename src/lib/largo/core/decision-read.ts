import type { BieAnswerEnvelope, BieLevel } from "@/lib/bie/answer-envelope";
import type { MarketEvidence } from "./market-evidence";
import { assessEditionActionability } from "./market-evidence";
import { signalRowsFromLevels, type SignalRow } from "@/features/largo/answer/signal-rows";
import { deriveMarketState, deriveActionState, marketStateToBias } from "./market-state";
import { isTradeRecommendationQuestion } from "./trade-question";

/**
 * DECISION READ — deterministic trade-decision surface from validated evidence.
 *
 * When the question asks "what play should I take", the UI leads with THIS object instead of
 * a six-paragraph essay. Built from MarketEvidence + envelope — same instant, no extra IO.
 *
 * PURE AND TOTAL: no IO, no throw.
 */

export type TradeSignalRow = {
  signal: string;
  read: string;
  bias: "bullish" | "bearish" | "neutral" | "unstable";
  glyph: string;
};

export type TradeDecisionRead = {
  ticker: string;
  /** e.g. "NVDA — NO CLEAN FRESH ENTRY YET" */
  headline: string;
  approach: string;
  existingPlay?: { contract: string; originalEntry: string; note: string };
  bearishConfirm?: string;
  overall: string;
  signalRows: TradeSignalRow[];
  actionLabel: string;
};

const GLYPH: Record<TradeSignalRow["bias"], string> = {
  bullish: "🟢 Bullish",
  bearish: "🔴 Bearish",
  neutral: "🟡 Mixed",
  unstable: "🔴 Unstable",
};

function stanceToBias(stance: string, kind?: string): TradeSignalRow["bias"] {
  const s = stance.toLowerCase();
  if (kind === "regime" && /negative|short gamma/i.test(s)) return "unstable";
  if (/bull|long|call/.test(s)) return "bullish";
  if (/bear|short|put/.test(s)) return "bearish";
  return "neutral";
}

function helixReading(basis: string): string {
  const m = /net ([+−-]?\$[\d.]+[KMB]?)/i.exec(basis);
  if (m) return `${m[1]} net calls`.replace("−", "-");
  return basis.slice(0, 48);
}

function levelRows(levels: readonly BieLevel[]): TradeSignalRow[] {
  return signalRowsFromLevels(levels).map((r: SignalRow) => ({
    signal: r.label.replace(/^[📍Γ🧱]\s*/, ""),
    read: r.reading,
    bias: r.bias === "bull" ? "bullish" : r.bias === "bear" ? "bearish" : "neutral",
    glyph: r.bias === "bull" ? "🟢 Bullish" : r.bias === "bear" ? "🔴 Bearish" : "🟡 Mixed",
  }));
}

function systemReadRows(envelope: BieAnswerEnvelope): TradeSignalRow[] {
  const reads = envelope.systemReads?.reads ?? [];
  const out: TradeSignalRow[] = [];
  for (const r of reads) {
    if (r.system === "HELIX") {
      out.push({
        signal: "Helix Flow",
        read: helixReading(r.basis),
        bias: stanceToBias(r.stance),
        glyph: GLYPH[stanceToBias(r.stance)],
      });
    } else if (r.system === "GAMMA") {
      const bias = /negative|short/i.test(r.basis) ? "unstable" : "neutral";
      out.push({
        signal: "Dealer regime",
        read: /negative/i.test(r.basis) ? "Short gamma" : r.basis.split("·")[0]!.trim(),
        bias,
        glyph: GLYPH[bias],
      });
    } else if (r.system === "NIGHT HAWK") {
      out.push({
        signal: "Night Hawk",
        read: /evening edition/i.test(r.basis) ? "Existing thesis" : r.basis,
        bias: stanceToBias(r.stance),
        glyph: GLYPH[stanceToBias(r.stance)],
      });
    } else if (r.system === "VECTOR") {
      out.push({
        signal: "Vector",
        read: r.basis.includes("short") ? "Short / downside structure" : r.basis,
        bias: stanceToBias(r.stance),
        glyph: GLYPH[stanceToBias(r.stance)],
      });
    }
  }
  return out;
}

function mergeSignalRows(levelRows: TradeSignalRow[], sysRows: TradeSignalRow[]): TradeSignalRow[] {
  const out: TradeSignalRow[] = [];
  const seen = new Set<string>();
  const add = (row: TradeSignalRow) => {
    const key = row.signal.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };
  // Preferred order for trade decisions
  for (const name of ["Helix Flow", "Dealer regime", "VWAP", "Gamma flip", "Night Hawk", "Vector"]) {
    const fromSys = sysRows.find((r) => r.signal.toLowerCase() === name.toLowerCase());
    const fromLvl = levelRows.find((r) => r.signal.toLowerCase() === name.toLowerCase());
    if (fromSys) add(fromSys);
    else if (fromLvl) add(fromLvl);
  }
  for (const r of [...sysRows, ...levelRows]) add(r);
  return out;
}

function deriveHeadline(ticker: string, evidence: MarketEvidence, envelope: BieAnswerEnvelope): string {
  if (evidence.preciseRecommendationsBlocked) {
    return `${ticker} — LEVELS WITHHELD (SPOT DISAGREES)`;
  }
  const action = assessEditionActionability(evidence);
  if (action && !action.freshEntry && action.existingThesis) {
    return `${ticker} — NO CLEAN FRESH ENTRY YET`;
  }
  const spot = evidence.spot?.authoritative;
  const vwap = evidence.walls.vwap;
  const flip = evidence.walls.gammaFlip;
  const below =
    spot != null && ((vwap != null && spot < vwap) || (flip != null && spot < flip));
  const vectorBear =
    envelope.systemReads?.reads.find((r) => r.system === "VECTOR")?.stance === "bearish";
  if (below && vectorBear) return `${ticker} — NO CLEAN FRESH ENTRY YET`;
  if (below) return `${ticker} — WAIT FOR STRUCTURE RECLAIM`;
  const state = deriveMarketState(envelope.headline ?? "");
  if (state === "mixed") return `${ticker} — MIXED — NO CLEAN ENTRY`;
  return `${ticker} — REVIEW LEVELS BEFORE ENTRY`;
}

function deriveApproach(evidence: MarketEvidence): string {
  const spot = evidence.spot?.authoritative;
  const vwap = evidence.walls.vwap;
  const flip = evidence.walls.gammaFlip;
  const parts: string[] = [];
  if (vwap != null && flip != null) {
    parts.push(`wait for ${evidence.ticker} to reclaim ${vwap.toFixed(2)}–${flip.toFixed(2)}`);
  } else if (vwap != null) {
    parts.push(`wait for reclaim of VWAP ${vwap.toFixed(2)}`);
  } else if (flip != null) {
    parts.push(`wait for reclaim of gamma flip ${flip.toFixed(2)}`);
  }
  if (parts.length) {
    return `Best approach: ${parts.join(" ")} before treating a call thesis as confirmed.`;
  }
  return "Best approach: confirm structure before sizing new risk.";
}

function deriveBearishConfirm(evidence: MarketEvidence): string | undefined {
  const vwap = evidence.walls.vwap;
  const flip = evidence.walls.gammaFlip;
  if (vwap != null && flip != null) {
    return `Bearish confirmation: continued rejection below VWAP (${vwap.toFixed(2)}) and gamma flip (${flip.toFixed(2)}).`;
  }
  if (vwap != null) return `Bearish confirmation: continued rejection below VWAP (${vwap.toFixed(2)}).`;
  return undefined;
}

function deriveOverall(envelope: BieAnswerEnvelope): string {
  const state = deriveMarketState(envelope.headline ?? "");
  const action = deriveActionState(envelope.headline ?? "");
  const bias = marketStateToBias(state);
  const actionWord =
    action === "wait"
      ? "WAIT FOR CONFIRMATION"
      : action === "actionable"
        ? "ACTIONABLE"
        : action === "scanning"
          ? "SCANNING"
          : "REVIEW";
  const biasWord = bias === "mixed" ? "Mixed" : bias.charAt(0).toUpperCase() + bias.slice(1);
  return `Overall: ${biasWord} → ${actionWord}`;
}

/**
 * Build the decision-first read when this is a trade-recommendation question.
 * Returns null when the question is not a trade ask or evidence is missing.
 */
export function buildTradeDecisionRead(
  question: string | null | undefined,
  envelope: BieAnswerEnvelope,
  evidence: MarketEvidence | null | undefined
): TradeDecisionRead | null {
  if (!isTradeRecommendationQuestion(question) || !evidence?.ticker) return null;

  const ticker = evidence.ticker;
  const lvlRows = levelRows(envelope.levels ?? []);
  const sysRows = systemReadRows(envelope);
  const signalRows = mergeSignalRows(lvlRows, sysRows);

  const action = assessEditionActionability(evidence);
  let existingPlay: TradeDecisionRead["existingPlay"] | undefined;
  if (action?.existingThesis) {
    existingPlay = {
      contract: action.contractLabel,
      originalEntry: action.originalEntry != null ? `$${action.originalEntry.toFixed(2)}` : "—",
      note: action.note,
    };
  }

  const actionLabel =
    evidence.preciseRecommendationsBlocked
      ? "HOLD — SPOT DISAGREES"
      : action && !action.freshEntry
        ? "WAIT FOR CONFIRMATION"
        : deriveActionState(envelope.headline ?? "") === "actionable"
          ? "ACTIONABLE"
          : "WAIT FOR CONFIRMATION";

  return {
    ticker,
    headline: deriveHeadline(ticker, evidence, envelope),
    approach: deriveApproach(evidence),
    existingPlay,
    bearishConfirm: deriveBearishConfirm(evidence),
    overall: deriveOverall(envelope),
    signalRows,
    actionLabel,
  };
}

export { GLYPH as TRADE_BIAS_GLYPH };
