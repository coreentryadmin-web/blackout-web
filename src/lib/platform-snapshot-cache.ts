import { getPlatformSnapshot, type PlatformServiceId } from "@/lib/platform";
import { platformSnapshotCacheTtlMs } from "@/lib/providers/config";
import { withServerCache } from "@/lib/server-cache";

function snapshotCacheKey(opts?: {
  include?: PlatformServiceId[];
  flowLimit?: number;
  fullEdition?: boolean;
}): string {
  const include = opts?.include ?? ["spx", "flows", "nighthawk"];
  const flowLimit = opts?.flowLimit ?? 50;
  const fullEdition = opts?.fullEdition ? 1 : 0;
  return `platform:snapshot:${include.join(",")}:${flowLimit}:${fullEdition}`;
}

/** Cross-service snapshot with SWR — never blocks members on a cold multi-lane rebuild. */
export async function getCachedPlatformSnapshot(opts?: {
  include?: PlatformServiceId[];
  flowLimit?: number;
  fullEdition?: boolean;
}) {
  const key = snapshotCacheKey(opts);
  return withServerCache(
    key,
    platformSnapshotCacheTtlMs(),
    () => getPlatformSnapshot(opts),
    { staleWhileRevalidate: true }
  );
}
