/**
 * LARGO BLOCK SCHEMA — the semantic components Largo can emit, and a parser that never throws.
 *
 * WHY A SCHEMA AND NOT MARKDOWN TABLES.
 * Markdown gives one shape: text with pipes in it. A comparison matrix, a P&L summary and a key-level
 * rail are all semantically different things that happen to LOOK tabular, and flattening them into
 * pipes throws away everything the UI needs to render them well — which cell is the bias, which
 * number is the delta, whether a level is support or resistance, whether a badge means "confirmed"
 * or "stale". This schema keeps the MEANING, so the frontend can render BLACKOUT-native components
 * instead of a generic table, and so mobile can reflow a comparison into stacked cards rather than
 * sideways-scrolling a grid.
 *
 * WIRE FORMAT — a fenced code block inside the normal answer:
 *
 *     ```blackout
 *     { "type": "comparison", "title": "Signal alignment", "rows": [...] }
 *     ```
 *
 * Chosen over "the whole answer is one JSON document" for three reasons that all matter here:
 *
 *  1. STREAMING SURVIVES. The answer is still markdown, so prose streams token-by-token exactly as
 *     today. A block renders when its closing fence arrives. A single JSON document would arrive as
 *     one blob at the end of a 40s turn and the terminal would go dead while the member waits.
 *  2. IT DEGRADES INSTEAD OF BLANKING. Malformed JSON is dropped (or shown as code) and the
 *     surrounding prose still renders. With whole-answer JSON, one bad character costs the entire
 *     answer — the worst possible failure for a member who just waited 40 seconds.
 *  3. SIMPLE STAYS SIMPLE. "SPX?" emits no blocks at all and costs nothing. The rich path is opt-in
 *     per answer, decided by the model, which is the requirement: Largo picks the presentation, we
 *     do not template it.
 *
 * EVERY PARSER HERE IS TOTAL. `parseLargoBlock` returns null rather than throwing on any input,
 * because this runs on a member's answer: a schema slip must cost one component, never the reply.
 * Validation is deliberately strict about SHAPE (a table with no rows is not a table) and lenient
 * about EXTRAS (an unknown field is ignored, so the model adding a field cannot break rendering).
 */

/** Directional tone. Drives colour everywhere — never invent a second vocabulary for this. */
export type LargoTone = "bullish" | "bearish" | "neutral" | "warning" | "info";

export const LARGO_TONES: readonly LargoTone[] = ["bullish", "bearish", "neutral", "warning", "info"];

/** Data freshness, mirroring the answer envelope so one vocabulary covers prose and components. */
export type LargoFreshness = "live" | "recent" | "stale" | "unknown";

export const LARGO_FRESHNESS: readonly LargoFreshness[] = ["live", "recent", "stale", "unknown"];

/** Provenance carried by any block that shows a number. The honesty spine, in component form. */
export type LargoSource = {
  label: string;
  asOf?: string | null;
  freshness?: LargoFreshness;
};

export type LargoBlock =
  /** Section header with an optional directional badge and confidence read. */
  | {
      type: "header";
      title: string;
      subtitle?: string;
      tone?: LargoTone;
      badge?: string;
      confidence?: { level: "high" | "moderate" | "low" | "insufficient"; pct?: number; why?: string };
    }
  /** A row of metric cards — the terminal-dashboard strip. */
  | {
      type: "metrics";
      title?: string;
      items: Array<{
        label: string;
        value: string;
        delta?: string;
        tone?: LargoTone;
        note?: string;
        source?: LargoSource;
      }>;
    }
  /** The signal-alignment matrix: one row per source, each with a reading and a bias. */
  | {
      type: "comparison";
      title?: string;
      /** Column headers for the reading columns. Defaults to ["Signal", "Reading", "Bias"]. */
      columns?: string[];
      rows: Array<{ label: string; reading: string; tone?: LargoTone; note?: string; source?: LargoSource }>;
    }
  /** A genuine data table where the columns are arbitrary. */
  | {
      type: "table";
      title?: string;
      columns: string[];
      rows: string[][];
      /** Column indices to render right-aligned/monospace as numerics. */
      numericColumns?: number[];
      source?: LargoSource;
    }
  /** Ordered list where rank carries meaning (top setups, biggest movers). */
  | {
      type: "ranked";
      title?: string;
      items: Array<{ label: string; value?: string; tone?: LargoTone; note?: string }>;
    }
  /** Key price levels, rendered as a rail rather than a table. */
  | {
      type: "levels";
      title?: string;
      spot?: number;
      items: Array<{
        label: string;
        price: number;
        kind?: "support" | "resistance" | "pivot" | "target" | "stop";
        note?: string;
        source?: LargoSource;
      }>;
    }
  /** Bull vs bear evidence, side by side. */
  | {
      type: "evidence";
      title?: string;
      bull: string[];
      bear: string[];
    }
  /** Time-ordered events — session timeline, catalyst schedule, play lifecycle. */
  | {
      type: "timeline";
      title?: string;
      items: Array<{ at: string; label: string; tone?: LargoTone; note?: string }>;
    }
  /** Option contracts with the fields a trader actually needs. */
  | {
      type: "contracts";
      title?: string;
      items: Array<{
        ticker: string;
        right: "C" | "P";
        strike: number;
        expiry: string;
        mark?: string;
        delta?: string;
        iv?: string;
        oi?: string;
        note?: string;
        tone?: LargoTone;
      }>;
    }
  /** Realised/unrealised P&L summary for a set of positions. */
  | {
      type: "pnl";
      title?: string;
      items: Array<{ label: string; entry?: string; current?: string; pnl: string; pct?: string; tone?: LargoTone }>;
      total?: { pnl: string; pct?: string; tone?: LargoTone };
    }
  /** Pull-quote / what-matters-now callout. */
  | { type: "callout"; title?: string; body: string; tone?: LargoTone }
  /** Risk + invalidation box. Deliberately its own type so it can never render as a soft note. */
  | { type: "risk"; title?: string; items: string[]; invalidation?: string };

export type LargoBlockType = LargoBlock["type"];

export const LARGO_BLOCK_TYPES: readonly LargoBlockType[] = [
  "header",
  "metrics",
  "comparison",
  "table",
  "ranked",
  "levels",
  "evidence",
  "timeline",
  "contracts",
  "pnl",
  "callout",
  "risk",
];

// ── validation helpers (total, never throw) ───────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const tone = (v: unknown): LargoTone | undefined =>
  typeof v === "string" && (LARGO_TONES as readonly string[]).includes(v) ? (v as LargoTone) : undefined;
const fresh = (v: unknown): LargoFreshness | undefined =>
  typeof v === "string" && (LARGO_FRESHNESS as readonly string[]).includes(v) ? (v as LargoFreshness) : undefined;

function source(v: unknown): LargoSource | undefined {
  if (!isObj(v)) return undefined;
  const label = str(v.label) ?? str(v.source);
  if (!label) return undefined;
  return { label, asOf: str(v.asOf) ?? null, freshness: fresh(v.freshness) };
}

/** Array-of-objects helper: maps, drops anything the row mapper rejects, and returns undefined
 *  when nothing survived — so an "items" block with no valid items is rejected as a whole rather
 *  than rendering an empty shell with a confident title above it. */
function rows<T>(v: unknown, map: (row: Record<string, unknown>) => T | null): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: T[] = [];
  for (const r of v) {
    if (!isObj(r)) continue;
    const m = map(r);
    if (m) out.push(m);
  }
  return out.length ? out : undefined;
}

/**
 * Parse one candidate block. Returns null for anything that is not a valid, non-empty block.
 *
 * Strict on shape, lenient on extras: unknown fields are ignored so the model adding a key can
 * never break rendering, but a structurally empty block (a table with no rows, a comparison with
 * no signals) is REJECTED. An empty component under a confident heading is worse than no
 * component — it reads as "there is no data" when the truth is "the model emitted a malformed
 * block", and a member cannot tell those apart.
 */
export function parseLargoBlock(raw: unknown): LargoBlock | null {
  if (!isObj(raw)) return null;
  const type = str(raw.type);
  if (!type) return null;

  switch (type) {
    case "header": {
      const title = str(raw.title);
      if (!title) return null;
      const c = isObj(raw.confidence) ? raw.confidence : null;
      const level = c && typeof c.level === "string" && ["high", "moderate", "low", "insufficient"].includes(c.level)
        ? (c.level as "high" | "moderate" | "low" | "insufficient")
        : undefined;
      return {
        type: "header",
        title,
        subtitle: str(raw.subtitle),
        tone: tone(raw.tone),
        badge: str(raw.badge),
        confidence: level ? { level, pct: num(c?.pct), why: str(c?.why) } : undefined,
      };
    }
    case "metrics": {
      const items = rows(raw.items, (r) => {
        const label = str(r.label);
        const value = str(r.value);
        if (!label || !value) return null;
        return { label, value, delta: str(r.delta), tone: tone(r.tone), note: str(r.note), source: source(r.source) };
      });
      return items ? { type: "metrics", title: str(raw.title), items } : null;
    }
    case "comparison": {
      const rs = rows(raw.rows, (r) => {
        const label = str(r.label) ?? str(r.signal);
        const reading = str(r.reading) ?? str(r.value);
        if (!label || !reading) return null;
        return { label, reading, tone: tone(r.tone) ?? tone(r.bias), note: str(r.note), source: source(r.source) };
      });
      if (!rs) return null;
      const cols = Array.isArray(raw.columns) ? raw.columns.map((c) => str(c)).filter((c): c is string => !!c) : undefined;
      return { type: "comparison", title: str(raw.title), columns: cols?.length === 3 ? cols : undefined, rows: rs };
    }
    case "table": {
      const columns = Array.isArray(raw.columns)
        ? raw.columns.map((c) => str(c) ?? "").filter((c) => c !== "")
        : [];
      if (!columns.length) return null;
      const body = Array.isArray(raw.rows)
        ? raw.rows
            .filter((r): r is unknown[] => Array.isArray(r))
            // Pad/trim to the header width so a ragged row can never shift every cell after it
            // into the wrong column — a silently wrong table is the worst kind.
            .map((r) => Array.from({ length: columns.length }, (_, i) => (r[i] == null ? "" : String(r[i]))))
        : [];
      if (!body.length) return null;
      const numericColumns = Array.isArray(raw.numericColumns)
        ? raw.numericColumns.map((n) => num(n)).filter((n): n is number => n != null && n >= 0 && n < columns.length)
        : undefined;
      return { type: "table", title: str(raw.title), columns, rows: body, numericColumns, source: source(raw.source) };
    }
    case "ranked": {
      const items = rows(raw.items, (r) => {
        const label = str(r.label);
        if (!label) return null;
        return { label, value: str(r.value), tone: tone(r.tone), note: str(r.note) };
      });
      return items ? { type: "ranked", title: str(raw.title), items } : null;
    }
    case "levels": {
      const items = rows(raw.items, (r) => {
        const label = str(r.label);
        const price = num(r.price);
        if (!label || price == null) return null;
        const k = str(r.kind);
        const kind = k && ["support", "resistance", "pivot", "target", "stop"].includes(k)
          ? (k as "support" | "resistance" | "pivot" | "target" | "stop")
          : undefined;
        return { label, price, kind, note: str(r.note), source: source(r.source) };
      });
      return items ? { type: "levels", title: str(raw.title), spot: num(raw.spot), items } : null;
    }
    case "evidence": {
      const list = (v: unknown) =>
        Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : [];
      const bull = list(raw.bull);
      const bear = list(raw.bear);
      // One-sided is legitimate — a genuinely one-way tape has no bear column — but both empty is
      // an empty component.
      if (!bull.length && !bear.length) return null;
      return { type: "evidence", title: str(raw.title), bull, bear };
    }
    case "timeline": {
      const items = rows(raw.items, (r) => {
        const at = str(r.at) ?? str(r.time);
        const label = str(r.label);
        if (!at || !label) return null;
        return { at, label, tone: tone(r.tone), note: str(r.note) };
      });
      return items ? { type: "timeline", title: str(raw.title), items } : null;
    }
    case "contracts": {
      const items = rows(raw.items, (r) => {
        const ticker = str(r.ticker);
        const strike = num(r.strike);
        const expiry = str(r.expiry);
        const rightRaw = str(r.right)?.toUpperCase();
        const right = rightRaw === "C" || rightRaw === "CALL" ? "C" : rightRaw === "P" || rightRaw === "PUT" ? "P" : null;
        if (!ticker || strike == null || !expiry || !right) return null;
        return {
          ticker: ticker.toUpperCase(),
          right: right as "C" | "P",
          strike,
          expiry,
          mark: str(r.mark),
          delta: str(r.delta),
          iv: str(r.iv),
          oi: str(r.oi),
          note: str(r.note),
          tone: tone(r.tone),
        };
      });
      return items ? { type: "contracts", title: str(raw.title), items } : null;
    }
    case "pnl": {
      const items = rows(raw.items, (r) => {
        const label = str(r.label);
        const pnl = str(r.pnl);
        if (!label || !pnl) return null;
        return { label, entry: str(r.entry), current: str(r.current), pnl, pct: str(r.pct), tone: tone(r.tone) };
      });
      if (!items) return null;
      const t = isObj(raw.total) ? raw.total : null;
      const totalPnl = t ? str(t.pnl) : undefined;
      return {
        type: "pnl",
        title: str(raw.title),
        items,
        total: totalPnl ? { pnl: totalPnl, pct: str(t?.pct), tone: tone(t?.tone) } : undefined,
      };
    }
    case "callout": {
      const body = str(raw.body) ?? str(raw.text);
      if (!body) return null;
      return { type: "callout", title: str(raw.title), body, tone: tone(raw.tone) };
    }
    case "risk": {
      const items = Array.isArray(raw.items)
        ? raw.items.map((x) => str(x)).filter((x): x is string => !!x)
        : [];
      const invalidation = str(raw.invalidation);
      if (!items.length && !invalidation) return null;
      return { type: "risk", title: str(raw.title), items, invalidation };
    }
    default:
      // An unrecognised type is dropped rather than rendered as raw JSON. A future block type
      // shipped by the prompt before the renderer knows it should be invisible, not ugly.
      return null;
  }
}

/** Parse a fenced payload that may hold one block or an array of them. Always returns an array. */
export function parseLargoBlockPayload(json: string): LargoBlock[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const candidates = Array.isArray(raw) ? raw : [raw];
  const out: LargoBlock[] = [];
  for (const c of candidates) {
    const b = parseLargoBlock(c);
    if (b) out.push(b);
  }
  return out;
}
