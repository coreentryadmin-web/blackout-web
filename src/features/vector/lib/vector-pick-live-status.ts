/**
 * Live action status for a ranked Vector contract pick — pure, testable rules for
 * Still Buy / Caution / Don't Buy from spot, play invalidation, and live quotes.
 */
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/features/nighthawk/lib/constants";
import { pinnedLivePnlPct, resolveZeroDteMark, zeroDteMidOf } from "@/lib/zerodte/marks-math";
import {
  resolveInvalidationSpot,
  type InvalidationBar,
} from "./vector-pick-invalidation";

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
  /**
   * `fresh_entry` — should a member enter NOW (Vector desk PLYS strip).
   * `tracked` — server sweep / Night Hawk board row already on the book; never
   * archive a +50% winner as "chase risk" (found live 2026-09-01: AAPL +205%
   * marked dont_buy while still the session's top winner).
   */
  intent?: "fresh_entry" | "tracked";
  /** Contract role from ranking — enables per-leg invalidation on range plays. */
  pickRole?: string | null;
  /** Optional 1m seed bars for bar-close invalidation (sweep passes these). */
  bars?: readonly InvalidationBar[];
  nowMs?: number;
};

/** Sub-$0.10 entry mids make %-from-entry meaningless on penny quotes. */
export const VECTOR_PICK_MIN_ENTRY_MID_FOR_PCT = 0.1;

/**
 * Tick-cross buffer for textual "5m close >/< level" rules — we only have live spot, not a
 * closed bar. Without this, a $0.46 pierce (AAPL 325.46 vs 325.00) or $0.33 dip (IWM 290.67 vs
 * 291.00) instant-invalidates high-conviction plays (measured 2026-09-01: 119 setup_invalidated
 * closures, worst losers all within 0.1–0.5% of the level).
 */
export const VECTOR_PICK_INVALIDATION_BUFFER_PCT = 0.15;

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
    // No floor beyond finiteness — Vector is not restricted to a preset ticker universe
    // (isVectorTickerAllowed accepts any optionable symbol), so a legitimate invalidation
    // level under $10 is a real, reachable case (2026-08-29 audit finding), not noise to
    // filter out. The timeframe tokens ("5m", "1H") this loop must skip are already excluded
    // by the tail check above; an arbitrary n>=10 floor served no purpose except silently
    // dropping real low-priced levels, which left isSetupInvalidated's "close >"/"close <"
    // branches permanently unreachable (level stayed null) for any such ticker.
    if (Number.isFinite(n)) return n;
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
  gammaFlip: number | null | undefined,
  pickRole?: string | null
): { invalidated: boolean; level: number | null } {
  const text = (invalidation ?? "").toLowerCase();
  const level = parseInvalidationLevel(invalidation);
  const buf = VECTOR_PICK_INVALIDATION_BUFFER_PCT / 100;

  if (level != null) {
    if (text.includes("close >") || text.includes("back >") || text.includes("above")) {
      if (spot > level * (1 + buf)) return { invalidated: true, level };
    }
    if (text.includes("close <") || text.includes("back <") || text.includes("below")) {
      if (spot < level * (1 - buf)) return { invalidated: true, level };
    }
    if (text.includes("back through")) {
      if (bias === "long" && spot < level) return { invalidated: true, level };
      if (bias === "short" && spot > level) return { invalidated: true, level };
    }
  }

  if (text.includes("short gamma") && gammaFlip != null && spot < gammaFlip * (1 - buf)) {
    return { invalidated: true, level: gammaFlip };
  }

  // Range plays carry bias "range" — wall-break fallbacks are per-leg via pickRole.
  if (bias === "range" && pickRole) {
    if (pickRole === "fade-dip" && putWall != null && spot < putWall * (1 - buf)) {
      return { invalidated: true, level: putWall };
    }
    if (pickRole === "fade-rip" && callWall != null && spot > callWall * (1 + buf)) {
      return { invalidated: true, level: callWall };
    }
    return { invalidated: false, level };
  }

  if (bias === "long" && putWall != null && spot < putWall * (1 - buf)) {
    return { invalidated: true, level: putWall };
  }
  if (bias === "short" && callWall != null && spot > callWall * (1 + buf)) {
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
  const intent = input.intent ?? "fresh_entry";
  const mid =
    quote.mid ??
    zeroDteMidOf(quote.bid, quote.ask);
  const premiumPct = premiumDriftPct(entryMid, mid);
  const invSpot = resolveInvalidationSpot({
    liveSpot: spot,
    invalidation: input.invalidation,
    bars: input.bars,
    nowMs: input.nowMs,
  });
  const inv = isSetupInvalidated(
    invSpot,
    input.invalidation,
    input.bias,
    input.callWall,
    input.putWall,
    input.gammaFlip,
    input.pickRole
  );

  if (
    entryMid != null &&
    entryMid > 0 &&
    entryMid < VECTOR_PICK_MIN_ENTRY_MID_FOR_PCT &&
    premiumPct != null &&
    Math.abs(premiumPct) >= 25
  ) {
    return {
      status: "caution",
      reason: `Sub-$${VECTOR_PICK_MIN_ENTRY_MID_FOR_PCT.toFixed(2)} entry — verify premium at your broker`,
      premiumPctFromEntry: premiumPct,
      invalidationLevel: inv.level,
      setupInvalidated: inv.invalidated,
    };
  }

  if (inv.invalidated) {
    // Spot broke the play thesis but the contract can still be up big (measured INTC 2026-08-28:
    // +275% while momentum_rs_floor blocked 0DTE — Vector/NH must not instant-close winners).
    // Caution keeps the pick in the leaders lane; fresh entry is still blocked at dont_buy below.
    if (premiumPct != null && premiumPct >= 15) {
      return {
        status: "caution",
        reason:
          inv.level != null
            ? `Setup invalidated but premium +${premiumPct.toFixed(0)}% — manage exit, not fresh entry (spot ${spot.toFixed(2)} vs ${inv.level.toFixed(2)})`
            : `Setup invalidated but premium +${premiumPct.toFixed(0)}% — manage exit, not fresh entry`,
        premiumPctFromEntry: premiumPct,
        invalidationLevel: inv.level,
        setupInvalidated: true,
      };
    }
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

  if (premiumPct != null && premiumPct >= 50) {
    return {
      status: "caution",
      reason: `Winner +${premiumPct.toFixed(0)}% — manage exit, not fresh entry`,
      premiumPctFromEntry: premiumPct,
      invalidationLevel: inv.level,
      setupInvalidated: false,
    };
  }

  if (premiumPct != null && premiumPct >= 20) {
    if (intent === "tracked") {
      if (premiumPct >= 50) {
        return {
          status: "caution",
          reason: `Winner +${premiumPct.toFixed(0)}% — manage exit, not fresh entry`,
          premiumPctFromEntry: premiumPct,
          invalidationLevel: inv.level,
          setupInvalidated: false,
        };
      }
      return {
        status: "caution",
        reason: `Extended +${premiumPct.toFixed(0)}% — limit only, not fresh entry`,
        premiumPctFromEntry: premiumPct,
        invalidationLevel: inv.level,
        setupInvalidated: false,
      };
    }
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
