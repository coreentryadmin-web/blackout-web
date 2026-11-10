import type { GexPositioning } from "@/lib/providers/gex-positioning";

export type GexPositioningReader = (ticker: string) => Promise<GexPositioning | null>;

/** Brief pauses before re-reading the shared matrix cache (Polygon circuit / cold miss). */
export const GEX_INTEGRITY_RETRY_DELAYS_MS = [0, 2000, 2000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load SPX + SPY positioning for the data-integrity sweep. Retries when either side is
 * still cold so a single Polygon circuit-open blip does not page ops.
 */
export async function loadGexPositioningPairForIntegrity(
  read: GexPositioningReader,
  delaysMs: readonly number[] = GEX_INTEGRITY_RETRY_DELAYS_MS
): Promise<{ spx: GexPositioning | null; spy: GexPositioning | null }> {
  let spx: GexPositioning | null = null;
  let spy: GexPositioning | null = null;
  for (const delayMs of delaysMs) {
    if (delayMs > 0) await sleep(delayMs);
    if (!spx) spx = await read("SPX").catch(() => null);
    if (!spy) spy = await read("SPY").catch(() => null);
    if (spx && spy) break;
  }
  return { spx, spy };
}
