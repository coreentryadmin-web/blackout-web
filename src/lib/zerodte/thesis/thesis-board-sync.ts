import type { DiscoveryOrigin, EnrichedZeroDteSetup } from "../board";
import { unionDiscoveryOrigins } from "../board";
import type { MergedThesis, ThesisRail } from "./types";

/** Map thesis rail → legacy board discovery origin (PIN ↔ POSITIONING). */
export function railToDiscoveryOrigin(rail: ThesisRail): DiscoveryOrigin | null {
  switch (rail) {
    case "FLOW":
      return "FLOW";
    case "BREAKOUT":
      return "BREAKOUT";
    case "POSITIONING":
      return "PIN";
    default:
      return null;
  }
}

function discoveryOriginsFromThesis(thesis: MergedThesis): DiscoveryOrigin[] {
  const out: DiscoveryOrigin[] = [];
  for (const rail of thesis.rails_fired) {
    const o = railToDiscoveryOrigin(rail);
    if (o) out.push(o);
  }
  for (const d of thesis.disagreeing_rails) {
    const o = railToDiscoveryOrigin(d.rail);
    if (o && !out.includes(o)) out.push(o);
  }
  return out;
}

/**
 * G1 partial — after thesis merge, align the board setup's discovery view with MergedThesis.
 * Thesis merge is authoritative for direction + multi-rail union; board merge stays for
 * condor geometry / flow evidence until full unification lands.
 */
export function syncSetupDiscoveryFromThesis(
  setup: EnrichedZeroDteSetup,
  thesis: MergedThesis
): void {
  if (setup.direction !== thesis.direction) {
    setup.direction = thesis.direction;
  }

  const fromThesis = discoveryOriginsFromThesis(thesis);
  if (fromThesis.length > 0) {
    setup.discovery_origin = unionDiscoveryOrigins(setup.discovery_origin ?? [], fromThesis);
  }

  if (thesis.disagreeing_rails.length > 0) {
    const top = [...thesis.disagreeing_rails].sort((a, b) => b.score - a.score)[0]!;
    const maskedOrigin = railToDiscoveryOrigin(top.rail);
    if (!setup.origin_direction_conflict && maskedOrigin) {
      setup.origin_direction_conflict = {
        kept_direction: thesis.direction,
        masked_direction: top.direction,
        masked_origin: [maskedOrigin],
      };
    }
  }
}
