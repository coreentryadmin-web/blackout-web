/**
 * GENERIC EXTRACTION — turn ARBITRARY tool output into renderable blocks.
 *
 * THE COVERAGE PROBLEM THIS SOLVES, measured before it was written: `bundle.ts` carried SEVEN
 * shape-matchers (`findQuote`, `findFlow`, `findPositioning`, `findLedgerRows`, `findEdition`,
 * `findGateValue`, `findGraderAgreement`) against ONE HUNDRED AND TWENTY-ONE callable tools. Every
 * other tool — earnings, IPO and FDA calendars, financials, ownership, congress and insider flow,
 * analyst ratings, IV term structure, realized vol, skew, market breadth, movers, hot tickers,
 * sector flow, OI per strike and expiry, max pain, NOPE, technicals, seasonality, relative
 * strength, setup stats, trade history — produced output that reached NO block.
 *
 * That is the whole explanation for the empty canvas. A composer can only pack blocks that exist,
 * so a question answered from six uncatalogued tools composed a headline and a spot price and then
 * ran out of things to draw. The failure looked like a layout problem and was a coverage problem.
 *
 * A HUNDRED BESPOKE BLOCKS IS THE WRONG FIX. Most tool payloads are one of three shapes, and three
 * generic renderers cover far more ground than thirty specific ones would:
 *
 *   STATS   — a record of labelled scalars        (financials, IV stats, technicals, breadth)
 *   RANKED  — an array of {name, number} rows     (movers, sector flow, congress, ratings, OI)
 *   EVENTS  — an array of dated happenings        (earnings, IPO, FDA, economic, news, catalysts)
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS THE MOST DANGEROUS ONE IN THE LIBRARY, and what stops it.
 *
 * Every other extractor knows what it is reading. This one does not — it infers from structure.
 * That is precisely the machinery by which a card could invent something, so the rules are strict
 * and each one closes a specific way of lying:
 *
 *   1. PRIMITIVES ONLY, TOP LEVEL ONLY. A nested object's meaning lives in its path, and flattening
 *      `{ greeks: { delta: 0.5 } }` to "Delta 0.5" silently drops which leg it belonged to.
 *   2. NEVER INVENT A LABEL. The label is the key, humanised. If the key is unreadable the entry is
 *      dropped rather than guessed at.
 *   3. UNITS COME FROM THE KEY OR NOT AT ALL. `net_premium` renders as dollars because the key says
 *      premium; an unrecognised key renders as a plain grouped number. Guessing that a bare 0.62 is
 *      a percentage would be a fabricated claim about magnitude.
 *   4. IDENTIFIERS AND PLUMBING ARE EXCLUDED. Ids, cursors, hashes and internal flags are not
 *      member-facing measurements, and a card padded with `request_id` is worse than a short card.
 *   5. A BOOLEAN IS NOT A MEASUREMENT unless the key reads as a state. `available: true` is
 *      plumbing; `is_stale: true` is a warning a member should see.
 *   6. NOTHING IS COERCED. `NaN`, `Infinity` and non-finite values are dropped, never rendered.
 *
 * The result is that this file can produce a THIN block or NO block. It cannot produce a WRONG one.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

import { truncateText } from "@/lib/truncate-text";
import type { VisualSystem } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Keys that are PLUMBING, not measurements.
 *
 * Matched on the whole key or a suffix, never as a substring — `id` as a substring would eat
 * `bid`, `mid`, `avoided` and `confidence`, which are exactly the numbers a member came for.
 */
const PLUMBING_RE =
  /^(id|_id|uuid|guid|key|slug|cursor|next_cursor|page|per_page|offset|limit|hash|etag|version|schema|request_id|trace_id|session_id|user_id|source|provider|endpoint|url|href|link|status_code|ok|success|error|errors|warning|warnings|meta|metadata|raw|debug)$|_(id|uuid|url|href|hash|cursor|token)$/i;

/**
 * IDENTIFIERS are not measurements, and a stat tile is for measurements.
 *
 * Caught by rendering: a quote payload produced a "Readings" grid whose first tile read
 * "TICKER · NVDA". That is the card's own subject restated as though it were a finding, next to a
 * headline and a hero number that both already name it. It is not wrong, it is noise occupying a
 * tile a real reading could have used.
 *
 * These stay legal as ROW NAMES (`rankedFromArray` reads them as labels) — the exclusion is
 * specific to the stat grid, where the label/value split makes an identifier meaningless.
 */
const IDENTIFIER_RE = /^(ticker|symbol|name|title|label|underlying|instrument|contract|option_symbol|occ)$/i;

/** Timestamps are rendered by the card's own chrome, not as a stat tile. */
const TIME_RE = /^(as_of|asof|at|ts|timestamp|updated_at|created_at|fetched_at|generated_at|published_at|date|datetime|time)$/i;

/** Booleans worth showing: a STATE a member would act on, not an internal flag. */
const STATEFUL_BOOL_RE = /(stale|degraded|halted|pulled|invalid|breached|triggered|unusual|inverted|elevated|extreme|warning|risk|blocked|capped)/i;

/** Keys whose value is dollars. */
const USD_RE = /(premium|notional|value|cost|volume_usd|usd|dollars?|market_cap|mcap|revenue|income|profit|assets|liabilities|cash|debt|price|mark|credit|debit)/i;
/** Keys whose value is a percentage ALREADY expressed as 0-100. */
const PCT_RE = /(pct|percent|percentage|_rate$|win_rate|rank$|share$)/i;
/** Keys whose value is a 0-1 ratio that should render as a percentage. */
const RATIO_RE = /(ratio$|share$|fraction|probability|prob$|_pct_of_)/i;

/** Humanise a snake/camel key into a label. Returns null when nothing readable survives. */
export function humaniseKey(key: string): string | null {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim();
  if (!words || !/[a-z]/i.test(words)) return null;
  const label = words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
  // A label longer than this cannot be read in a tile and is almost always a nested path.
  return label.length > 28 ? null : label;
}

/**
 * Format a number using ONLY what the key licenses.
 *
 * An unrecognised key gets a plain grouped number. That is deliberately boring: rendering a bare
 * `0.62` as "62%" would be a fabricated claim about magnitude, and rendering `41200000` as "$41.2M"
 * when the key never said dollars would be a fabricated claim about units.
 */
export function formatByKey(key: string, n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";

  if (RATIO_RE.test(key) && abs <= 1) return `${sign}${(abs * 100).toFixed(1)}%`;
  if (PCT_RE.test(key)) return `${sign}${abs.toFixed(abs >= 100 ? 0 : 1)}%`;
  if (USD_RE.test(key)) {
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
    return `${sign}$${abs.toFixed(2)}`;
  }
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (Number.isInteger(n)) return `${sign}${abs.toLocaleString("en-US")}`;
  return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export type GenericStat = { label: string; value: string; key: string };

/**
 * Lift labelled scalars off ONE record.
 *
 * Top level only — see rule 1 in the header. A `limit` bounds how much of an unknown payload can
 * reach a card, because a 60-key response would otherwise fill a canvas with whatever happened to
 * be enumerated first.
 */
export function statsFromRecord(obj: unknown, limit = 8): GenericStat[] {
  if (!isRecord(obj)) return [];
  const out: GenericStat[] = [];
  for (const [key, raw] of Object.entries(obj)) {
    if (out.length >= limit) break;
    if (PLUMBING_RE.test(key) || TIME_RE.test(key) || IDENTIFIER_RE.test(key)) continue;
    const label = humaniseKey(key);
    if (!label) continue;

    if (typeof raw === "number") {
      if (!Number.isFinite(raw)) continue; // rule 6
      out.push({ label, value: formatByKey(key, raw), key });
      continue;
    }
    if (typeof raw === "boolean") {
      if (!STATEFUL_BOOL_RE.test(key)) continue; // rule 5
      out.push({ label, value: raw ? "YES" : "NO", key });
      continue;
    }
    if (typeof raw === "string") {
      const s = raw.trim();
      // A long string is prose, not a stat, and a card tile cannot hold it.
      if (!s || s.length > 24) continue;
      out.push({ label, value: s.toUpperCase(), key });
    }
    // Objects and arrays are deliberately skipped — rule 1.
  }
  return out;
}

export type GenericRankedRow = {
  label: string;
  value: string;
  magnitude: number;
  sub?: string | null;
  /**
   * WHICH FIELD the number came from, so the block can say what it IS.
   *
   * A bar chart of bare numbers is the most confidently misleading thing this library can draw.
   * Seen live: a card answering "todays 0DTE results" drew AKAM 93, COHR 100, CRWD 71 as green
   * bars directly above tiles reading WINS 9 / LOSSES 8. Those are conviction SCORES. Beside a
   * win/loss tally, with a green bar and no unit, they read as per-ticker returns — a member
   * would reasonably conclude AKAM made 93%.
   *
   * Every number here is real and sourced. That is exactly what makes it dangerous: nothing is
   * fabricated, the CLAIM is just unstated, and the reader supplies the wrong one.
   */
  valueKey?: string;
};

/**
 * Cut a label to fit WITHOUT severing a word.
 *
 * The old `slice(0, 30)` produced, on a live NVDA card posted-size: "Wells Fargo Reiterates
 * Overwei", "Nvidia Stock\u2019s Rubin Era Begin", "SpaceX Caught in a \u2018Capex Tug". Six headlines,
 * six words cut mid-syllable, on an artefact built to be shared publicly.
 *
 * Backs up to the last space when one exists in the final third, so a long unbroken token (an OCC
 * symbol, a URL) still gets cut rather than collapsing the label to nothing. The ellipsis is what
 * tells a reader the text continues — a hard cut reads as a typo.
 */
const trimLabel = truncateText;

/** Field names an array row might carry its NAME under, most specific first. */
const NAME_KEYS = ["ticker", "symbol", "name", "label", "strike", "expiry", "sector", "industry", "member", "gate", "code"];
/** Field names an array row might carry its NUMBER under, most specific first. */
const VALUE_KEYS = [
  "premium", "net_premium", "notional", "value", "amount", "volume", "oi", "open_interest",
  "count", "total", "score", "change", "change_pct", "pct", "return", "return_pct", "gamma", "delta", "weight",
];

/**
 * The row's NUMBER — known names first, then any honest numeric field.
 *
 * `VALUE_KEYS` was the same kind of allowlist as the container one removed in #2041, and it failed
 * the same way. `zeroDtePlaysFeed` rows carry `entry_premium`, `last_mark` and `peak_score`; the
 * list has `premium` and `score`. Near-misses, all three, so five live Night Hawk plays ranked as
 * zero rows — which is the shape of the original complaint that started this work ("the image only
 * shows one play, it should show all 5").
 *
 * The fallback is bounded on both sides rather than "first number wins":
 *   - PLUMBING_RE drops ids, timestamps, urls, cursors — never a quantity a member reads.
 *   - IDENTIFIER_RE drops the row's own name when it happens to be numeric.
 *   - `rank`/`index`/`position` are dropped explicitly: they are the row's PLACE in the list, and
 *     ranking a list by its own ordinal is a bar chart of 1,2,3,4,5 — the same false-precision
 *     failure as the all-zero gamma profile that already had to be caught by rendering.
 *
 * The allowlist stays FIRST because `formatByKey` gives those keys their proper units ($ for
 * premium, % for change). A fallback field is formatted by its own key, which is why the key is
 * returned alongside the number rather than discarded.
 */
function magnitudeOf(item: Record<string, unknown>): [string, number] | null {
  for (const k of VALUE_KEYS) {
    const v = item[k];
    if (typeof v === "number" && Number.isFinite(v)) return [k, v];
  }
  for (const [k, v] of Object.entries(item)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (PLUMBING_RE.test(k) || IDENTIFIER_RE.test(k)) continue;
    if (/^(rank|index|position|idx|seq|order)$/i.test(k)) continue;
    return [k, v];
  }
  return null;
}

/**
 * Lift a ranked list off an ARRAY of records.
 *
 * Requires BOTH a name and a finite number on the same row. A row with a name and no number is not
 * rankable, and inventing a rank for it — by position, say — would assert an ordering the data
 * never expressed.
 *
 * The array's OWN ORDER is preserved. This never re-sorts: the caller's order is frequently the
 * claim being made (a "top movers" response is already ranked), and re-sorting on a field this
 * function guessed at would silently replace the tool's ranking with its own.
 */
export function rankedFromArray(arr: unknown, limit = 8): GenericRankedRow[] {
  if (!Array.isArray(arr)) return [];
  const out: GenericRankedRow[] = [];
  for (const item of arr) {
    if (out.length >= limit) break;
    if (!isRecord(item)) continue;

    let label: string | null = null;
    for (const k of NAME_KEYS) {
      const v = item[k];
      if (typeof v === "string" && v.trim()) { label = trimLabel(v, 18); break; }
      if (typeof v === "number" && Number.isFinite(v)) { label = String(v); break; }
    }
    if (!label) continue;

    const picked = magnitudeOf(item);
    if (!picked) continue;
    const [valueKey, magnitude] = picked;

    out.push({ label, value: formatByKey(valueKey, magnitude), magnitude, sub: null, valueKey });
  }
  return out;
}

export type GenericEvent = { when: string; label: string; detail?: string | null };

/**
 * `published` IS THE ONE THAT MATTERED, and it was the one missing.
 *
 * `toolNews` (run-tool.ts) returns `{ articles: [{ title, teaser, published, tickers, source }] }`.
 * The list had `published_at` and not `published`, so `eventsFromArray` failed the date test on
 * EVERY article and returned nothing — twelve headlines, zero rows, silently. Verified against the
 * exact production return shape: 12 articles in, 0 blocks out, before this line changed.
 *
 * That is the whole coverage promise of generic extraction failing on one of the most-called tools
 * in the product, and it failed the way this class of bug always does: not with an error, but with
 * an empty result that looks like "there was no news".
 */
const DATE_KEYS = [
  "date",
  "expiry",
  "report_date",
  "earnings_date",
  "at",
  "when",
  "published",
  "published_at",
  "time",
  "datetime",
];

/** A date string a member can read. Returns null for anything unparseable — never a placeholder. */
function readDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[2]}/${iso[3]}`;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Lift a dated event list off an ARRAY of records.
 *
 * Requires a PARSEABLE date AND a name. An undated event on a calendar card is the one thing a
 * calendar cannot honestly show — "NVDA earnings" with no date implies the nearest one.
 */
export function eventsFromArray(arr: unknown, limit = 6): GenericEvent[] {
  if (!Array.isArray(arr)) return [];
  const out: GenericEvent[] = [];
  /**
   * Same date + same name = the same event, however many source rows describe it.
   *
   * Calendar feeds enumerate a holiday PER EXCHANGE — Polygon's market-holidays payload carries a
   * separate record for NYSE and for NASDAQ — so an un-deduped list printed "09/07 Labor Day,
   * 09/07 Labor Day, 11/26 Thanksgiving, 11/26 Thanksgiving" on a live card. The waste compounds:
   * duplicates are pushed BEFORE the limit is reached, so they also consume the row budget and a
   * 4-row block conveyed two facts while genuinely distinct later events were cut.
   *
   * Deduping inside the scan (rather than on the finished array) is what reclaims that budget —
   * the loop keeps reading until `limit` DISTINCT events are found.
   */
  const seen = new Set<string>();
  for (const item of arr) {
    if (out.length >= limit) break;
    if (!isRecord(item)) continue;

    let when: string | null = null;
    for (const k of DATE_KEYS) {
      when = readDate(item[k]);
      if (when) break;
    }
    if (!when) continue;

    let label: string | null = null;
    for (const k of ["ticker", "symbol", "name", "title", "event", "headline"]) {
      const v = item[k];
      if (typeof v === "string" && v.trim()) { label = trimLabel(v, 30); break; }
    }
    if (!label) continue;

    let detail: string | null = null;
    for (const k of ["time", "session", "type", "importance", "period", "actual", "estimate", "consensus"]) {
      const v = item[k];
      if (typeof v === "string" && v.trim() && v.length <= 20) { detail = v.trim(); break; }
      if (typeof v === "number" && Number.isFinite(v)) { detail = formatByKey(k, v); break; }
    }
    // Case-folded: "Labor Day" and "LABOR DAY" from two feeds are one holiday, not two.
    const key = `${when} ${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ when, label, detail });
  }
  return out;
}

export type GenericBlocks = {
  stats: { title: string; rows: GenericStat[]; source: VisualSystem } | null;
  ranked: { title: string; rows: GenericRankedRow[]; source: VisualSystem } | null;
  events: { title: string; rows: GenericEvent[]; source: VisualSystem } | null;
};

/**
 * Array fields worth ranking, and the title each earns.
 *
 * Named rather than "any array", because a payload usually carries several and the interesting one
 * is rarely the first enumerated. An unlisted array is skipped: a card built from whichever key
 * happened to come first is not reproducible.
 */
const RANKED_FIELDS: { key: string; title: string }[] = [
  { key: "movers", title: "Movers" },
  { key: "top", title: "Top" },
  { key: "leaders", title: "Leaders" },
  { key: "laggards", title: "Laggards" },
  { key: "sectors", title: "Sectors" },
  { key: "tickers", title: "Tickers" },
  { key: "trades", title: "Trades" },
  { key: "strikes", title: "By strike" },
  { key: "expiries", title: "By expiry" },
  { key: "contracts", title: "Contracts" },
  { key: "results", title: "Results" },
  { key: "items", title: "Items" },
  { key: "data", title: "Data" },
];

const EVENT_FIELDS: { key: string; title: string }[] = [
  { key: "earnings", title: "Earnings" },
  // Keys production actually emits, given proper member-facing titles. The all-array scan finds
  // these anyway; without an entry here they humanise to the raw field name and a member reads
  // "STATIC SCHEDULE" or "ARTICLES" on a card they are about to post.
  { key: "static_schedule", title: "Macro calendar" },
  { key: "articles", title: "News" },
  { key: "calendar", title: "Calendar" },
  { key: "events", title: "Events" },
  { key: "catalysts", title: "Catalysts" },
  { key: "news", title: "News" },
  { key: "upcoming", title: "Upcoming" },
  { key: "ipos", title: "IPOs" },
];

/** Minimum rows for a block to be worth drawing. Two ranked names is a comparison, not a ranking. */
const MIN_RANKED = 3;
const MIN_EVENTS = 2;
const MIN_STATS = 3;

/**
 * Scan the turn's tool output for anything the specific extractors did not claim.
 *
 * `claimed` is the set of payloads already consumed by a purpose-built finder. Re-rendering a flow
 * tape as a generic ranked list would put the same numbers on the card twice under two different
 * headings, which reads as two independent measurements.
 */
/**
 * Every array-valued property, KNOWN NAMES FIRST.
 *
 * THE ALLOWLIST WAS GATING ON THE WRONG THING. `EVENT_FIELDS`/`RANKED_FIELDS` matched the
 * CONTAINER KEY, so a payload had to be shaped like one the list anticipated. `toolNews` returns
 * `{ articles: [...] }` and `articles` is on neither list — so twelve live NVDA headlines produced
 * zero rows, and the failure looked exactly like "there was no news".
 *
 * A key name was never the safety mechanism. The ROW validators are: `eventsFromArray` requires a
 * parseable date AND a name, `rankedFromArray` requires a finite magnitude, and both drop anything
 * that does not qualify. An array of the wrong shape yields no rows whatever it is called, so
 * scanning every array can surface a block the list would have missed and cannot surface one the
 * row rules would have rejected.
 *
 * The known lists are KEPT and tried FIRST — purely for their titles. "Earnings" reads better than
 * the humanised key, and trying them first keeps titles stable for the payloads that already
 * worked. Everything else falls back to `humaniseKey`, which is how `articles` becomes "Articles"
 * instead of nothing at all.
 */
/**
 * Name the QUANTITY in the block title when the rows agree on one.
 *
 * "Plays" over a column of bare numbers tells a member nothing about what the numbers mean;
 * "Plays · score" tells them not to read it as a return. Only applied when every drawn row took
 * its magnitude from the SAME field — a mixed column has no single honest label, and inventing
 * one would be worse than the ambiguity it replaced.
 *
 * Skipped when the field name adds nothing (the title already says it, or the key humanises to
 * the same word), so a Flow block does not become "Flow · premium · premium".
 */
function rankedTitle(title: string, rows: readonly GenericRankedRow[]): string {
  const keys = new Set(rows.map((r) => r.valueKey ?? ""));
  if (keys.size !== 1) return title;
  const key = [...keys][0]!;
  const unit = key ? humaniseKey(key) : null;
  if (!unit) return title;
  const t = title.toLowerCase();
  const u = unit.toLowerCase();
  // A bare array has no key to name it after, so the quantity IS the honest heading — "Total
  // premium" says more than "Ranked · Total premium".
  if (t === "ranked") return unit;
  if (t === u || t.includes(u) || u.includes(t)) return title;
  return `${title} · ${unit}`;
}

function arrayCandidates(
  r: Record<string, unknown>,
  known: { key: string; title: string }[]
): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const f of known) {
    if (Array.isArray(r[f.key])) { out.push([f.key, f.title]); seen.add(f.key); }
  }
  for (const [key, v] of Object.entries(r)) {
    if (seen.has(key) || !Array.isArray(v) || PLUMBING_RE.test(key)) continue;
    // No readable title, no block. `humaniseKey` returns null for keys with no letters (an index
    // map, a numeric bucket) — drawing a section headed "3" would be worse than drawing nothing.
    const title = humaniseKey(key);
    if (title) out.push([key, title]);
  }
  return out;
}

export function genericBlocksFrom(
  results: readonly unknown[],
  claimed: ReadonlySet<unknown>,
  source: VisualSystem = "LARGO"
): GenericBlocks {
  const out: GenericBlocks = { stats: null, ranked: null, events: null };

  for (const r of results) {
    /**
     * A TOOL THAT RETURNS A TOP-LEVEL ARRAY WAS INVISIBLE.
     *
     * `isRecord` excludes arrays — correct for the row-level checks, wrong as the gate on this
     * loop. `fetchHotTickers` (hot-tickers.ts) returns `HotTicker[]` with no wrapper, so
     * `get_hot_tickers` contributed NOTHING to any card: four named tickers with print counts and
     * premium totals, skipped before any validator saw them.
     *
     * Fifth member of the same family as the date-key, container-key and value-key allowlists —
     * a shape assumption that production does not match. Here the assumption was that a tool
     * result is an object.
     *
     * The rows still go through the SAME validators, so a bare array of junk yields nothing
     * exactly as a wrapped one does. The title comes from the quantity, since a bare array has no
     * key to name it after.
     */
    if (Array.isArray(r)) {
      if (claimed.has(r)) continue;
      if (!out.ranked) {
        const rows = rankedFromArray(r);
        if (rows.length >= MIN_RANKED) out.ranked = { title: rankedTitle("Ranked", rows), rows, source };
      }
      if (!out.events) {
        const rows = eventsFromArray(r);
        if (rows.length >= MIN_EVENTS) out.events = { title: "Schedule", rows, source };
      }
      continue;
    }
    if (!isRecord(r) || claimed.has(r)) continue;

    if (!out.events) {
      for (const [key, title] of arrayCandidates(r, EVENT_FIELDS)) {
        const rows = eventsFromArray(r[key]);
        if (rows.length >= MIN_EVENTS) { out.events = { title, rows, source }; break; }
      }
    }
    if (!out.ranked) {
      for (const [key, title] of arrayCandidates(r, RANKED_FIELDS)) {
        const rows = rankedFromArray(r[key]);
        if (rows.length >= MIN_RANKED) { out.ranked = { title: rankedTitle(title, rows), rows, source }; break; }
      }
    }
    /**
     * BEST payload wins, not the first one enumerated.
     *
     * Caught by rendering: a turn carrying a quote (4 fields) and an IV-stats payload (6) rendered
     * the QUOTE, because it happened to come first in `capturedResults` — and three of its four
     * fields duplicated the headline and hero already on the card. Tool call ORDER is an accident
     * of how Largo sequenced its reasoning; it carries no information about which payload is worth
     * drawing. Richness does.
     */
    const rows = statsFromRecord(r);
    if (rows.length >= MIN_STATS && rows.length > (out.stats?.rows.length ?? 0)) {
      out.stats = { title: "Readings", rows, source };
    }
  }

  return out;
}
