/**
 * Swing Engine V2 confluence — independent signal-kind agreement gate.
 *
 * Mirror of zerodte/confluence.ts for multi-day holds: COMMIT requires ≥N independent
 * kinds (FLOW, STRUCTURE, POSITIONING, CATALYST, RS, VECTOR) not a single loud pillar.
 *
 * P2+: evaluate + enforce at commit via gates.ts (G-S6 live when V2 on).
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

/** Required independent kinds for COMMIT eligibility (G-S6). */
export function requiredSwingConfluenceCount(archetype: SwingArchetype | null | undefined): number {
  if (archetype && EVENT_ARCHETYPES.has(archetype)) {
    return 2; // event archetypes: CATALYST + 1 other
  }
  return 3; // standard multi-session thesis
}

/** Event archetypes require a discrete CATALYST signal kind (Tier-0 path or grounded pillar). */
export function eventArchetypeRequiresCatalystKind(archetype: SwingArchetype | null | undefined): boolean {
  return archetype != null && EVENT_ARCHETYPES.has(archetype);
}

export function evaluateSwingConfluence(
  paths: readonly SwingDiscoveryPath[],
  archetype: SwingArchetype | null | undefined,
  extras?: { rsTopQuartile?: boolean; vectorAligned?: boolean },
): SwingConfluenceVerdict {
  const kinds = swingConfluenceKinds(paths, extras);
  const required = requiredSwingConfluenceCount(archetype);
  const count = kinds.length;
  const hasCatalystKind = kinds.includes("CATALYST");
  const catalystOk = !eventArchetypeRequiresCatalystKind(archetype) || hasCatalystKind;
  const pass = count >= required && catalystOk;
  const label = !catalystOk
    ? `event archetype needs CATALYST kind + 1 other — have ${kinds.join("+") || "none"}`
    : pass
      ? `${count}/${required} kinds agree (${kinds.join("+")})`
      : `needs ${required - count} more kind(s) — have ${kinds.join("+") || "none"}`;
  return { kinds, count, required, pass, label };
}
