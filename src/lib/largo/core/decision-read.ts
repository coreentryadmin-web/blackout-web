import type { BieAnswerEnvelope, BieLevel } from "@/lib/bie/answer-envelope";
import type { MarketEvidence } from "./market-evidence";
import { assessEditionActionability, assessZerodteBoardState } from "./market-evidence";
import { signalRowsFromLevels, type SignalRow } from "@/features/largo/answer/signal-rows";
import { deriveMarketState, deriveActionState, marketStateToBias } from "./market-state";
import { isPlayQuestion, isZeroDtePlayQuestion } from "./trade-question";

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
  /** 🟡 default; ⚠️ when synthesizing without a board play */
  headlineGlyph: "🟡" | "⚠️";
  approach: string;
  existingPlay?: { contract: string; originalEntry: string; note: string };
  /** Committed 0DTE board play when one exists */
  boardPlay?: { contract: string; status: string; note: string };
  /** Conditional thesis when board is empty but member asked for a 0DTE idea */
  speculativeThesis?: {
    direction: "bullish" | "bearish" | "mixed";
    summary: string;
    factors: string[];
    warning: string;
  };
  bearishConfirm?: string;
  overall: string;
  signalRows: TradeSignalRow[];
  actionLabel: string;
  isSpeculative: boolean;
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
      const noBoard = /no plays|no open plays on 0dte/i.test(r.basis + (r.reason ?? ""));
      out.push({
        signal: "Night Hawk",
        read: noBoard ? "No 0DTE board play" : /evening edition/i.test(r.basis) ? "Existing thesis" : r.basis,
        bias: noBoard ? "unstable" : stanceToBias(r.stance),
        glyph: noBoard ? "⚠️ Not on board" : GLYPH[stanceToBias(r.stance)],
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

function buildSpeculativeThesis(
  evidence: MarketEvidence,
  envelope: BieAnswerEnvelope,
  board: ReturnType<typeof assessZerodteBoardState>
): TradeDecisionRead["speculativeThesis"] {
  const factors: string[] = [];
  if (board.hasEditionPlay) {
    factors.push(
      "Night Hawk evening edition has a pick — different horizon, not today's 0DTE board play."
    );
  }
  const reads = envelope.systemReads?.reads ?? [];

  const helix = reads.find((r) => r.system === "HELIX");
  if (helix) factors.push(`Helix flow: ${helix.basis} (${helix.stance})`);

  const gamma = reads.find((r) => r.system === "GAMMA");
  if (gamma) factors.push(`Dealer regime: ${gamma.basis.split("·")[0]!.trim()}`);

  const spot = evidence.spot?.authoritative;
  const vwap = evidence.walls.vwap;
  const flip = evidence.walls.gammaFlip;
  if (spot != null && vwap != null) {
    factors.push(
      `Spot ${spot.toFixed(2)} vs VWAP ${vwap.toFixed(2)} (${spot >= vwap ? "above" : "below"})`
    );
  }
  if (spot != null && flip != null) {
    factors.push(
      `Spot vs gamma flip ${flip.toFixed(2)} (${spot >= flip ? "above" : "below"})`
    );
  }

  const vector = reads.find((r) => r.system === "VECTOR");
  if (vector) factors.push(`Vector: ${vector.stance} — ${vector.basis.slice(0, 56)}`);

  let bull = 0;
  let bear = 0;
  for (const r of reads) {
    if (r.stance === "bullish") bull++;
    else if (r.stance === "bearish") bear++;
  }
  const direction: "bullish" | "bearish" | "mixed" =
    bull > bear ? "bullish" : bear > bull ? "bearish" : "mixed";

  const summary =
    direction === "mixed"
      ? "Signals are mixed — a 0DTE direction is not clear enough to commit without board confirmation."
      : direction === "bullish"
        ? "A call-side 0DTE could play out IF structure reclaims and flow confirms — not a scanner commit."
        : "A put-side 0DTE could play out IF rejection holds and dealers stay short gamma — not a scanner commit.";

  return {
    direction,
    summary,
    factors,
    warning:
      "⚠️ NOT ON 0DTE BOARD — synthesis from live factors only. The scanner has not committed this name.",
  };
}

function deriveSpeculativeApproach(
  evidence: MarketEvidence,
  thesis: NonNullable<TradeDecisionRead["speculativeThesis"]>
): string {
  const flip = evidence.walls.gammaFlip;
  const vwap = evidence.walls.vwap;
  const trigger =
    vwap != null && flip != null
      ? `reclaim ${vwap.toFixed(2)}–${flip.toFixed(2)}`
      : vwap != null
        ? `reclaim VWAP ${vwap.toFixed(2)}`
        : flip != null
          ? `reclaim gamma flip ${flip.toFixed(2)}`
          : "structure confirms";
  return `Best approach: treat as conditional — ${thesis.summary} Wait for ${trigger} before sizing; this is not a board play until the scanner commits.`;
}

function deriveHeadline(
  ticker: string,
  evidence: MarketEvidence,
  envelope: BieAnswerEnvelope,
  opts: { isSpeculative: boolean; isZeroDte: boolean }
): string {
  if (opts.isSpeculative && opts.isZeroDte) {
    return `${ticker} — NOT ON 0DTE BOARD — CONDITIONAL SETUP`;
  }
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
  if (!isPlayQuestion(question) || !evidence?.ticker) return null;

  const ticker = evidence.ticker;
  const isZeroDte = isZeroDtePlayQuestion(question);
  const board = assessZerodteBoardState(evidence);
  const isSpeculative = isZeroDte && board.consulted && !board.hasOpenPlay;

  const lvlRows = levelRows(envelope.levels ?? []);
  const sysRows = systemReadRows(envelope);
  const signalRows = mergeSignalRows(lvlRows, sysRows);

  const editionAction = assessEditionActionability(evidence);
  let existingPlay: TradeDecisionRead["existingPlay"] | undefined;
  if (editionAction?.existingThesis && !isSpeculative) {
    existingPlay = {
      contract: editionAction.contractLabel,
      originalEntry:
        editionAction.originalEntry != null ? `$${editionAction.originalEntry.toFixed(2)}` : "—",
      note: editionAction.note,
    };
  }

  let boardPlay: TradeDecisionRead["boardPlay"] | undefined;
  if (board.hasOpenPlay && board.openPlays[0]) {
    const p = board.openPlays[0]!;
    const right = /long|call/i.test(p.direction) ? "C" : "P";
    boardPlay = {
      contract:
        p.strike != null && p.expiry ? `${p.expiry} $${p.strike}${right}` : p.direction,
      status: String(p.status ?? "OPEN"),
      note: "Committed on 0DTE Command board — revalidate mark and spread before entry.",
    };
  }

  const speculativeThesis = isSpeculative
    ? buildSpeculativeThesis(evidence, envelope, board)
    : undefined;

  const actionLabel = evidence.preciseRecommendationsBlocked
    ? "HOLD — SPOT DISAGREES"
    : isSpeculative
      ? "⚠️ SYNTHESIS ONLY — NOT ON BOARD"
      : boardPlay
        ? "ON 0DTE BOARD"
        : editionAction && !editionAction.freshEntry
          ? "WAIT FOR CONFIRMATION"
          : deriveActionState(envelope.headline ?? "") === "actionable"
            ? "ACTIONABLE"
            : "WAIT FOR CONFIRMATION";

  const approach = speculativeThesis
    ? deriveSpeculativeApproach(evidence, speculativeThesis)
    : deriveApproach(evidence);

  const headlineGlyph: TradeDecisionRead["headlineGlyph"] = isSpeculative ? "⚠️" : "🟡";

  return {
    ticker,
    headline: deriveHeadline(ticker, evidence, envelope, { isSpeculative, isZeroDte }),
    headlineGlyph,
    approach,
    existingPlay,
    boardPlay,
    speculativeThesis,
    bearishConfirm: deriveBearishConfirm(evidence),
    overall: isSpeculative
      ? `Overall: ${speculativeThesis!.direction === "mixed" ? "Mixed" : speculativeThesis!.direction === "bullish" ? "Bullish lean" : "Bearish lean"} → ⚠️ NOT ON BOARD`
      : deriveOverall(envelope),
    signalRows,
    actionLabel,
    isSpeculative,
  };
}

export { GLYPH as TRADE_BIAS_GLYPH };
