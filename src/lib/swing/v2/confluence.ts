/**
 * Swing Engine V2 confluence — independent signal-kind agreement gate.
 *
 * Mirror of zerodte/confluence.ts for multi-day holds: COMMIT requires ≥N independent
 * kinds (FLOW, STRUCTURE, POSITIONING, CATALYST, RS, VECTOR) not a single loud pillar.
 *
 * P2: evaluate only (shadow log). P3: enforce at commit via gates.ts.
 */

import type { SwingDiscoveryPath } from "../discovery";
import type { SwingArchetype } from "../taxonomy";

export type SwingConfluenceKind = SwingDiscoveryPath | "RS" | "VECTOR";

const EVENT_ARCHETYPES = new Set<SwingArchetype>(["POST_EARNINGS_DRIFT", "EVENT_DRIVEN"]);

/** Map Tier-0 paths + optional enrich flags to confluence kinds. */
export function swingConfluenceKinds(
  paths: readonly SwingDiscoveryPath[],
  extras?: { rsTopQuartile?: boolean; vectorAligned?: boolean },
): SwingConfluenceKind[] {
  const kinds = new Set<SwingConfluenceKind>(paths);
  if (extras?.rsTopQuartile) kinds.add("RS");
  if (extras?.vectorAligned) kinds.add("VECTOR");
  return [...kinds];
}

export interface SwingConfluenceVerdict {
  kinds: SwingConfluenceKind[];
  count: number;
  required: number;
  pass: boolean;
  label: string;
}

/** Required independent kinds for COMMIT eligibility (shadow / P3 gate). */
export function requiredSwingConfluenceCount(archetype: SwingArchetype | null | undefined): number {
  if (archetype && EVENT_ARCHETYPES.has(archetype)) {
    return 2; // event archetypes: CATALYST + 1 other
  }
  return 3; // standard multi-session thesis
}

export function evaluateSwingConfluence(
  paths: readonly SwingDiscoveryPath[],
  archetype: SwingArchetype | null | undefined,
  extras?: { rsTopQuartile?: boolean; vectorAligned?: boolean },
): SwingConfluenceVerdict {
  const kinds = swingConfluenceKinds(paths, extras);
  const required = requiredSwingConfluenceCount(archetype);
  const count = kinds.length;
  const pass = count >= required;
  const label = pass
    ? `${count}/${required} kinds agree (${kinds.join("+")})`
    : `needs ${required - count} more kind(s) — have ${kinds.join("+") || "none"}`;
  return { kinds, count, required, pass, label };
}
