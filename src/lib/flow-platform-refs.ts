import { flowTapeCacheTtlMs } from "@/lib/providers/config";
import { withServerCache } from "@/lib/server-cache";
import { marketPlatform } from "@/lib/platform";

export type FlowPlatformRefs = {
  spx: Awaited<ReturnType<typeof marketPlatform.spx.getSpxDeskSummary>> | null;
  nighthawk: Awaited<ReturnType<typeof marketPlatform.nighthawk.getLatestNightHawkSummary>> | null;
};

/** Lightweight cross-tool refs for HELIX tape — cached separately so flow rows never wait on a desk rebuild. */
export async function getFlowPlatformRefs(): Promise<FlowPlatformRefs> {
  return withServerCache(
    "flows:platform-refs:v1",
    flowTapeCacheTtlMs(),
    async () => {
      const [spx, nighthawk] = await Promise.all([
        marketPlatform.spx.getSpxDeskSummary().catch(() => null),
        marketPlatform.nighthawk.getLatestNightHawkSummary().catch(() => null),
      ]);
      return { spx, nighthawk };
    },
    { staleWhileRevalidate: true }
  );
}
