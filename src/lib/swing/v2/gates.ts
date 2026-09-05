/**
 * Swing Engine V2 commit gates — G-S1..G-S14 (P3 scaffold).
 *
 * P3 ships G-S6 confluence + G-S14 Cortex enforce LIVE when V2 is on (opt-out via env).
 * G-S14 Cortex(swing) lands when fetch.ts gains swing horizon profile (design §9).
 */

import type { SwingDiscoveryPath } from "../discovery";
import type { SwingArchetype } from "../taxonomy";
import { evaluateSwingConfluence } from "./confluence";

export type SwingGateId =
  | "G-S3"
  | "G-S6"
  | "G-S14";

export interface SwingGateVerdict {
  gate: SwingGateId;
  pass: boolean;
  reason: string;
}

export interface SwingCommitGateInput {
  discoveryPaths: readonly SwingDiscoveryPath[];
  archetype: SwingArchetype | null | undefined;
  extras?: { rsTopQuartile?: boolean; vectorAligned?: boolean };
  /** From catalyst reads — when true, COMMIT blocked unless eventAuthorized. */
  earningsInWindow?: boolean | null;
  eventAuthorized?: boolean | null;
}

/** G-S6 — independent signal-kind confluence (≥3 standard, ≥2 event). */
export function evaluateConfluenceGate(input: SwingCommitGateInput): SwingGateVerdict {
  const verdict = evaluateSwingConfluence(input.discoveryPaths, input.archetype, input.extras);
  return {
    gate: "G-S6",
    pass: verdict.pass,
    reason: verdict.pass ? verdict.label : `G-S6 confluence: ${verdict.label}`,
  };
}

/** G-S3 — earnings/binary inside holding window blocks COMMIT unless explicitly authorized. */
export function evaluateEarningsGate(input: SwingCommitGateInput): SwingGateVerdict {
  const inWindow = input.earningsInWindow === true;
  const pass = !inWindow || input.eventAuthorized === true;
  return {
    gate: "G-S3",
    pass,
    reason: pass
      ? "G-S3 earnings: clear"
      : "G-S3 earnings: print inside holding window — block COMMIT (binary-gap risk)",
  };
}

/** Evaluate enforced V2 commit gates. Returns failing gates only (empty ⇒ pass). */
export function failingSwingCommitGates(
  input: SwingCommitGateInput,
  opts: { enforceConfluence?: boolean; enforceEarnings?: boolean } = {},
): SwingGateVerdict[] {
  const out: SwingGateVerdict[] = [];
  if (opts.enforceEarnings) {
    const g3 = evaluateEarningsGate(input);
    if (!g3.pass) out.push(g3);
  }
  if (opts.enforceConfluence) {
    const g6 = evaluateConfluenceGate(input);
    if (!g6.pass) out.push(g6);
  }
  return out;
}

/** Map gate failures to commit `blockedBy` tokens (queryable in ledger / ops). */
export function blockedByFromSwingGates(failures: readonly SwingGateVerdict[]): string[] {
  return failures.map((f) => {
    if (f.gate === "G-S6") return "gate:G-S6:confluence";
    if (f.gate === "G-S3") return "gate:G-S3:earnings_in_window";
    return "gate:G-S14:cortex";
  });
}
