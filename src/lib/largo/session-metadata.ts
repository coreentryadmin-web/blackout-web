/**
 * Largo session metadata — watchlist memory, morning-brief opt-in, play context.
 * Stored on largo_sessions.metadata (JSONB), scoped per user+session.
 */

export type LargoPlayContext = {
  source: "spx" | "nighthawk" | "zerodte";
  ticker: string;
  contract?: string | null;
  grade?: string | null;
  invalidation?: string | null;
  status?: string | null;
  entry?: number | null;
  mark?: number | null;
};

export type LargoSessionMetadata = {
  watchlist?: string[];
  morning_brief?: boolean;
  play_context?: LargoPlayContext | null;
  /** Last depth mode the member used in this session. */
  depth?: "quick" | "deep";
};

const MAX_WATCHLIST = 12;

export function normalizeWatchlist(tickers: unknown): string[] {
  if (!Array.isArray(tickers)) return [];
  const out: string[] = [];
  for (const raw of tickers) {
    const t = String(raw ?? "")
      .trim()
      .toUpperCase()
      .replace(/^\$/, "");
    if (!t || t.length > 6 || !/^[A-Z][A-Z0-9.-]{0,5}$/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= MAX_WATCHLIST) break;
  }
  return out;
}

/** Parse "remember I trade SPX and NVDA" from natural language. */
export function extractWatchlistFromText(text: string): string[] | null {
  const m = text.match(
    /\bremember\s+(?:i\s+)?(?:trade|watch|focus on|follow)\s+(.+?)(?:[.?!]|$)/i
  );
  if (!m?.[1]) return null;
  const chunk = m[1];
  const tokens = chunk
    .split(/\s*,\s*|\s+and\s+|\s+/i)
    .map((s) => s.trim().toUpperCase().replace(/^\$/, ""))
    .filter(Boolean);
  const list = normalizeWatchlist(tokens);
  return list.length ? list : null;
}

export function mergeSessionMetadata(
  prev: LargoSessionMetadata | null | undefined,
  patch: Partial<LargoSessionMetadata>
): LargoSessionMetadata {
  const base = prev && typeof prev === "object" ? { ...prev } : {};
  if (patch.watchlist) base.watchlist = normalizeWatchlist(patch.watchlist);
  if (patch.morning_brief != null) base.morning_brief = Boolean(patch.morning_brief);
  if (patch.play_context !== undefined) base.play_context = patch.play_context;
  if (patch.depth === "quick" || patch.depth === "deep") base.depth = patch.depth;
  return base;
}

export function formatWatchlistBlock(watchlist: string[] | undefined): string {
  if (!watchlist?.length) return "";
  return `\n\n## Member watchlist\nTickers this member cares about: ${watchlist.join(", ")}. Prefer these when the question is ambiguous.\n`;
}

export function formatPlayContextBlock(ctx: LargoPlayContext | null | undefined): string {
  if (!ctx?.ticker) return "";
  const lines = [
    `\n\n## Attached play context`,
    `Source desk: ${ctx.source}`,
    `Ticker: ${ctx.ticker}`,
  ];
  if (ctx.contract) lines.push(`Contract: ${ctx.contract}`);
  if (ctx.grade) lines.push(`Grade: ${ctx.grade}`);
  if (ctx.invalidation) lines.push(`Invalidation: ${ctx.invalidation}`);
  if (ctx.status) lines.push(`Status: ${ctx.status}`);
  if (ctx.entry != null) lines.push(`Entry: ${ctx.entry}`);
  if (ctx.mark != null) lines.push(`Mark: ${ctx.mark}`);
  lines.push("Explain THIS play using live tools — do not invent levels.");
  return lines.join("\n") + "\n";
}

export function parsePlayContextFromSearchParams(
  params: URLSearchParams | Record<string, string | null | undefined>
): LargoPlayContext | null {
  const get = (k: string) => {
    if (params instanceof URLSearchParams) return params.get(k);
    return params[k] ?? null;
  };
  const explain = get("explain");
  const ticker = (get("ticker") ?? get("play_ticker") ?? "").trim().toUpperCase();
  if (!ticker && explain !== "1") return null;
  const sourceRaw = (get("from") ?? get("desk") ?? "spx").toLowerCase();
  const source =
    sourceRaw === "nighthawk" || sourceRaw === "hawk"
      ? "nighthawk"
      : sourceRaw === "zerodte" || sourceRaw === "0dte"
        ? "zerodte"
        : "spx";
  return {
    source,
    ticker: ticker || "SPX",
    contract: get("contract") ?? get("occ") ?? null,
    grade: get("grade") ?? null,
    invalidation: get("invalidation") ?? get("stop") ?? null,
    status: get("status") ?? null,
    entry: get("entry") ? Number(get("entry")) : null,
    mark: get("mark") ? Number(get("mark")) : null,
  };
}
