import { prefetchLargoLiveFeed } from "@/lib/bie/largo-live-prefetch";
import { pickLargoStatusLine } from "@/lib/bie/largo-status";

export type LargoTurnPipelineOpts = {
  onStatus?: (message: string) => void;
};

/** Warm shared platform caches before every Claude Largo turn. */
export async function prefetchLargoTurnCaches(opts: LargoTurnPipelineOpts = {}): Promise<void> {
  const { onStatus } = opts;
  onStatus?.(pickLargoStatusLine({ phase: "boot", index: 0 }));
  await prefetchLargoLiveFeed({ onStatus });
  onStatus?.(pickLargoStatusLine({ phase: "boot", index: 1 }));
}
