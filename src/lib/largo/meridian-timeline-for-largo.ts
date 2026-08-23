/**
 * The Meridian event surface, shaped for a model rather than for a screen.
 *
 * WHY THIS EXISTS. Meridian is the desk's event brain — macro releases, earnings prints, OpEx and
 * FDA decisions, each with a detail payload carrying dealer structure, print history anchored to
 * BMO/AMC timing, pin accuracy, prior-release reactions. **None of it was reachable from Largo.**
 * Measured against the shipped tool table AT THE TIME: 0 of the then-127 tool descriptions
 * mentioned Meridian, and `runLargoTool` had no Meridian case at all. **That gap is closed** — the
 * work described below is what closed it — and this paragraph is kept as the WHY, in the past
 * tense so it cannot be read as a live measurement. Today 3 of 129 descriptions name Meridian
 * (`get_meridian_timeline`, `get_meridian_event`, `get_cross_product_read`) and `runLargoTool`
 * dispatches the first two.
 *
 * What existed instead was a PUSH. `meridianTimelineForLargo` is injected into the prompt by
 * `largo-terminal.ts` — but only when `questionWantsMeridianPrefetch()` fires, and that gate is a
 * keyword list. Measured over 24 questions a member would plausibly ask, **8 passed (33%)**, and
 * the misses were the natural phrasings:
 *
 *     ✗ "What are the big catalysts this week?"     ✓ "Show me the catalyst calendar"
 *     ✗ "When does NVDA report?"                    ✓ "Give me the earnings intel on NVDA"
 *     ✗ "Is there an FOMC meeting this week?"       ✓ "What's on the macro desk today?"
 *     ✗ "When is the next OpEx?"                    ✓ "Give me the opex preview"
 *
 * A member has to already know the product's internal vocabulary to get an answer. And even when
 * the gate fires, the push carries 7 fields per item, capped at 12 items over 7 days, truncated
 * to 4000 characters, into a block labelled for social-content generation.
 *
 * A tool the model can CALL fixes the class of problem, which is what the exposure gap actually
 * needs — not more keywords in the gate. The gate can stay; it just stops being the only door.
 *
 * WHY SHAPING IS NOT OPTIONAL. The raw timeline payload measured **151,595 characters (~38k
 * tokens)** live on 2026-08-21 for a 14-day window. `earnings_analytics_rows` alone is **111,348
 * of them — 73%** — a per-ticker analytics table built for a desk grid, not for a sentence. Handed
 * over whole it would evict most of the model's context to answer "what's on this week".
 *
 * So this module drops that field and says so in the payload rather than silently, because a
 * reader who cannot see a field cannot tell whether it is missing or was never asked for.
 */

/** The timeline fields Largo carries. A superset of the old 7-field push, still ~335 chars/item. */
export type LargoTimelineItem = {
  /** The key for `get_meridian_event`. Format: `earnings:TICKER:YYYY-MM-DD`, `opex:YYYY-MM-DD`,
   *  `fda:TICKER:YYYY-MM-DD`, `macro:YYYY-MM-DD:Event-Slug`. */
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  /** ET calendar date. Not a UTC instant — Largo product contract C1. */
  date: string;
  /** ET release time HH:mm when the feed carries one, else null. */
  time: string | null;
  impact: string;
  days_until: number;
  ticker: string | null;
  /** Earnings-only, and null rather than absent so "no reading" and "no such field" differ. */
  date_status: string | null;
  importance: number | null;
  is_printed: boolean | null;
  expected_move_pct: number | null;
  sector_label: string | null;
};

export type TimelineFilters = {
  kind: string | null;
  impact: string | null;
  ticker: string | null;
  /** Inclusive upper bound on `days_until`. See MERIDIAN_LARGO_WINDOW_DAYS for why the fetch
   *  window and the ASKED-FOR window are deliberately different numbers. */
  daysAhead: number;
};

/**
 * The window the tool always FETCHES, regardless of what the caller asked for.
 *
 * `loadMeridianTimelineResponse` is expensive — it enriches every earnings name in the window with
 * an options chain, and a cold 14-day call did not finish inside 500s in testing. Both the HTTP
 * route and the `cron/meridian-warm` job avoid that by sharing one `serverCache` key,
 * `meridian:timeline:v1:<ET-today>:<daysAhead>` — and the cron warms **21**.
 *
 * The key includes the day count, so a tool that fetched the caller's 7 would MISS the warm entry
 * and pay the full cold cost on every call. Fetching 21 every time and narrowing afterwards means
 * the tool rides the cron's work instead of duplicating it, and the narrowing is a filter on
 * `days_until` — pure, cheap and tested here rather than inferred from a cache hit.
 */
export const MERIDIAN_LARGO_WINDOW_DAYS = 21;

const KINDS = new Set(["macro", "earnings", "opex", "fda"]);
const IMPACTS = new Set(["high", "medium", "low"]);
/** Rank so an `impact` filter can mean "this bar OR ABOVE" — asking for medium and being handed
 *  medium-only would hide every high-impact event, which is the opposite of the intent. */
const IMPACT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/** Normalize a caller-supplied kind. Unrecognised → null (no filter) rather than zero results. */
export function normalizeKind(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return KINDS.has(s) ? s : null;
}

/** Same for impact. `high` means high; `medium` means medium AND high — see IMPACT_RANK. */
export function normalizeImpact(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return IMPACTS.has(s) ? s : null;
}

/** Clamp the window. A caller asking for 400 days gets 30, not a timeout. */
export function normalizeDaysAhead(raw: unknown, fallback = 7): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(30, Math.max(1, n));
}

export function normalizeLimit(raw: unknown, fallback = 40): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(1, n));
}

type RawItem = Record<string, unknown>;

/**
 * A number, or null — and null for ABSENCE, not zero.
 *
 * The guard that matters is the first line. `Number(null)` is **0** and `Number.isFinite(0)` is
 * true, so a naive `Number(v)` turns "no reading on file" into a confident measured zero.
 * `Number("")` is 0 for the same reason.
 *
 * Caught live, by this tool, on its first real call: 83 of the 90 earnings items on the
 * 2026-08-21 timeline carry `expected_move_pct: null`, and every one of them was being handed to
 * the model as `0`. "NVDA's options-implied move into its print is 0%" is not a rounding error —
 * it is an absent measurement published as a measurement, which is the one thing this surface is
 * built not to do.
 *
 * The unit tests did not catch it because their fixture OMITTED the field, and `Number(undefined)`
 * is NaN, which this already handled. Absent-as-undefined and absent-as-null took different paths.
 */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

/** Project one raw timeline item. Every field is explicit and null-normalized: an absent key and
 *  a null one read the same to a model, but only one survives JSON serialization. */
export function toLargoTimelineItem(raw: RawItem): LargoTimelineItem {
  return {
    id: String(raw.id ?? ""),
    kind: String(raw.kind ?? ""),
    title: String(raw.title ?? ""),
    subtitle: str(raw.subtitle),
    date: String(raw.date ?? ""),
    time: str(raw.time),
    impact: String(raw.impact ?? ""),
    days_until: num(raw.days_until) ?? 0,
    ticker: str(raw.ticker),
    date_status: str(raw.date_status),
    importance: num(raw.importance),
    is_printed: typeof raw.is_printed === "boolean" ? raw.is_printed : null,
    expected_move_pct: num(raw.expected_move_pct),
    sector_label: str(raw.sector_label),
  };
}

/**
 * Filter, sort and cap the timeline.
 *
 * Sorted by DATE then by impact descending, so "what matters next" reads off the top without the
 * model having to sort prose. A truncation is REPORTED (`truncated`, `count`, `total_matched`)
 * rather than silent — a capped list that looks complete is the same defect class as a fill rate
 * without its cohort.
 */
export function shapeTimelineItems(
  rawItems: readonly RawItem[] | null | undefined,
  filters: TimelineFilters,
  limit: number
): { items: LargoTimelineItem[]; total_matched: number; truncated: boolean } {
  const all = (rawItems ?? []).map(toLargoTimelineItem);
  const wantTicker = filters.ticker ? filters.ticker.trim().toUpperCase() : null;
  const minRank = filters.impact ? (IMPACT_RANK[filters.impact] ?? 0) : null;

  const matched = all.filter((i) => {
    if (i.days_until > filters.daysAhead) return false;
    if (filters.kind && i.kind !== filters.kind) return false;
    if (minRank != null && (IMPACT_RANK[i.impact] ?? -1) < minRank) return false;
    if (wantTicker && (i.ticker ?? "").toUpperCase() !== wantTicker) return false;
    return true;
  });

  matched.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0) ||
      a.title.localeCompare(b.title)
  );

  return {
    items: matched.slice(0, limit),
    total_matched: matched.length,
    truncated: matched.length > limit,
  };
}

/**
 * The sentence that travels with the payload.
 *
 * Not decoration. The model has no other way to learn that `id` is the key to a second tool, that
 * `date` is an ET session rather than a UTC instant, or that the analytics table was dropped on
 * purpose rather than being empty. Every one of those is a wrong answer waiting to happen.
 */
export function timelineInterpretation(droppedAnalyticsRows: number): string {
  return [
    "`date` and `time` are ET (America/New_York) — never infer the session from a UTC timestamp.",
    "Pass an item's `id` to `get_meridian_event` for that event's full detail: earnings carries print history anchored to BMO/AMC timing, dealer structure and the play read; opex carries pin accuracy and cross-market rows; macro carries prior-release reactions; fda carries prior decisions.",
    "`impact` filters mean THAT BAR OR ABOVE — impact=medium includes high.",
    "`expected_move_pct` is a PERCENT and is earnings-only; null means the name has no options-implied move on file, not that the move is zero.",
    droppedAnalyticsRows > 0
      ? `The per-ticker analytics grid (${droppedAnalyticsRows} rows) is deliberately NOT included — it is ~73% of the raw payload and is built for a desk table. Ask for a specific event instead.`
      : "The per-ticker analytics grid is not carried by this tool.",
  ].join(" ");
}
