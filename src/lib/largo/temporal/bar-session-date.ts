// Stamp OHLC aggregate bars with the ET calendar date/time they belong to, so the model that
// reads them never has to convert an epoch itself.
//
// WHY THIS EXISTS. Every bar Largo sees from Polygon arrives as `{ t, o, h, l, c, v }` — `t` is
// epoch-ms and nothing else in the payload says which SESSION the bar is. Asked "what did SPX
// close at on 2026-08-19?" on 2026-08-20, Largo answered **7,641.16** and showed its work:
// "timestamp 1787202000000 = 2026-08-20 00:00 ET, which is the close of the prior session."
// That is off by one session — 7,641.16 is 2026-08-20's own close; 2026-08-19 closed 7,707.98 —
// and the answer then contradicted itself one sentence later with the right number.
//
// The inversion is an easy one to make, because a Polygon DAILY bar's `t` is NOT midnight ET.
// Measured live on I:SPX: every daily bar lands at 05:00Z, i.e. **01:00 ET**, an hour into the
// labelled day. A reader who expects midnight sees an off-by-something and "corrects" it in
// whichever direction seems plausible. The fact is simple and unconditional in both directions:
// for daily AND intraday aggregates the ET calendar date of `t` IS the bar's session date.
// Rather than write that rule into a prompt and hope, we stamp it onto the data.
//
// Daily/weekly bars get `session_date`; intraday bars get `et` (a full ET timestamp) instead of a
// session date, because a bar's ET date is only the same thing as its trading session for a
// whole-day bar — an extended-hours print is a claim this module has no business making.

const ET_TIME_ZONE = "America/New_York";

/** Bars stamped past this count would bloat a tool result more than the anchor is worth. */
export const MAX_STAMPED_BARS = 750;

export type AggTimespan = "minute" | "hour" | "day" | "week";

function etDateParts(raw: unknown): { date: string; time: string } | null {
  // Coerce strictly. `Number(null)` and `Number("")` are both 0, which is finite and formats as a
  // perfectly plausible 1969-12-31 — a missing timestamp turning into a real-looking date is the
  // precise failure this module exists to prevent, so anything that is not a positive number (or
  // the string form of one) is refused rather than converted.
  const tMs = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(tMs) || tMs <= 0) return null;
  const d = new Date(tMs);
  if (Number.isNaN(d.getTime())) return null;
  return {
    // en-CA formats as YYYY-MM-DD, which is the shape every other date in a Largo payload uses.
    date: new Intl.DateTimeFormat("en-CA", { timeZone: ET_TIME_ZONE }).format(d),
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: ET_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d),
  };
}

/** ET calendar date ("YYYY-MM-DD") of an epoch-ms instant, or null if it isn't one. */
export function etSessionDate(tMs: unknown): string | null {
  return etDateParts(tMs)?.date ?? null;
}

/** "YYYY-MM-DD HH:mm ET" for an epoch-ms instant, or null if it isn't one. */
export function etStamp(tMs: unknown): string | null {
  const parts = etDateParts(tMs);
  return parts ? `${parts.date} ${parts.time} ET` : null;
}

/**
 * Pull the timespan out of a Polygon aggregates path
 * (`/v2/aggs/ticker/I:SPX/range/1/day/2026-08-13/2026-08-20`). Returns null for any path that is
 * not a ranged aggregates read — `/v2/aggs/ticker/X/prev` and every non-aggs endpoint included.
 */
export function aggTimespanFromPath(path: unknown): AggTimespan | null {
  if (typeof path !== "string") return null;
  const m = /\/aggs\/ticker\/[^/]+\/range\/\d+\/(minute|hour|day|week)\//i.exec(path);
  const span = m?.[1]?.toLowerCase();
  return span === "minute" || span === "hour" || span === "day" || span === "week" ? span : null;
}

type Stamped = { session_date?: string; et?: string };

/**
 * Return `bars` with each element carrying its ET anchor. Daily/weekly bars get `session_date`;
 * intraday bars get `et`. Bars without a usable `t` pass through untouched — a missing timestamp
 * must not become a wrong date.
 */
export function stampBars<T extends object>(
  bars: readonly T[],
  timespan: AggTimespan
): Array<T & Stamped> {
  const daily = timespan === "day" || timespan === "week";
  return bars.map((bar) => {
    // `T extends object` rather than `Record<string, unknown>` so typed bar shapes (AggBar) keep
    // their type through the stamp instead of being cast to a bag at every call site.
    const t = (bar as { t?: unknown } | null)?.t;
    if (daily) {
      const date = etSessionDate(t);
      return date ? { ...bar, session_date: date } : { ...bar };
    }
    const stamp = etStamp(t);
    return stamp ? { ...bar, et: stamp } : { ...bar };
  });
}

/**
 * Stamp a raw Polygon aggregates response in place of the untouched one, for the `get_polygon`
 * passthrough. Anything that is not a ranged-aggregates payload with a `results` array is returned
 * byte-identical — this must never reshape an endpoint it does not understand.
 *
 * Over MAX_STAMPED_BARS the bars are left alone and a `session_date_note` names the first and last
 * session instead, so a capped response still says out loud that it was capped rather than looking
 * like an unstamped one.
 */
export function stampPolygonAggregatePayload(endpoint: unknown, data: unknown): unknown {
  const timespan = aggTimespanFromPath(endpoint);
  if (!timespan) return data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;

  const payload = data as Record<string, unknown>;
  const results = payload.results;
  if (!Array.isArray(results) || results.length === 0) return data;

  const rows = results.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r)
  );
  if (rows.length !== results.length) return data;

  const label = timespan === "day" || timespan === "week" ? "session_date" : "et";
  if (rows.length > MAX_STAMPED_BARS) {
    const first = etSessionDate(rows[0]?.t);
    const last = etSessionDate(rows[rows.length - 1]?.t);
    return {
      ...payload,
      session_date_note:
        `${rows.length} bars exceeds the ${MAX_STAMPED_BARS}-bar stamping cap, so no per-bar ` +
        `${label} was added. Bars are sorted as requested; the range runs ${first ?? "unknown"} ` +
        `to ${last ?? "unknown"} ET. The ET calendar date of a bar's \`t\` is its session date.`,
    };
  }

  return { ...payload, results: stampBars(rows, timespan) };
}
