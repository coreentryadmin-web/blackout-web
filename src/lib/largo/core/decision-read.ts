import type { BieAnswerEnvelope, BieLevel } from "@/lib/bie/answer-envelope";
import type { MarketEvidence } from "./market-evidence";
import { assessEditionActionability, assessZerodteBoardState } from "./market-evidence";
import { signalRowsFromLevels, type SignalRow } from "@/features/largo/answer/signal-rows";
import { deriveActionState } from "./market-state";
import { isPlayQuestion, isZeroDtePlayQuestion } from "./trade-question";

/**
 * TRADE SUPPLEMENT — integrity badges and board context ONLY.
 *
 * The model's Verdict / Interpretation / Bottom line are the answer. This object adds
 * non-negotiable honesty flags (spot hold, not on board, edition vs ledger) without
 * replacing what the model wrote for this specific question.
 *
 * PURE AND TOTAL: no IO, no throw.
 */

export type TradeSignalRow = {
  signal: string;
  read: string;
  bias: "bullish" | "bearish" | "neutral" | "unstable";
  glyph: string;
};

/** @deprecated use TradeSupplement fields — kept for envelope compat */
export type TradeDecisionRead = TradeSupplement & {
  ticker: string;
  headline?: string;
  headlineGlyph?: "🟡" | "⚠️";
  approach?: string;
  overall?: string;
  bearishConfirm?: string;
  speculativeThesis?: {
    direction: "bullish" | "bearish" | "mixed";
    summary: string;
    factors: string[];
    warning: string;
  };
};

export type TradeSupplement = {
  ticker: string;
  /** Short integrity chip — spot hold, not on board, etc. Never replaces the Verdict. */
  actionLabel?: string;
  /** One-line warning when 0DTE board has no committed play for this name. */
  notOnBoardWarning?: string;
  existingPlay?: { contract: string; originalEntry: string; note: string };
  boardPlay?: { contract: string; status: string; note: string };
  /** Fallback signal table when the model omitted a comparison block. */
  signalRows: TradeSignalRow[];
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
      const noBoard = /no plays|no open plays on 0dte/i.test(`${r.basis} ${r.reason ?? ""}`);
      out.push({
        signal: "Night Hawk",
        read: noBoard ? "No 0DTE board play" : /evening edition/i.test(r.basis) ? "Edition pick" : r.basis,
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

function mergeSignalRows(lvlRows: TradeSignalRow[], sysRows: TradeSignalRow[]): TradeSignalRow[] {
  const out: TradeSignalRow[] = [];
  const seen = new Set<string>();
  const add = (row: TradeSignalRow) => {
    const key = row.signal.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };
  for (const name of ["Helix Flow", "Dealer regime", "VWAP", "Gamma flip", "Night Hawk", "Vector"]) {
    const fromSys = sysRows.find((r) => r.signal.toLowerCase() === name.toLowerCase());
    const fromLvl = lvlRows.find((r) => r.signal.toLowerCase() === name.toLowerCase());
    if (fromSys) add(fromSys);
    else if (fromLvl) add(fromLvl);
  }
  for (const r of [...sysRows, ...lvlRows]) add(r);
  return out;
}

/**
 * Build supplementary trade context — does NOT replace model prose.
 */
export function buildTradeDecisionRead(
  question: string | null | undefined,
  envelope: BieAnswerEnvelope,
  evidence: MarketEvidence | null | undefined,
  opts?: { hasComparisonBlock?: boolean }
): TradeSupplement | null {
  if (!isPlayQuestion(question) || !evidence?.ticker) return null;

  const ticker = evidence.ticker;
  const isZeroDte = isZeroDtePlayQuestion(question);
  const board = assessZerodteBoardState(evidence);
  const isSpeculative = isZeroDte && board.consulted && !board.hasOpenPlay;

  const signalRows = opts?.hasComparisonBlock
    ? []
    : mergeSignalRows(levelRows(envelope.levels ?? []), systemReadRows(envelope));

  const editionAction = assessEditionActionability(evidence);
  let existingPlay: TradeSupplement["existingPlay"] | undefined;
  if (editionAction?.existingThesis) {
    existingPlay = {
      contract: editionAction.contractLabel,
      originalEntry:
        editionAction.originalEntry != null ? `$${editionAction.originalEntry.toFixed(2)}` : "—",
      note: editionAction.note,
    };
  }

  let boardPlay: TradeSupplement["boardPlay"] | undefined;
  if (board.hasOpenPlay && board.openPlays[0]) {
    const p = board.openPlays[0]!;
    const right = /long|call/i.test(p.direction) ? "C" : "P";
    boardPlay = {
      contract: p.strike != null && p.expiry ? `${p.expiry} $${p.strike}${right}` : p.direction,
      status: String(p.status ?? "OPEN"),
      note: "On 0DTE Command board — revalidate mark and spread before entry.",
    };
  }

  let actionLabel: string | undefined;
  if (evidence.preciseRecommendationsBlocked) {
    actionLabel = "SPOT SOURCES DISAGREE";
  } else if (isSpeculative) {
    actionLabel = "NOT ON 0DTE BOARD";
  } else if (boardPlay) {
    actionLabel = "ON 0DTE BOARD";
  } else if (editionAction && !editionAction.freshEntry) {
    actionLabel = "EXISTING THESIS";
  } else if (deriveActionState(envelope.headline ?? "") === "actionable") {
    actionLabel = "ACTIONABLE";
  }

  const notOnBoardWarning = isSpeculative
    ? "⚠️ No committed 0DTE board play for this name — any setup below is conditional synthesis, not a scanner commit."
    : undefined;

  return {
    ticker,
    actionLabel,
    notOnBoardWarning,
    existingPlay: boardPlay ? undefined : existingPlay,
    boardPlay,
    signalRows,
    isSpeculative,
  };
}

export { GLYPH as TRADE_BIAS_GLYPH };
