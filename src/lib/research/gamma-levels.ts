import "server-only";

import { dbConfigured, dbQuery } from "@/lib/db";
import { logToken } from "@/lib/log-token";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import { flowPriceSymbol } from "@/lib/providers/flow-price-symbol";
import { fetchIndexDailyBars, fetchStockDailyBars } from "@/lib/providers/polygon";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";
import {
  buildGammaLevelsResearch,
  type GammaLevelsResearch,
  type ResearchBar,
  type ResearchSample,
  type ResearchSessionInput,
} from "./gamma-levels-core";
import { publishableSessions, retainPublishable, type PublishableSession } from "./publishable-session";

/**
 * Server-side loader for the public gamma-levels research pages.
 *
 * Joins two sources, both of them safe to publish from:
 *   - `vector_wall_history` — OUR OWN recorded wall classification, 90-day retention.
 *   - Polygon daily bars for CLOSED prior sessions — historical, delayed.
 *
 * It cannot be handed a live session: every session it reads comes from `publishableSessions()`,
 * which returns the branded `PublishableSession` type, and the rows come back through
 * `retainPublishable`. See publishable-session.ts for why that boundary is typed rather than
 * documented.
 */

/** Trailing window. 60 sessions ≈ a quarter — long enough for a rate to mean something, and
 *  comfortably inside the table's 90-day retention so the window is never half-empty. */
export const RESEARCH_WINDOW_SESSIONS = 60;

/**
 * Samples kept per session.
 *
 * The rail records every few seconds; a 60-session window at full density is hundreds of
 * thousands of rows to move a modal strike that a few dozen evenly-spaced samples already
 * determine. NTILE picks them evenly ACROSS the session rather than taking a prefix, so a thin
 * session degrades to "all of its rows" instead of "its first hour" — a prefix would bias every
 * wall toward the opening book, which is exactly the instant-in-time error the modal derivation
 * exists to avoid.
 */
const SAMPLES_PER_SESSION = 80;

/** Cached for an hour: the inputs only change once a day, when a new session becomes publishable. */
const CACHE_TTL_SEC = 3600;

type WindowRow = {
  session_ymd: string | Date;
  walls: GexWalls | string | null;
  gamma_flip: number | null;
};

function asWalls(value: GexWalls | string | null): GexWalls | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as GexWalls;
    } catch {
      return null;
    }
  }
  return value;
}

/** pg may hand back a DATE column as a Date; normalize to the `YYYY-MM-DD` the rest of this uses. */
function rowSession(value: string | Date): string {
  if (value instanceof Date) {
    // The column is a bare DATE with no time or zone. Reading it through any local-time getter
    // would shift it a day for negative offsets, so take the UTC calendar parts verbatim.
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

/**
 * Evenly-downsampled wall samples for a whole window, in one query.
 *
 * The `ticker` column stores a bare symbol for the "all" DTE horizon and a composite
 * (`NVDA::weekly`) for narrowed ones — see `wallRailStorageId`. The public pages want the whole
 * book, so this matches the bare symbol only and a composite rail cannot leak in.
 */
async function loadWindowSamples(
  ticker: string,
  sessions: readonly PublishableSession[]
): Promise<Map<string, ResearchSample[]>> {
  const out = new Map<string, ResearchSample[]>();
  if (!dbConfigured() || sessions.length === 0) return out;

  try {
    const res = await dbQuery<WindowRow>(
      `
      SELECT DISTINCT ON (session_ymd, slot) session_ymd, walls, gamma_flip
      FROM (
        SELECT
          session_ymd,
          walls,
          gamma_flip,
          bucket_time,
          NTILE($3) OVER (PARTITION BY session_ymd ORDER BY bucket_time) AS slot
        FROM vector_wall_history
        WHERE ticker = $1 AND session_ymd = ANY($2::date[])
      ) t
      ORDER BY session_ymd ASC, slot ASC, bucket_time ASC
      `,
      [ticker, [...sessions], SAMPLES_PER_SESSION]
    );

    for (const row of res.rows) {
      const session = rowSession(row.session_ymd);
      const walls = asWalls(row.walls);
      if (!walls) continue;
      const list = out.get(session) ?? [];
      list.push({ walls, gammaFlip: row.gamma_flip ?? null });
      out.set(session, list);
    }
  } catch (err) {
    // Best-effort, exactly like every other reader of this table: a DB failure must render as an
    // honest empty page, never a 500 on a public URL.
    console.warn("[research-gamma] window load failed", logToken(ticker), err);
  }
  return out;
}

/**
 * Daily OHLC for the window, keyed by ET session date.
 *
 * TWO REPO-DOCUMENTED TRAPS ARE HANDLED HERE, both of which fail silently rather than loudly:
 *
 *  1. `limit` is DERIVED from the window. Polygon sorts ascending, so a fixed cap smaller than
 *     the range returns the OLDEST N bars and drops the recent end — which presents as "we have
 *     no data for those sessions", not as a truncated fetch. This is the exact defect that left
 *     every recent earnings reaction null for months.
 *  2. A daily bar's `t` is 05:00Z, which is 01:00 ET — the day BEFORE, under any naive UTC read.
 *     `etSessionDate` is the shared derivation that anchors it to the right session.
 */
async function loadWindowBars(
  ticker: string,
  sessions: readonly PublishableSession[]
): Promise<Map<string, ResearchBar>> {
  const out = new Map<string, ResearchBar>();
  if (sessions.length === 0) return out;

  const from = sessions[sessions.length - 1];
  const to = sessions[0];
  const resolved = flowPriceSymbol(ticker);
  if (!resolved) return out;

  // Calendar days spanned, not sessions — plus headroom, so the cap can never be the binding
  // constraint on the recent end of the range.
  const spanDays =
    Math.ceil((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const limit = String(Math.max(sessions.length, spanDays) + 10);

  try {
    const bars = resolved.isIndex
      ? await fetchIndexDailyBars(resolved.symbol, from, to, limit)
      : await fetchStockDailyBars(resolved.symbol, from, to, limit);

    for (const b of bars) {
      const session = etSessionDate(b.t);
      if (!session) continue;
      if (![b.o, b.h, b.l, b.c].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
      out.set(session, { open: b.o, high: b.h, low: b.l, close: b.c });
    }
  } catch (err) {
    console.warn("[research-gamma] bar load failed", logToken(ticker), err);
  }
  return out;
}

/**
 * Build (or serve cached) research for one ticker.
 *
 * Returns a payload even when there is nothing in it — the caller decides whether it clears the
 * publish floor. An empty result and a failed load are deliberately the same shape: a public page
 * has nothing useful to say about either, and `coverage.missing` records which sessions were
 * absent regardless of why.
 */
export async function loadGammaLevelsResearch(
  ticker: string,
  windowSessions: number = RESEARCH_WINDOW_SESSIONS
): Promise<GammaLevelsResearch> {
  const symbol = String(ticker ?? "").trim().toUpperCase();
  const cacheKey = `research:gamma-levels:v1:${symbol}:${windowSessions}`;

  try {
    const cached = await sharedCacheGet<GammaLevelsResearch>(cacheKey);
    if (cached) return cached;
  } catch {
    /* a cold cache is not an error — fall through and compute */
  }

  const sessions = publishableSessions(windowSessions);
  const [samples, bars] = await Promise.all([
    loadWindowSamples(symbol, sessions),
    loadWindowBars(symbol, sessions),
  ]);

  const inputs: ResearchSessionInput[] = sessions.map((session) => ({
    session,
    samples: samples.get(session) ?? [],
    bar: bars.get(session) ?? null,
  }));

  // Belt and braces: `sessions` is already publishable by construction, but the filter re-asserts
  // it at the point where data becomes a page. A future caller widening the window is the whole
  // reason this second check exists.
  const research = buildGammaLevelsResearch(symbol, retainPublishable(inputs));

  await sharedCacheSet(cacheKey, research, CACHE_TTL_SEC).catch(() => undefined);
  return research;
}
