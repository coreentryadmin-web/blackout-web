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

/** Evaluate enforced V2 commit gates. Returns failing gates only (empty ⇒ pass). */
export function failingSwingCommitGates(
  input: SwingCommitGateInput,
  opts: { enforceConfluence?: boolean } = {},
): SwingGateVerdict[] {
  const out: SwingGateVerdict[] = [];
  if (opts.enforceConfluence) {
    const g6 = evaluateConfluenceGate(input);
    if (!g6.pass) out.push(g6);
  }
  return out;
}

/** Map gate failures to commit `blockedBy` tokens (queryable in ledger / ops). */
export function blockedByFromSwingGates(failures: readonly SwingGateVerdict[]): string[] {
  return failures.map((f) => `gate:${f.gate}:${f.gate === "G-S6" ? "confluence" : "cortex"}`);
}
