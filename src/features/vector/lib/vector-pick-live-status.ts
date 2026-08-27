/**
 * Live action status for a ranked Vector contract pick — pure, testable rules for
 * Still Buy / Caution / Don't Buy from spot, play invalidation, and live quotes.
 */
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/features/nighthawk/lib/constants";
import { pinnedLivePnlPct, resolveZeroDteMark, zeroDteMidOf } from "@/lib/zerodte/marks-math";

export type VectorPickActionStatus = "still_buy" | "caution" | "dont_buy";

export type VectorPickLiveQuote = {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  delta: number | null;
  gamma?: number | null;
  theta?: number | null;
  iv?: number | null;
  markStale?: boolean;
};

export type VectorPickLiveEvalInput = {
  spot: number;
  side: "call" | "put";
  entryMid: number | null;
  caveat?: "premium_high" | "low_liquidity" | "premium_high_low_liquidity";
  invalidation?: string | null;
  bias?: "long" | "short" | "range" | "neutral";
  callWall?: number | null;
  putWall?: number | null;
  gammaFlip?: number | null;
  quote: VectorPickLiveQuote;
};

export type VectorPickLiveEval = {
  status: VectorPickActionStatus;
  reason: string;
  premiumPctFromEntry: number | null;
  invalidationLevel: number | null;
  setupInvalidated: boolean;
};

/** Parse the price level from a play invalidation string (skips timeframe tokens like 5m). */
export function parseInvalidationLevel(invalidation: string | null | undefined): number | null {
  if (!invalidation) return null;
  const matches = [...invalidation.matchAll(/([\d,]+(?:\.\d+)?)/g)];
  for (const m of matches) {
    const idx = m.index ?? 0;
    const tail = invalidation.slice(idx + m[0].length, idx + m[0].length + 1);
    if (tail === "m" || tail === "M" || tail === "H") continue;
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 10) return n;
  }
  return null;
}

/** Premium drift vs pick-time mid — shared with the 0DTE live-marks lane (pinnedLivePnlPct). */
export function premiumDriftPct(entryMid: number | null, liveMid: number | null): number | null {
  return pinnedLivePnlPct(entryMid, liveMid);
}

/**
 * Resolve the live mark for a Vector pick quote. Prefers a two-sided mid over a stored
 * `mark` field — the options WS can carry a last-trade fallback in `mark` while bid/ask
 * are fresh, which would otherwise inflate/deflate "% vs pick" vs the chain mid used at rank time.
 */
export function resolveVectorPickLiveMid(input: {
  bid: number | null;
  ask: number | null;
  mark?: number | null;
  last?: number | null;
}): number | null {
  return resolveZeroDteMark(input.bid, input.ask, input.last ?? input.mark ?? null).mark;
}

function spreadPct(bid: number | null, ask: number | null, mid: number | null): number | null {
  if (bid == null || ask == null || mid == null || mid <= 0 || ask < bid) return null;
  return ((ask - bid) / mid) * 100;
}

/** Spot-based setup invalidation from the play's textual invalidation rule. */
export function isSetupInvalidated(
  spot: number,
  invalidation: string | null | undefined,
  bias: VectorPickLiveEvalInput["bias"],
  callWall: number | null | undefined,
  putWall: number | null | undefined,
  gammaFlip: number | null | undefined
): { invalidated: boolean; level: number | null } {
  const text = (invalidation ?? "").toLowerCase();
  const level = parseInvalidationLevel(invalidation);

  if (level != null) {
    if (text.includes("close >") || text.includes("back >") || text.includes("above")) {
      if (spot > level) return { invalidated: true, level };
    }
    if (text.includes("close <") || text.includes("back <") || text.includes("below")) {
      if (spot < level) return { invalidated: true, level };
    }
    if (text.includes("back through")) {
      if (bias === "long" && spot < level) return { invalidated: true, level };
      if (bias === "short" && spot > level) return { invalidated: true, level };
    }
  }

  if (text.includes("short gamma") && gammaFlip != null && spot < gammaFlip) {
    return { invalidated: true, level: gammaFlip };
  }

  if (bias === "long" && putWall != null && spot < putWall * 0.995) {
    return { invalidated: true, level: putWall };
  }
  if (bias === "short" && callWall != null && spot > callWall * 1.005) {
    return { invalidated: true, level: callWall };
  }

  return { invalidated: false, level };
}

/**
 * Evaluate whether a member should still buy this contract right now.
 * Uses live bid/ask mid, entry anchor, play invalidation, and liquidity gates.
 */
export function evaluateVectorPickLiveStatus(input: VectorPickLiveEvalInput): VectorPickLiveEval {
  const { quote, spot, entryMid } = input;
  const mid =
    quote.mid ??
    zeroDteMidOf(quote.bid, quote.ask);
  const premiumPct = premiumDriftPct(entryMid, mid);
  const inv = isSetupInvalidated(
    spot,
    input.invalidation,
    input.bias,
    input.callWall,
    input.putWall,
    input.gammaFlip
  );

  if (inv.invalidated) {
    return {
      status: "dont_buy",
      reason: inv.level != null ? `Setup invalidated — spot ${spot.toFixed(2)} vs ${inv.level.toFixed(2)}` : "Setup invalidated",
      premiumPctFromEntry: premiumPct,
      invalidationLevel: inv.level,
      setupInvalidated: true,
    };
  }

  if (quote.markStale || mid == null) {
    return {
      status: "caution",
      reason: "Live quote stale — verify premium at your broker before entry",
      premiumPctFromEntry: premiumPct,
      invalidationLevel: inv.level,
      setupInvalidated: false,
    };
  }

  if (mid > MAX_OPTION_PREMIUM_PER_SHARE) {
    return {
      status: "dont_buy",
      reason: `Premium $${mid.toFixed(2)} above desk cap ($${MAX_OPTION_PREMIUM_PER_SHARE})`,
      premiumPctFromEntry: premiumPct,
      invalidationLevel: inv.level,
      setupInvalidated: false,
    };
  }

  const spread = spreadPct(quote.bid, quote.ask, mid);
  if (spread != null && spread > 35) {
    return {
      status: "caution",
      reason: `Wide spread (${spread.toFixed(0)}%) — use a limit inside the quote`,
      premiumPctFromEntry: premiumPct,
      invalidationLevel: inv.level,
      setupInvalidated: false,
    };
  }

  if (premiumPct != null && premiumPct >= 20) {
    return {
      status: "dont_buy",
      reason: `Premium extended +${premiumPct.toFixed(0)}% since pick — chase risk`,
      premiumPctFromEntry: premiumPct,
      invalidationLevel: inv.level,
      setupInvalidated: false,
    };
  }

  if (
    input.caveat === "low_liquidity" ||
    input.caveat === "premium_high_low_liquidity"
  ) {
    return {
      status: "caution",
      reason: "Thin open interest — limit order only",
      premiumPctFromEntry: premiumPct,
      invalidationLevel: inv.level,
      setupInvalidated: false,
    };
  }

  if (input.caveat === "premium_high") {
    return {
      status: "caution",
      reason: "Premium above standard cap at rank time — size down",
      premiumPctFromEntry: premiumPct,
      invalidationLevel: inv.level,
      setupInvalidated: false,
    };
  }

  if (premiumPct != null && premiumPct >= 10) {
    return {
      status: "caution",
      reason: `Premium +${premiumPct.toFixed(0)}% since pick — still tradable with a limit`,
      premiumPctFromEntry: premiumPct,
      invalidationLevel: inv.level,
      setupInvalidated: false,
    };
  }

  const bid = quote.bid;
  const ask = quote.ask;
  const range =
    bid != null && ask != null && ask >= bid
      ? `$${bid.toFixed(2)}–$${ask.toFixed(2)}`
      : `$${mid.toFixed(2)}`;

  return {
    status: "still_buy",
    reason: `Still buy — live ${range}${premiumPct != null ? ` (${premiumPct >= 0 ? "+" : ""}${premiumPct.toFixed(0)}% vs pick)` : ""}`,
    premiumPctFromEntry: premiumPct,
    invalidationLevel: inv.level,
    setupInvalidated: false,
  };
}

export function formatPickPremiumRange(bid: number | null, ask: number | null, mid: number | null): string | null {
  if (bid != null && ask != null && ask >= bid && ask > 0) {
    return `$${bid.toFixed(2)}–$${ask.toFixed(2)}`;
  }
  if (mid != null && mid > 0) return `@ $${mid.toFixed(2)}`;
  return null;
}

/** Pin the first-seen entry mid per OCC across pick refreshes (45s cadence). */
export function pinVectorPickEntryMid(
  pinned: Map<string, number>,
  occ: string,
  incoming: number
): number {
  const existing = pinned.get(occ);
  if (existing != null) return existing;
  pinned.set(occ, incoming);
  return incoming;
}

/** Compact drift vs pick-time mid for pick rows, e.g. "+12%" / "-8%". */
export function formatPickPremiumDriftPct(pct: number | null | undefined): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}
