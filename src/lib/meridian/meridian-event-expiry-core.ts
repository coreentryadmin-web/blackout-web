/**
 * Scope dealer structure to the expiry that actually covers the EVENT.
 *
 * ── THE DEFECT THIS EXISTS TO FIX ────────────────────────────────────────────────────
 * Meridian read `call_wall` / `put_wall` / `flip` / `max_pain` straight off the whole-book GEX
 * matrix, with no expiry argument. Those aggregates are, by the matrix's own definition:
 *
 *   walls / flip  summed over the ~8 NEAREST expiries
 *   max_pain      scoped to the FRONT expiry alone
 *
 * For a print ten days out that is wrong twice over. The front expiry may die a week before the
 * company reports, so its max pain describes a chain that will never see the news; and the
 * near-term sum is dominated by whichever weekly carries the most open interest, which is
 * usually not the one spanning the event. The matrix's own comment says panels should re-scope
 * from `cells` "instead of showing an aggregate flip beside a single-expiry max pain" — which is
 * precisely what the earnings desk was doing.
 *
 * ── WHAT "COVERS THE EVENT" MEANS ────────────────────────────────────────────────────
 * The first listed expiry ON OR AFTER the report date. An expiry before the print cannot price
 * it; the first one after is the contract a member would actually trade the event in. For an AMC
 * print the same-day expiry still qualifies, because it settles after the release.
 *
 * Everything here is pure and returns nulls rather than guesses. `expiryUsed` is always reported
 * so the panel can SAY which chain it is describing — an unlabelled level is the thing that let
 * this go unnoticed.
 */

import { num, round } from "./meridian-viz-core";

export type ExpiryScopedStructure = {
  /** The expiry these levels describe. Null when none could be chosen. */
  expiryUsed: string | null;
  /** Calendar days from the event to that expiry. 0 = same-day. */
  daysFromEvent: number | null;
  /** True when the chain has NO expiry on or after the event — nothing can price the print. */
  noCoveringExpiry: boolean;
  callWall: number | null;
  putWall: number | null;
  maxPain: number | null;
  /** Net dealer gamma across the scoped expiry, dollars. Sign carries the regime. */
  netGex: number | null;
  /** Per-strike totals for the scoped expiry — the ladder the panel draws. */
  strikeTotals: Record<string, number>;
  /** How many expiries the unscoped aggregate would have mixed together. */
  aggregateExpiryCount: number;
};

/** Calendar days between two YYYY-MM-DD strings. UTC math — these are dates, not instants. */
export function daysBetweenYmd(a: string, b: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms = Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!);
  return Math.round(ms / 86_400_000);
}

/**
 * The first expiry on or after the event date.
 *
 * Sorted defensively rather than trusting the axis order: the matrix documents an ascending
 * axis, but it also documents far-dated columns being MERGED IN after the near-term block, and
 * a caller that assumed order would silently pick a monthly over a nearer weekly.
 */
export function pickEventExpiry(expiries: readonly string[] | null | undefined, eventYmd: string | null | undefined): string | null {
  if (!eventYmd || !/^\d{4}-\d{2}-\d{2}$/.test(eventYmd)) return null;
  const sorted = [...(expiries ?? [])].filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort();
  for (const e of sorted) if (e >= eventYmd) return e;
  return null;
}

/**
 * Re-derive the structural levels for one expiry from the per-(strike, expiry) cells.
 *
 * The wall definitions mirror the matrix's own: call wall is the largest POSITIVE net dealer
 * gamma (dealer long → resistance), put wall the largest NEGATIVE (support). Re-implementing
 * them here would be a second definition free to drift, so they are stated once, in the same
 * words, and tested against the aggregate the matrix produces for a single-expiry chain.
 */
export function scopeStructureToExpiry(input: {
  /** `cells[strike][expiry] = net dealer dollar gamma`. Sparse; absent means no data. */
  cells?: Record<string, Record<string, number>> | null;
  expiries?: readonly string[] | null;
  maxPainByExpiry?: Record<string, number | null> | null;
  eventYmd?: string | null;
  /** Expiries the unscoped aggregate would have summed — reported, not used. */
  aggregateExpiries?: readonly string[] | null;
}): ExpiryScopedStructure {
  const empty: ExpiryScopedStructure = {
    expiryUsed: null,
    daysFromEvent: null,
    noCoveringExpiry: false,
    callWall: null,
    putWall: null,
    maxPain: null,
    netGex: null,
    strikeTotals: {},
    aggregateExpiryCount: (input.aggregateExpiries ?? input.expiries ?? []).length,
  };

  const expiry = pickEventExpiry(input.expiries, input.eventYmd);
  if (!expiry) {
    // Distinguish "no event date" from "the chain does not reach the event". The second is a
    // real, reportable condition: there is no listed contract that survives the print.
    const hasEvent = Boolean(input.eventYmd && /^\d{4}-\d{2}-\d{2}$/.test(input.eventYmd));
    return { ...empty, noCoveringExpiry: hasEvent && (input.expiries ?? []).length > 0 };
  }

  const strikeTotals: Record<string, number> = {};
  let net = 0;
  let best: { strike: number; v: number } | null = null;
  let worst: { strike: number; v: number } | null = null;

  for (const [strikeKey, byExpiry] of Object.entries(input.cells ?? {})) {
    const v = num(byExpiry?.[expiry]);
    if (v == null) continue;
    const strike = num(strikeKey);
    if (strike == null) continue;
    strikeTotals[strikeKey] = round(v, 4);
    net += v;
    if (v > 0 && (best == null || v > best.v)) best = { strike, v };
    if (v < 0 && (worst == null || v < worst.v)) worst = { strike, v };
  }

  const touched = Object.keys(strikeTotals).length;
  return {
    expiryUsed: expiry,
    daysFromEvent: input.eventYmd ? daysBetweenYmd(input.eventYmd, expiry) : null,
    noCoveringExpiry: false,
    callWall: best?.strike ?? null,
    putWall: worst?.strike ?? null,
    maxPain: num(input.maxPainByExpiry?.[expiry]),
    // No strikes touched means the column is empty — report null rather than a confident 0,
    // which would render as "perfectly balanced dealer gamma" on a chain we have no data for.
    netGex: touched > 0 ? round(net, 2) : null,
    strikeTotals,
    aggregateExpiryCount: (input.aggregateExpiries ?? input.expiries ?? []).length,
  };
}

/**
 * How to describe the scoped chain in one phrase, for the panel.
 *
 * The label is not decoration: an expiry-scoped level and an aggregate level look identical on
 * screen, and only one of them answers "what is positioned around this print".
 */
export function describeEventExpiry(s: ExpiryScopedStructure): string | null {
  if (s.noCoveringExpiry) return "no listed expiry covers this print";
  if (!s.expiryUsed) return null;
  const d = s.daysFromEvent;
  if (d == null) return `expiry ${s.expiryUsed}`;
  if (d === 0) return `${s.expiryUsed} expiry — settles the day of the print`;
  return `${s.expiryUsed} expiry — ${d}d after the print`;
}

/* ── Flow, split by whether it survives the print ─────────────────────────────────── */

export type FlowPrint = {
  premium?: number | null;
  option_type?: string | null;
  strike?: number | null;
  expiry?: string | null;
  dte?: number | null;
};

export type FlowEventSplit = {
  /** Premium in contracts that EXPIRE BEFORE the print — cannot be a bet on the event. */
  preEventPremium: number;
  /** Premium in the expiry that covers the print. */
  eventExpiryPremium: number;
  /** Premium in expiries beyond it — a longer-horizon view that survives the print. */
  postEventPremium: number;
  /** Premium we could not place, because the print carried no usable expiry. */
  unclassifiedPremium: number;
  preEventCount: number;
  eventExpiryCount: number;
  postEventCount: number;
  /** Share of CLASSIFIED premium positioned in contracts that outlive the print. 0..1, or null. */
  survivingShare: number | null;
  /** Call minus put premium among surviving contracts. Sign is the directional bet on the event. */
  survivingNetCallPremium: number | null;
};

/**
 * Split options flow by whether the contracts survive the earnings print.
 *
 * The question a reader actually has is not "how much premium traded" but "how much of it is a
 * bet on THIS event". A sweep in a weekly that expires two days before the company reports is
 * not an earnings bet however large it is — it is a different trade that happens to be on the
 * same ticker, and summing it into an "earnings flow" number overstates conviction.
 *
 * `survivingShare` is deliberately computed over CLASSIFIED premium only. Dividing by the total
 * would let prints with a missing expiry quietly drag the share toward zero, which reads as
 * "nobody is positioned for the event" when it actually means "we could not tell".
 */
export function splitFlowByEventExpiry(
  prints: readonly FlowPrint[] | null | undefined,
  eventYmd: string | null | undefined
): FlowEventSplit {
  const out: FlowEventSplit = {
    preEventPremium: 0,
    eventExpiryPremium: 0,
    postEventPremium: 0,
    unclassifiedPremium: 0,
    preEventCount: 0,
    eventExpiryCount: 0,
    postEventCount: 0,
    survivingShare: null,
    survivingNetCallPremium: null,
  };
  const hasEvent = Boolean(eventYmd && /^\d{4}-\d{2}-\d{2}$/.test(eventYmd));
  let callPrem = 0;
  let putPrem = 0;

  for (const p of prints ?? []) {
    const prem = num(p?.premium);
    if (prem == null || prem <= 0) continue;
    const exp = String(p?.expiry ?? "").slice(0, 10);
    if (!hasEvent || !/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
      out.unclassifiedPremium += prem;
      continue;
    }
    if (exp < eventYmd!) {
      out.preEventPremium += prem;
      out.preEventCount += 1;
      continue;
    }
    // On or after the print — this contract is still alive when the news lands.
    const type = String(p?.option_type ?? "").toUpperCase();
    if (type === "CALL") callPrem += prem;
    else if (type === "PUT") putPrem += prem;
    if (exp === eventYmd) {
      out.eventExpiryPremium += prem;
      out.eventExpiryCount += 1;
    } else {
      out.postEventPremium += prem;
      out.postEventCount += 1;
    }
  }

  const surviving = out.eventExpiryPremium + out.postEventPremium;
  const classified = surviving + out.preEventPremium;
  out.preEventPremium = round(out.preEventPremium, 2);
  out.eventExpiryPremium = round(out.eventExpiryPremium, 2);
  out.postEventPremium = round(out.postEventPremium, 2);
  out.unclassifiedPremium = round(out.unclassifiedPremium, 2);
  out.survivingShare = classified > 0 ? round(surviving / classified, 4) : null;
  out.survivingNetCallPremium = surviving > 0 ? round(callPrem - putPrem, 2) : null;
  return out;
}
