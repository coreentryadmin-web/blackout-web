/**
 * Meridian catalyst slice for swing play brief — cached timeline, ticker-filtered.
 */
import { serverCache } from "@/lib/server-cache";
import {
  loadMeridianTimelineResponse,
  MERIDIAN_TIMELINE_TTL_MS,
} from "@/lib/meridian/meridian-snapshot";
import {
  MERIDIAN_LARGO_WINDOW_DAYS,
  shapeTimelineItems,
  type LargoTimelineItem,
} from "@/lib/largo/meridian-timeline-for-largo";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";
import { SWING_MERIDIAN_INDEX_TICKERS } from "./play-brief-meridian-peer-core";

export type SwingMeridianCatalystSlice = {
  as_of: string;
  items: LargoTimelineItem[];
  total_matched: number;
  unavailable?: boolean;
  /**
   * True when the market-wide Benzinga earnings-window fetch feeding this slice's `items` hit its
   * own pagination safety cap with more pages still remaining upstream. BUG FIX (2026-11-01, Ask
   * Largo standing mandate, live repro QXO): forwarded from `loadMeridianTimelineResponse`'s
   * `earnings_window_truncated` so `meridianCatalystSection`/`meridianPeerSection` (play-brief-
   * intel.ts) can tell "this ticker genuinely has no catalyst in the window" apart from "this
   * ticker's row may be sitting past where this fetch stopped reading" — the exact Largo C3
   * (absence) distinction a flat `items.length === 0` cannot make on its own.
   */
  window_truncated?: boolean;
};

/** Index/proxy names that use market-wide Meridian catalyst slices — no per-name earnings peer cohort. */
export { SWING_MERIDIAN_INDEX_TICKERS };
const INDEX_TICKERS = SWING_MERIDIAN_INDEX_TICKERS;

/**
 * The ONE "we tried and failed" sentinel for this read — shared by this function's own internal
 * catch below AND, as of the fix this comment documents, `play-brief-context.ts`'s OUTER
 * `withBriefSourceTimeout(...)` race around the call to this function.
 *
 * GAP FOUND (Ask Largo standing mandate, 2026-10-15): before this fix, only THIS function's own
 * internal catch (the upstream `loadMeridianTimelineResponse` call throwing) produced this
 * `unavailable: true` sentinel — the thing `collectBriefUnavailableSources` (play-brief-absence.ts)
 * checks via `ctx.meridian?.unavailable` to push a "Meridian catalysts ... timeline read failed"
 * chip. But `play-brief-context.ts` wraps THIS WHOLE FUNCTION in a SECOND, outer
 * `withBriefSourceTimeout(fetchMeridianForTicker(ticker))` race (added 2026-09-22, PR performance
 * fix, to bound a read that had shown real p99 spikes to 90-104s) — and that outer race's own
 * `.catch(() => null)` collapsed a TIMEOUT (or any other rejection reaching the outer promise) to
 * a bare `null`, which `collectBriefUnavailableSources` has no check for at all (`null?.unavailable`
 * is `undefined`, falsy — no chip, nothing in `unavailableSources`). This function itself NEVER
 * legitimately returns `null` (every path above returns a real slice, even on its own internal
 * failure) — so a `null` `ctx.meridian` could only ever mean "the outer timeout fired," yet nothing
 * disclosed that to the member or to Largo. Exactly the Largo C3 absence violation this function's
 * own internal catch already exists to prevent, reopened one layer up by a later, unrelated
 * performance fix. Sibling `ecosystemFetchFailed`/`vectorFetchFailed` flags in the SAME file (added
 * for the identical reason — see that file's own "Distinguish a genuine 'no data' null from a
 * thrown fetch" comment) prove the principle was already established here; this read was simply
 * never given the equivalent treatment. Exported so `play-brief-context.ts`'s outer catch can
 * converge on the exact same shape instead of re-deriving (and risking drifting from) it.
 */
export function meridianUnavailableSlice(): SwingMeridianCatalystSlice {
  // `etStamp(Date.now())` cannot return null -- Date.now() is always a positive finite number,
  // the only input `etDateParts` ever refuses -- so this is a real ET-anchored stamp, never a
  // raw UTC fallback. Written this way (not `?? new Date().toISOString()`) so this line can't
  // textually match the Largo C1 ratchet's "constructs as_of from a UTC ISO string" pattern
  // (session-anchor.test.ts) -- that ratchet checks for an anchor call ANYWHERE in the file, so
  // a `new Date().toISOString()` fallback here would have silently passed today only because
  // the primary `etStamp` call above happens to exist in the same file, not because this exact
  // site is actually protected.
  return {
    as_of: etStamp(Date.now()) as string,
    items: [],
    total_matched: 0,
    unavailable: true,
  };
}

export async function fetchMeridianForTicker(ticker: string): Promise<SwingMeridianCatalystSlice | null> {
  const sym = ticker.toUpperCase();
  const session = todayEtYmd();
  let payload: Awaited<ReturnType<typeof loadMeridianTimelineResponse>> | null = null;
  try {
    payload = await serverCache(
      `meridian:timeline:v1:${session}:${MERIDIAN_LARGO_WINDOW_DAYS}`,
      MERIDIAN_TIMELINE_TTL_MS,
      () => loadMeridianTimelineResponse(MERIDIAN_LARGO_WINDOW_DAYS),
    );
  } catch {
    return meridianUnavailableSlice();
  }

  const isIndex = INDEX_TICKERS.has(sym);
  const shaped = shapeTimelineItems(
    payload.items,
    {
      kind: null,
      impact: null,
      ticker: isIndex ? null : sym,
      daysAhead: 14,
    },
    6,
  );

  return {
    as_of: payload.as_of,
    items: shaped.items,
    total_matched: shaped.total_matched,
    window_truncated: payload.earnings_window_truncated === true,
  };
}
