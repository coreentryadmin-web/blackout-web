import "server-only";

import { getZeroDteBoardPayload, type ZeroDteBoardPayload } from "@/lib/platform/zerodte-service";
import {
  parseNightHawkView,
  type NightHawkView,
} from "@/features/nighthawk/lib/nighthawk-view";

/**
 * SSR seed for /nighthawk — mirrors loadVectorSeedProps for Vector/Dashboard.
 *
 * Default view (0DTE Command Deck) is client-SWR against /api/market/zerodte/board.
 * Without a seed, first paint waits for hydration → board fetch (200–500ms+ empty).
 * Seed calls the SAME getZeroDteBoardPayload() the route uses (Redis snapshot path).
 */
export type NightHawkSeedProps = {
  view: NightHawkView;
  /** 0DTE board snapshot for SWR fallbackData (null on soft failure). */
  board: ZeroDteBoardPayload | null;
  /**
   * Cross-product deep-link seed, e.g. from HELIX's context header. Reuses the SAME
   * focus-and-select mechanism a Legacy play's "moved to Swings Open" link already dispatches
   * in-app (`dispatchGotoSwing`/`swingFocusTicker` in NightHawkFeed.tsx) — this just seeds it
   * from a URL instead of a click. SWING is the only view with a real per-ticker focus today;
   * ZERO_DTE/BANGER/VECTOR/LEGACY have no equivalent yet, so a ticker link with no explicit
   * `view=` defaults here (see the caller in page.tsx), rather than landing on a view that
   * would silently ignore it.
   */
  ticker: string | null;
};

export async function loadNightHawkSeedProps(opts?: {
  view?: string | null;
  ticker?: string | null;
}): Promise<NightHawkSeedProps> {
  const view = parseNightHawkView(opts?.view ?? null);
  const ticker = opts?.ticker?.trim() ? opts.ticker.trim().toUpperCase() : null;
  // Always seed the 0DTE board — it's the default view and the hot path. Other views
  // still hydrate via their own SWR keys when selected (deep-link SSR for those can
  // land later without blocking this win).
  let board: ZeroDteBoardPayload | null = null;
  try {
    board = await getZeroDteBoardPayload();
  } catch (err) {
    console.warn("[nighthawk-seed] getZeroDteBoardPayload failed; client will fetch:", err);
    board = null;
  }
  return { view, board, ticker };
}
