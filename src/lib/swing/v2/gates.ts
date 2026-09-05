/**
 * Swing Engine V2 commit gates — G-S1..G-S14 (P3 scaffold).
 *
 * P3 ships G-S3 earnings + G-S4 regime + G-S6 confluence + G-S12 halt/LULD + G-S14 Cortex enforce LIVE when V2 is on.
 * G-S14 Cortex(swing) lands when fetch.ts gains swing horizon profile (design §9).
 */

import type { SwingDiscoveryPath } from "../discovery";
import type { SwingArchetype } from "../taxonomy";
import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";
import { evaluateSwingConfluence } from "./confluence";
import { isRegimeDegradedForCommit, regimeBandFor01 } from "./regime";

export type SwingGateId =
  | "G-S3"
  | "G-S4"
  | "G-S6"
  | "G-S12"
  | "G-S14"
  | "QUOTE_STALE"
  | "DAILY_BAR";

export interface SwingGateVerdict {
  gate: SwingGateId;
  pass: boolean;
  reason: string;
  /** Stable commit `blockedBy` token when `pass` is false. */
  token?: string;
}

export interface SwingCommitGateInput {
  discoveryPaths: readonly SwingDiscoveryPath[];
  archetype: SwingArchetype | null | undefined;
  extras?: { rsTopQuartile?: boolean; vectorAligned?: boolean };
  /** From catalyst reads — when true, COMMIT blocked unless eventAuthorized. */
  earningsInWindow?: boolean | null;
  eventAuthorized?: boolean | null;
  /** Per-ticker ACTIVE halt (UW + LULD ingest). */
  halted?: boolean | null;
  /** Global: BOTH UW and LULD halt sources stale — fail-closed when enabled. */
  haltFeedStale?: boolean | null;
  /** REGIME pillar (0–1, direction-aligned) — G-S4 when enforced. */
  regime01?: number | null;
  /** Contract quote age in ms — when known and > max, blocks COMMIT (legacy quote_stale). */
  quoteAgeMs?: number | null;
  quoteMaxAgeMs?: number;
  /** False ⇒ reference daily bar has not closed — blocks COMMIT (legacy daily_bar_incomplete). */
  dailyBarComplete?: boolean | null;
}

/** Default quote staleness ceiling — matches legacy `gates.ts`. */
export const SWING_QUOTE_MAX_AGE_MS = 5 * 60 * 1000;

/** Phase-0 firewall kill-switch: G-S12 fails a fresh commit closed when the halt FEED is cold.
 *  ON by default; set SWING_GS12_HALT_FAIL_CLOSED=0 to disable (mirrors ZERODTE_G11_HALT_FAIL_CLOSED). */
export const GS12_HALT_FAIL_CLOSED_ENABLED = process.env.SWING_GS12_HALT_FAIL_CLOSED !== "0";

/** G-S6 — independent signal-kind confluence (≥3 standard, ≥2 event). */
export function evaluateConfluenceGate(input: SwingCommitGateInput): SwingGateVerdict {
  const verdict = evaluateSwingConfluence(input.discoveryPaths, input.archetype, input.extras);
  return {
    gate: "G-S6",
    pass: verdict.pass,
    reason: verdict.pass ? verdict.label : `G-S6 confluence: ${verdict.label}`,
    token: verdict.pass ? undefined : "gate:G-S6:confluence",
  };
}

/** Map regime band to a queryable blockedBy token. */
export function blockedByTokenForRegime(regime01: number | null | undefined): string {
  return regimeBandFor01(regime01) === "UNKNOWN" ? "gate:G-S4:regime_unknown" : "gate:G-S4:regime_degraded";
}

/** G-S4 — degraded broad-market regime blocks COMMIT (WATCH rail only). */
export function evaluateRegimeGate(input: SwingCommitGateInput): SwingGateVerdict {
  const degraded = isRegimeDegradedForCommit(input.regime01 ?? null);
  const band = regimeBandFor01(input.regime01 ?? null);
  return {
    gate: "G-S4",
    pass: !degraded,
    reason: degraded
      ? `G-S4 regime: ${band} — degraded tape blocks new COMMIT (WATCH only)`
      : `G-S4 regime: ${band} — clear`,
    token: degraded ? blockedByTokenForRegime(input.regime01 ?? null) : undefined,
  };
}

/** G-S3 — earnings/binary inside holding window blocks COMMIT unless explicitly authorized.
 *  This is swing's print-protection gate (deep-dive Q11): Cortex preflight does not read earnings dates;
 *  G-S3 is the authoritative COMMIT-time block for binary-gap risk inside the thesis holding window. */
export function evaluateEarningsGate(input: SwingCommitGateInput): SwingGateVerdict {
  const inWindow = input.earningsInWindow === true;
  const pass = !inWindow || input.eventAuthorized === true;
  return {
    gate: "G-S3",
    pass,
    reason: pass
      ? "G-S3 earnings: clear"
      : "G-S3 earnings: print inside holding window — block COMMIT (binary-gap risk)",
    token: pass ? undefined : "gate:G-S3:earnings_in_window",
  };
}

/** G-S12 — halt/LULD: ACTIVE halt always blocks; cold halt feed fails closed when enabled. */
export function evaluateHaltGate(input: SwingCommitGateInput): SwingGateVerdict {
  if (input.halted === true) {
    return {
      gate: "G-S12",
      pass: false,
      reason: "G-S12 halt: underlying halted — block COMMIT until trading resumes",
      token: "gate:G-S12:halted",
    };
  }
  if (input.haltFeedStale === true && GS12_HALT_FAIL_CLOSED_ENABLED) {
    return {
      gate: "G-S12",
      pass: false,
      reason:
        "G-S12 halt: trading-halt feed cold (UW + LULD stale) — fail closed rather than commit blind past a possible halt",
      token: "gate:G-S12:halt_feed_stale",
    };
  }
  return {
    gate: "G-S12",
    pass: true,
    reason: "G-S12 halt: clear",
  };
}

/** Quote freshness — transient stale quote blocks COMMIT (WATCH rail). Unknown age passes (fail-open). */
export function evaluateQuoteStaleGate(input: SwingCommitGateInput): SwingGateVerdict {
  const maxAge = input.quoteMaxAgeMs ?? SWING_QUOTE_MAX_AGE_MS;
  const age = input.quoteAgeMs;
  if (age == null || !Number.isFinite(age)) {
    return { gate: "QUOTE_STALE", pass: true, reason: "quote freshness: age unknown — pass" };
  }
  // Fail-closed on clock-skewed future quote stamps (same tolerance as GEX / WS freshness).
  if (age < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS) {
    return {
      gate: "QUOTE_STALE",
      pass: false,
      reason: "quote freshness: quote timestamp skewed into the future — WATCH until fresh",
      token: "gate:quote_stale",
    };
  }
  const pass = age <= maxAge;
  return {
    gate: "QUOTE_STALE",
    pass,
    reason: pass
      ? "quote freshness: clear"
      : `quote freshness: quote ${Math.round(age / 1000)}s old > max ${Math.round(maxAge / 1000)}s — WATCH until fresh`,
    token: pass ? undefined : "gate:quote_stale",
  };
}

/** Daily bar completeness — open session reference bar blocks COMMIT until close. */
export function evaluateDailyBarGate(input: SwingCommitGateInput): SwingGateVerdict {
  const pass = input.dailyBarComplete !== false;
  return {
    gate: "DAILY_BAR",
    pass,
    reason: pass
      ? "daily bar: clear"
      : "daily bar: reference daily bar has not closed — WATCH until session settles",
    token: pass ? undefined : "gate:daily_bar_incomplete",
  };
}

/** Evaluate enforced V2 commit gates. Returns failing gates only (empty ⇒ pass). */
export function failingSwingCommitGates(
  input: SwingCommitGateInput,
  opts: {
    enforceConfluence?: boolean;
    enforceEarnings?: boolean;
    enforceHalt?: boolean;
    enforceRegime?: boolean;
    enforceQuoteStale?: boolean;
    enforceDailyBar?: boolean;
  } = {},
): SwingGateVerdict[] {
  const out: SwingGateVerdict[] = [];
  if (opts.enforceEarnings) {
    const g3 = evaluateEarningsGate(input);
    if (!g3.pass) out.push(g3);
  }
  if (opts.enforceHalt) {
    const g12 = evaluateHaltGate(input);
    if (!g12.pass) out.push(g12);
  }
  if (opts.enforceRegime) {
    const g4 = evaluateRegimeGate(input);
    if (!g4.pass) out.push(g4);
  }
  if (opts.enforceConfluence) {
    const g6 = evaluateConfluenceGate(input);
    if (!g6.pass) out.push(g6);
  }
  if (opts.enforceQuoteStale) {
    const gq = evaluateQuoteStaleGate(input);
    if (!gq.pass) out.push(gq);
  }
  if (opts.enforceDailyBar) {
    const gd = evaluateDailyBarGate(input);
    if (!gd.pass) out.push(gd);
  }
  return out;
}

/** Map gate failures to commit `blockedBy` tokens (queryable in ledger / ops). */
export function blockedByFromSwingGates(failures: readonly SwingGateVerdict[]): string[] {
  return failures.map((f) => {
    if (f.token) return f.token;
    if (f.gate === "G-S6") return "gate:G-S6:confluence";
    if (f.gate === "G-S3") return "gate:G-S3:earnings_in_window";
    if (f.gate === "G-S12") {
      return f.reason.includes("feed cold")
        ? "gate:G-S12:halt_feed_stale"
        : "gate:G-S12:halted";
    }
    if (f.gate === "G-S4") return "gate:G-S4:regime_degraded";
    if (f.gate === "QUOTE_STALE") return "gate:quote_stale";
    if (f.gate === "DAILY_BAR") return "gate:daily_bar_incomplete";
    return "gate:G-S14:cortex";
  });
}
