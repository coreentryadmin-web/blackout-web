import { buildExpectedVsRealized } from "@/lib/meridian/meridian-analytics-core";
import type { MeridianEarningsEnrichment } from "@/features/meridian/lib/meridian-types";

/** Patch expected-vs-realized once the pack's chain IV move is known. */
export function patchMeridianEnrichmentExpectedMove(
  enrichment: MeridianEarningsEnrichment,
  expectedMovePct: number | null | undefined
): MeridianEarningsEnrichment {
  if (expectedMovePct == null || !Number.isFinite(expectedMovePct)) return enrichment;
  const lastPrint = enrichment.print_history[0];
  return {
    ...enrichment,
    expected_vs_realized: buildExpectedVsRealized(
      expectedMovePct,
      // The REALIZED side must be the reaction. An options-implied move prices the whole
      // repricing event, so comparing it against the anchor session's open→close — which for a
      // post-close print excludes the overnight gap — understates realized against implied by
      // construction. `reaction_pct` is the like-for-like quantity.
      lastPrint?.reaction_pct ?? lastPrint?.session_change_pct ?? null
    ),
  };
}
