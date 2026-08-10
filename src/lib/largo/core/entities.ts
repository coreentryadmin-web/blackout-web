/**
 * CANONICAL ENTITY LAYER — one identity per thing, so results from different desks can be joined.
 *
 * THE PROBLEM. The same instrument wears a different name on every surface. SPX is `SPX` on the
 * quote route, `I:SPX` to Polygon, `SPXW` on the weekly chain, and `$SPX` when a member types it.
 * A contract is `O:NVDA260821C00230000` in a snapshot and "NVDA 230C 8/21" in prose. Until those
 * collapse to one key, "where do Helix and Thermal disagree" cannot be answered by CODE — only
 * guessed at by a model comparing strings, which is how two different instruments get reported as
 * one.
 *
 * WHAT THIS IS NOT. It is not a ticker validator and does not decide whether a symbol exists —
 * that is the provider's job, and pretending otherwise would mean maintaining a universe list that
 * silently rots. `canonicalTicker("ZZQQXX")` returns a well-formed key; whether it trades is
 * answered by trying to fetch it.
 *
 * PURE AND TOTAL. No IO, no clock, no throw. Every function returns null rather than guessing when
 * the input does not parse — a wrong join is far worse than a missing one, because a wrong join
 * produces a confident cross-product claim about two unrelated things.
 */

/** The index family. SPX/SPXW/XSP are DIFFERENT products that share an underlying. */
export type InstrumentKind = "equity" | "etf" | "index";

export type CanonicalTicker = {
  /** The join key. Uppercase, no prefix, no `$`. SPXW canonicalises to SPX. */
  key: string;
  /** Polygon-style symbol for index reads (`I:SPX`), else the plain key. */
  polygon: string;
  kind: InstrumentKind;
  /** True when the input named the WEEKLY SPX product specifically (SPXW). Callers that select a
   *  chain must not lose this — SPXW and SPX settle differently. */
  weeklyVariant: boolean;
  /** What the user actually typed, for echoing back without normalising away their words. */
  raw: string;
};

/** Indices the platform reads through Polygon's `I:` namespace. */
const INDEX_KEYS = new Set(["SPX", "VIX", "NDX", "RUT", "DJI", "VVIX", "SKEW"]);

/** Common ETFs — kind only affects labelling, never routing, so this list being partial is safe. */
const ETF_KEYS = new Set(["SPY", "QQQ", "IWM", "DIA", "SOXX", "XLF", "XLE", "XLK", "TLT", "GLD", "UVXY", "VXX"]);

/**
 * Collapse any spelling of an instrument to one canonical key.
 *
 * SPXW → SPX is the load-bearing case: the weekly and the monthly are one underlying for every
 * join (flow, GEX, levels), and treating them as separate keys would split a ticker's evidence
 * across two buckets and make each look thinner than it is. The distinction that DOES matter —
 * which chain to price — is preserved in `weeklyVariant` rather than thrown away.
 */
export function canonicalTicker(input: string | null | undefined): CanonicalTicker | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  let s = raw.toUpperCase().replace(/^\$/, "").replace(/^I:/, "").trim();
  if (!s) return null;
  // Reject anything that is not a plausible symbol BEFORE building a key, so a sentence never
  // becomes an entity.
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)) return null;

  let weeklyVariant = false;
  if (s === "SPXW") {
    s = "SPX";
    weeklyVariant = true;
  }

  const kind: InstrumentKind = INDEX_KEYS.has(s) ? "index" : ETF_KEYS.has(s) ? "etf" : "equity";
  return {
    key: s,
    polygon: kind === "index" ? `I:${s}` : s,
    kind,
    weeklyVariant,
    raw,
  };
}

/** Two inputs naming the same instrument? The join predicate, used instead of string equality. */
export function sameTicker(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalTicker(a);
  const cb = canonicalTicker(b);
  return !!ca && !!cb && ca.key === cb.key;
}

export type CanonicalContract = {
  /** OCC symbol without the `O:` prefix — the canonical contract key. */
  key: string;
  /** Underlying's canonical ticker key. */
  ticker: string;
  /** ISO date, `YYYY-MM-DD`. */
  expiry: string;
  right: "C" | "P";
  strike: number;
  raw: string;
};

/**
 * Parse an OCC option symbol.
 *
 * OCC packs strike as 8 digits in thousandths (`00230000` = 230.000). Getting that wrong by a
 * factor of 1000 is the classic bug and it does not look wrong — a $230 strike rendered as
 * $230,000 or $0.23 is obviously broken, but 230 vs 230000 on a chart axis can pass review. The
 * divisor is asserted in the tests against real symbols.
 */
export function parseOccSymbol(input: string | null | undefined): CanonicalContract | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  const s = raw.toUpperCase().replace(/^O:/, "");
  // ROOT (1-6) + YYMMDD + C|P + 8-digit strike
  const m = /^([A-Z][A-Z0-9]{0,5})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(s);
  if (!m) return null;
  const [, root, yy, mm, dd, right, strikeRaw] = m;

  const year = 2000 + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const strike = Number(strikeRaw) / 1000;
  if (!Number.isFinite(strike) || strike <= 0) return null;

  const ticker = canonicalTicker(root);
  if (!ticker) return null;

  return {
    key: s,
    ticker: ticker.key,
    expiry: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    right: right as "C" | "P",
    strike,
    raw,
  };
}

/** Build an OCC symbol. Round-trips with parseOccSymbol — asserted by test. */
export function buildOccSymbol(o: {
  ticker: string;
  expiry: string;
  right: "C" | "P";
  strike: number;
}): string | null {
  const t = canonicalTicker(o.ticker);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.expiry.trim());
  if (!t || !m || !Number.isFinite(o.strike) || o.strike <= 0) return null;
  // Round to the nearest tenth of a cent before scaling: floating-point strikes like 230.0000001
  // would otherwise produce a symbol no provider recognises.
  const strike = String(Math.round(o.strike * 1000)).padStart(8, "0");
  if (strike.length > 8) return null;
  return `${t.key}${m[1]!.slice(2)}${m[2]}${m[3]}${o.right}${strike}`;
}

/** A trading session, keyed by its ET calendar date. The join key for anything per-day. */
export function canonicalSession(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return `${us[3]}-${String(Number(us[1])).padStart(2, "0")}-${String(Number(us[2])).padStart(2, "0")}`;
  return null;
}

/**
 * Every distinct instrument named in a question.
 *
 * Deliberately conservative: only `$SYMBOL` or a token that canonicalises AND is in `known`.
 * Without the known-set gate, "IS SPX BULLISH" yields IS and SPX, and a question containing
 * "A CEO" yields A. A false entity is worse than a missed one — it sends a tool at a symbol the
 * member never mentioned and then reports the result as if they had.
 */
export function extractTickers(question: string, known: ReadonlySet<string>): CanonicalTicker[] {
  if (!question) return [];
  const out = new Map<string, CanonicalTicker>();
  for (const tok of question.match(/\$?[A-Za-z][A-Za-z0-9.\-]{0,9}/g) ?? []) {
    const explicit = tok.startsWith("$");
    const c = canonicalTicker(tok);
    if (!c) continue;
    // Case matters for the un-prefixed path: "it" and "In" are not tickers, "NVDA" is.
    const isUpper = tok.replace(/^\$/, "") === tok.replace(/^\$/, "").toUpperCase();
    if (!explicit && !(isUpper && known.has(c.key))) continue;
    if (!out.has(c.key)) out.set(c.key, c);
  }
  return [...out.values()];
}

/**
 * The resolved-entity digest injected into the turn's system prompt.
 *
 * Says nothing when there is nothing to say. It exists for the cases the model gets wrong on its
 * own: that `SPXW` and `SPX` are one instrument for every join (so evidence about them must be
 * pooled, not compared as two names), and that an index priced through Polygon needs the `I:`
 * prefix. Both are facts about our data plumbing, not about markets, so the model has no way to
 * know them and no way to notice when it guesses wrong.
 *
 * HINTS, never limits — nothing here restricts which tools run or which symbols they may be
 * called with. That distinction is the lesson of the deleted intent allowlist.
 */
export function formatEntityBlock(entities: readonly CanonicalTicker[], limit = 8): string {
  const list = entities.slice(0, Math.max(0, limit));
  if (list.length === 0) return "";
  const lines = list.map((e) => {
    const bits = [`${e.kind}`];
    if (e.polygon !== e.key) bits.push(`polygon ${e.polygon}`);
    if (e.weeklyVariant) bits.push("weekly chain (SPXW) — same underlying as SPX for joins");
    return `- ${e.key} (${bits.join(", ")})${e.raw.toUpperCase() !== e.key ? ` — asked as "${e.raw}"` : ""}`;
  });
  return (
    `\n\nRESOLVED ENTITIES (canonical join keys — HINTS, not limits):\n${lines.join("\n")}\n` +
    `Use these keys when correlating results across desks; different desks spell the same ` +
    `instrument differently.\n`
  );
}
