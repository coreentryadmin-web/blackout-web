import type { Tier } from "@/lib/tiers";
import type { ToolKey } from "@/lib/tool-access";

/**
 * Minimum Tier required to open each desk — MUST mirror the `requireDeskTool`/`requireTier`
 * call in that desk's `src/app/(site)/<slug>/layout.tsx`. Verified against those layout files
 * by `desk-tier-requirements.test.ts` (source-text scan, same defensive pattern
 * `desk-protected-route-coverage.test.ts` already uses for the protected-route lists) so this
 * manifest cannot silently drift from the gate a desk actually enforces — which is exactly the
 * failure mode that let the pricing comparison table hand-type its Free/Premium booleans with
 * no way to check them against reality.
 */
export const DESK_TIER_REQUIREMENTS: Record<ToolKey, Tier> = {
  spx: "community",
  flows: "premium",
  heatmap: "premium",
  largo: "premium",
  nighthawk: "premium",
  vector: "premium",
  meridian: "premium",
};
