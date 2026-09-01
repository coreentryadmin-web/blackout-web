// Contract plan for a 0DTE find — the "at what premium do I enter, when do I exit"
// layer. Everything here is derived from REAL observed numbers (what the flow
// actually paid, the contract's live quote, chart structure already computed) plus
// FIXED risk rules — never a predicted price. Pure functions only (unit-testable,
// dependency-free leaf); the scan does the fetching.
//
// The plan is also what the ledger GRADES: after the session, the option's own
// minute bars decide whether the printed plan doubled, stopped, or timed out —
// so the board's "plays" carry a measured track record, same standard as the
// engines. Honesty rule: a plan prints only when a real quote or real fill
// exists; missing data → no plan, never a guess.

/** Fixed risk discipline for 0DTE longs-premium plays. Rules, not predictions. */
export const PLAN_RULES = {
  /** Cut the position when premium loses half its entry value. */
  stop_pct: -50,
  /** Take (at least a trim) when premium doubles. */
  target_pct: 100,
  /** Hard time stop — flat by 15:50 ET (10 min before cash close). */
  time_stop_et_minutes: 15 * 60 + 50,
} as const;

/** 0DTE directional commits open at 10:00 ET (G-2 unlock). */
export const ZERODTE_COMMIT_OPEN_ET_MINUTES = 10 * 60;

/** No NEW 0DTE plays of ANY kind (including condor) after 15:30 ET — persist-layer backstop
 *  and the discovery-layer condor-fresh-eligibility boundary (scan.ts). NOT the directional
 *  commit cutoff — see DIRECTIONAL_LATE_CUTOFF_ET_MINUTES for that. */
export const NEW_PLAY_CUTOFF_ET_MINUTES = 15 * 60 + 30;

/** No NEW DIRECTIONAL 0DTE commits after 14:00 ET — gate G-14 (gates.ts) + confluence's
 *  ENTRY_CUTOFF_ET_MINUTES. Condors are exempt (a credit seller WANTS late-session theta
 *  crush) and stay eligible through NEW_PLAY_CUTOFF_ET_MINUTES (15:30 ET) above.
 *
 *  Evidence: 90-day prod record (FINDINGS 2026-07-28), 14:00-15:30 bucket ran 14.3% WR /
 *  −19.02% avg P&L — shipped as a hard 14:00 gate. On 2026-08-03 (#1591) this was widened
 *  to alias NEW_PLAY_CUTOFF_ET_MINUTES (15:30 ET) "to align session discipline with operator
 *  intent" — but the toxic window kept bleeding: re-measured live 2026-09-01, the reopened
 *  14:00-15:30 bucket still ran 21.1% WR / −12.72% avg over the 90 days since the widening
 *  (n=19), materially unchanged from the original evidence. Split back out to its own constant
 *  so a future change to the general session-exit cutoff (condor/backstop) cannot silently
 *  drag the directional gate along with it again. */
export const DIRECTIONAL_LATE_CUTOFF_ET_MINUTES = 14 * 60;

/** Human ET label for the hard exit (derived from PLAN_RULES). */
export function zerodteTimeStopEtLabel(): string {
  const m = PLAN_RULES.time_stop_et_minutes;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}:${String(min).padStart(2, "0")}`;
}

// 55 not 35: 0DTE ATM options have extreme gamma — a 0.2% underlying move can
// swing the option premium 30-50%, so 35% sat inside normal intraday noise and
// blocked high-quality setups (2026-07-27: SPXW score-77 triple-confirmed blocked
// at 54%). The achievability floor (resolveLedgerEntryPremium) already handles
// grading honesty by flooring at the flag-time mark, so this guard only needs to
// catch genuinely "already happened" moves, not routine 0DTE gamma swings.
const CHASE_PCT_DEFAULT = 55;
export const CHASE_PCT = (() => {
  const raw = process.env.ZERODTE_CHASE_PCT?.trim();
  if (!raw) return CHASE_PCT_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : CHASE_PCT_DEFAULT;
})();

// ── WS-04 · Malformed-quote validation (fail-closed) ──────────────────────────────
// The legacy liquidity test was PERCENT-SPREAD ONLY: spread_pct=(ask−bid)/mark*100,
// illiquid=spread_pct>15. That check fails OPEN on every malformed book because the
// percentage lands in a "convenient" direction:
//   • zero/null bid  → spread_pct is null → `illiquid = spread_pct != null && …` is false → PASSES
//   • crossed (bid>ask) → NEGATIVE spread_pct → −x > 15 is false → PASSES
//   • locked (bid==ask) → spread_pct === 0 → 0 > 15 is false → PASSES
// A malformed quote must never be treated as tradeable, so these predicates are
// EXPLICIT and fail CLOSED (a missing/degenerate input BLOCKS, it never waves through).
// This is strictly ADDITIVE to the existing 15% illiquid check (kept as-is below).

/** Why a contract's live quote is not committable. `null` = quote is valid.
 *  Distinct, additive to the plan_illiquid/plan_no_quote taxonomy. Back-compat:
 *  the field is optional on ContractPlan so historical/hand-built plans that omit
 *  it read as "no explicit invalidity" (the legacy illiquid/no_quote checks still
 *  govern them). */
export type QuoteInvalidReason =
  | "zero_bid" // bid ≤ 0 / null, or a missing/zero ask (a one-sided, non-committable book)
  | "crossed" // bid > ask — an impossible/erroneous book
  | "locked" // bid == ask — a zero-width book (no real two-sided market)
  | "mark_out_of_band" // mark sits outside [bid, ask] — malformed/stale print
  | "wide_dollars" // absolute ask−bid spread over the dollar cap (backstop to the % check)
  | "thin_size" // resting quote size below the floor (only when the provider reports size)
  | "stale" // quote age beyond the freshness bound (only when a timestamp is available)
  | null;

/** Fail-closed quote-validity bounds. Numeric bounds are NEW (the % check had none).
 *  Tunable — a TRADES change, so conservative defaults that reject only the clearly
 *  malformed / untradeable, never a legitimate 0DTE book. */
export const QUOTE_VALIDITY = {
  /** Absolute bid/ask spread cap ($). Backstop to spread_pct>15: a proportionally
   *  OK but absolutely huge spread (e.g. $14 on a $100 premium = 14% < 15% → passes
   *  the % test) is still an untradeable exit tax on a 0DTE scalp. */
  max_spread_dollars: 5.0,
  /** Max quote age (ms) before a book is stale. ONLY enforced when a real quote
   *  age is supplied on the plan input. The 0DTE scan plumbs observation age
   *  (OptionSnapshot.observedAtMs from the live fetch / cache write — preferred over
   *  last_quote.last_updated, which often stamps prior close on an otherwise live NBBO).
   *  Absence of age leaves the bound dormant (absence is not staleness). */
  max_quote_age_ms: 60_000,
  /** Minimum resting quote size (contracts) on BOTH sides. ONLY enforced when the
   *  provider actually reports size (bidSize/askSize non-null) — absent size is not
   *  proof of illiquidity, so it does not fail closed here (the one conditional-on-
   *  availability predicate, same rule as quote age). */
  min_quote_size: 1,
} as const;

/**
 * WS-04 quote-validity verdict — a pure predicate over a contract's live quote.
 * Returns the FIRST failing reason (checked most-degenerate-first) or null when the
 * quote is valid. Fail-closed: a null/zero/degenerate input yields a reason (BLOCK),
 * never null (pass). `bidSize`/`askSize`/`quoteAgeMs` are conditional — only enforced
 * when actually supplied by the provider (see the field docs on QUOTE_VALIDITY).
 */
export function evaluateQuoteValidity(input: {
  bid: number | null;
  ask: number | null;
  mark: number | null;
  bidSize?: number | null;
  askSize?: number | null;
  quoteAgeMs?: number | null;
}): QuoteInvalidReason {
  const { bid, ask, mark, bidSize, askSize, quoteAgeMs } = input;
  // A committable book needs a real two-sided quote. A null/≤0 side is where the
  // percent-spread check silently computed null and read null as "liquid" — the
  // core loophole. Here it BLOCKS.
  if (bid == null || !(bid > 0)) return "zero_bid";
  if (ask == null || !(ask > 0)) return "zero_bid";
  // Crossed (negative %) and locked (0 %) both slipped under `> 15`. Explicit now.
  if (ask < bid) return "crossed";
  if (ask === bid) return "locked";
  // The mark must sit inside the book it was derived from; a mark outside [bid,ask]
  // is a malformed or stale midpoint that would grade/enter off a phantom price.
  if (mark == null || mark < bid || mark > ask) return "mark_out_of_band";
  // Absolute-dollar backstop (the % check alone can pass an absolutely huge spread).
  if (ask - bid > QUOTE_VALIDITY.max_spread_dollars) return "wide_dollars";
  // Conditional: min resting size, only when the provider reported both sides.
  if (
    bidSize != null &&
    askSize != null &&
    (bidSize < QUOTE_VALIDITY.min_quote_size || askSize < QUOTE_VALIDITY.min_quote_size)
  ) {
    return "thin_size";
  }
  // Conditional: quote age, only when a timestamp/age is available (none today).
  if (quoteAgeMs != null && quoteAgeMs > QUOTE_VALIDITY.max_quote_age_ms) return "stale";
  return null;
}

export type EntryStatus =
  | "IN_RANGE" // mark at/below the flow's fill (or within tolerance) — enterable
  | "MOVED" // premium already ran ≥CHASE_PCT past the flow's fill — skip, don't chase
  | "CHEAPER" // quoted BELOW what the flow paid — better entry than the smart money got
  | "NO_QUOTE"; // no live quote — evidence only, no plan

export type ContractPlan = {
  /** OCC contract this plan is for (top strike on the dominant side). */
  occ: string;
  /** Premium-weighted average per-contract fill the tape actually paid. */
  flow_avg_fill: number | null;
  /** Live quote at plan time. */
  bid: number | null;
  ask: number | null;
  mark: number | null;
  /** Enter at or below this premium (flow's fill; falls back to mark when no fill). */
  entry_max: number | null;
  /** mark vs flow fill, % — positive = paying up vs the smart money. */
  vs_flow_pct: number | null;
  entry_status: EntryStatus;
  /** Bid/ask spread as % of mark — exit tax. >15% flags the market as too thin. */
  spread_pct: number | null;
  illiquid: boolean;
  /** WS-04: fail-closed malformed-quote verdict. null = quote valid; a non-null reason
   *  is translated to a distinct plan_quote_invalid / plan_quote_stale block in
   *  planQualityGateBlocks (gates.ts). OPTIONAL for back-compat — a historical/hand-built
   *  plan that omits it is read as "no explicit invalidity" (the legacy illiquid /
   *  no_quote checks still govern it). */
  quote_invalid_reason?: QuoteInvalidReason;
  /** Premium exits from PLAN_RULES applied to entry_max. */
  stop_premium: number | null;
  target_premium: number | null;
  time_stop_et: string;
  /** Underlying anchors from real chart structure (nearest levels), null when unknown. */
  underlying_target: number | null;
  underlying_invalid: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Build the plan for a find's top-strike contract. `flowAvgFill` is the premium-
 * weighted per-contract price the tape paid; quote is the live snapshot. Chart
 * levels come from the dossier tech card (already computed).
 */
export function buildContractPlan(input: {
  occ: string;
  direction: "long" | "short";
  price: number | null;
  flowAvgFill: number | null;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  /** Top-of-book resting sizes (contracts), when the provider reports them — feeds the
   *  WS-04 min-size predicate (conditional-on-availability). Absent → not enforced. */
  bidSize?: number | null;
  askSize?: number | null;
  /** Age (ms) of the quote at plan time, when a quote timestamp is available. WS-04
   *  quote_age is only enforced when this is supplied. As of D3 the 0DTE scan threads it
   *  through (OptionSnapshot.quoteUpdatedMs → scan.ts computeQuoteAgeMs → here), so the
   *  stale predicate is LIVE; undefined (no timestamp on the snapshot) leaves it dormant. */
  quoteAgeMs?: number | null;
  keySupports: number[];
  keyResistances: number[];
  vwap: number | null;
}): ContractPlan {
  const { occ, direction, price, flowAvgFill, bid, ask, mark } = input;

  // Entry reference: what the flow paid; without a fill record, the live mark.
  const entryMax = flowAvgFill ?? mark ?? null;
  const vsFlow =
    flowAvgFill != null && flowAvgFill > 0 && mark != null
      ? round2(((mark - flowAvgFill) / flowAvgFill) * 100)
      : null;

  const spreadPct =
    bid != null && ask != null && ask > 0 && mark != null && mark > 0
      ? round2(((ask - bid) / mark) * 100)
      : null;
  // Wide markets tax every exit twice — a strong tape on an untradeable contract
  // is still a pass for a 0DTE scalp.
  const illiquid = spreadPct != null && spreadPct > 15;

  // WS-04: explicit fail-closed malformed-quote verdict, computed BESIDE the legacy
  // percent-spread check (which is kept untouched). This catches the books the % test
  // waved through — zero/null bid (null %), crossed (negative %), locked (0 %), mark
  // out of band, and an absolutely-huge dollar spread — plus the two conditional bounds
  // (size, age) when the provider supplies them.
  const quoteInvalidReason = evaluateQuoteValidity({
    bid,
    ask,
    mark,
    bidSize: input.bidSize ?? null,
    askSize: input.askSize ?? null,
    quoteAgeMs: input.quoteAgeMs ?? null,
  });

  let status: EntryStatus;
  if (mark == null) status = "NO_QUOTE";
  else if (vsFlow != null && vsFlow >= CHASE_PCT) status = "MOVED";
  else if (vsFlow != null && vsFlow <= -10) status = "CHEAPER";
  else status = "IN_RANGE";

  // Underlying anchors: a long targets the nearest resistance above price and is
  // wrong below the nearest support (VWAP fallback); a short mirrors.
  let target: number | null = null;
  let invalid: number | null = null;
  if (price != null && price > 0) {
    if (direction === "long") {
      target = input.keyResistances.find((l) => l > price) ?? null;
      invalid = input.keySupports.find((l) => l < price) ?? input.vwap ?? null;
    } else {
      // keySupports/keyResistances arrive nearest-first (see enrichSetup) — a short
      // targets the nearest support below and is wrong above the nearest resistance.
      target = input.keySupports.find((l) => l < price) ?? null;
      invalid = input.keyResistances.find((l) => l > price) ?? input.vwap ?? null;
    }
  }

  return {
    occ,
    flow_avg_fill: flowAvgFill != null ? round2(flowAvgFill) : null,
    bid,
    ask,
    mark,
    entry_max: entryMax != null ? round2(entryMax) : null,
    vs_flow_pct: vsFlow,
    entry_status: status,
    spread_pct: spreadPct,
    illiquid,
    quote_invalid_reason: quoteInvalidReason,
    stop_premium: entryMax != null ? round2(entryMax * (1 + PLAN_RULES.stop_pct / 100)) : null,
    target_premium: entryMax != null ? round2(entryMax * (1 + PLAN_RULES.target_pct / 100)) : null,
    time_stop_et: zerodteTimeStopEtLabel(),
    underlying_target: target,
    underlying_invalid: invalid,
  };
}

/**
 * The premium reference persisted to the ledger row — consumed by BOTH
 * gradePlanFromBars (the final win/loss grade) and derivePlayStatus (live
 * OPEN/HOLD/TRIM/CLOSED math via peak/trough). This resolves from buildContractPlan's
 * own `entry_max` (flow's fill, falling back to mark) — entry_max is the literal
 * "enter at or below this premium" instruction shown to the member and what the plan's
 * own stop_premium/target_premium are computed from.
 *
 * ACHIEVABILITY FLOOR (`markAtFlag`) — grade the trade a member could actually take:
 * entry_max is the FLOW's own fill, i.e. the price the SMART MONEY got, which can sit
 * well BELOW the live mark (the tape front-ran the print). CHASE_PCT lets the mark run
 * up to +(CHASE_PCT−1)% over that fill and still print IN_RANGE, so the graded entry/stop/target
 * could be pinned to a premium a member filling at the live mark at flag time simply
 * cannot get — a cheaper-than-achievable basis flatters the win rate (an easier double,
 * a stop that never realistically triggers). So the LEDGER basis is floored at the
 * flag-time mark: a member arriving at flag time pays ~the mark, never a price already
 * gone. The member-facing entry_max/stop_premium/target_premium (the printed "enter at
 * or below" instruction and the don't-chase MOVED band) are deliberately left UNTOUCHED
 * — only the ledger's grading/tracking reference moves, and only UP toward the mark
 * (never below entry_max), so the clean IN_RANGE/CHEAPER path where the mark sits at or
 * below the fill is unchanged. `markAtFlag` omitted → legacy behavior (no floor).
 *
 * ACHIEVABILITY CEILING (2026-08-27, live finding) — the symmetric completion the floor
 * above never had: achievability cuts BOTH ways, but this function only ever bounded the
 * basis UP toward the mark, never down. Live session 2026-08-27 produced two rows whose
 * `plan_stop` exit fired inside ~1.2s of commit (QQQ 720C 0DTE: flow fill $3.27, real
 * market never above $1.31 all session; NVDA 225C 1DTE: flow fill $5.86 vs a live market
 * around $2.6-3.1 at the same instant) — a "stopped -77%"/"-53%" a member arriving at
 * flag time and paying the live mark could never have experienced, because the flow
 * print itself (stale, or matched to the wrong strike/expiry upstream) was never a
 * tradeable price. A member can't be graded against a fill they couldn't get in EITHER
 * direction, so when the mark sits FAR below the fill (the QQQ case above was ~73%
 * below) — by the same CHASE_PCT magnitude this file already treats as "too extreme to
 * trust" for the opposite (MOVED) case — the ledger basis is capped DOWN to the mark
 * instead of trusting the outlier fill.
 * Ordinary CHEAPER prints (mark a few/some percent below the fill — real front-running)
 * are far inside this band and are completely unaffected.
 */
export function resolveLedgerEntryPremium(
  planEntryMax: number | null | undefined,
  flowAvgFill: number | null,
  markAtFlag?: number | null
): number | null {
  const base = planEntryMax ?? flowAvgFill ?? null;
  if (base == null) return null;
  if (markAtFlag != null && markAtFlag > 0) {
    if (markAtFlag > base) return round2(markAtFlag);
    const pctBelow = ((base - markAtFlag) / base) * 100;
    if (pctBelow >= CHASE_PCT) return round2(markAtFlag);
  }
  return base;
}

// ── Plan grading (the accountability half) ────────────────────────────────────────

export type PlanBar = { t: number; h: number; l: number; c: number };

export type PlanOutcome = {
  outcome: "doubled" | "stopped" | "time_stop" | "ungradeable";
  /** P/L % of premium at exit vs entry. */
  pnl_pct: number | null;
  /** WS-11 — per-leg fills when this grade is a RECONSTRUCTED TRIM-SCALE path
   *  (reconstructTrimScaleExecutableFromBars). The blended `pnl_pct` above is the
   *  fraction-weighted sum of these legs. Omitted for the single-exit grades
   *  (gradePlanFromBars / gradePlanExecutableFromBars) and the ratchet lane — those stay a
   *  single stop/target/time-stop walk, so a consumer reads "no tranches" as "single exit". */
  tranches?: PlanTrancheFill[];
};

/** WS-11 — one reconstructed profit-taking leg of a TRIM-SCALE as-managed path. `fraction`
 *  is the share of the ORIGINAL position banked in this leg; `exit_pnl_pct` is that leg's
 *  EXECUTABLE (bought-the-ask, sold-the-bid) return; `at_et` is the ET "H:MM" of the bar it
 *  filled in. The array is the audit trail behind the one blended official number, so the
 *  member record and calibration grade the SAME strategy the engine actually runs. */
export type PlanTrancheFill = {
  /** 1-based leg index in fill order (first trim = 1, second = 2, runner = last). */
  tranche: number;
  /** Share of the ORIGINAL position exited in this leg (the ⅓/⅓/⅓ ladder ⇒ ~0.333 each). */
  fraction: number;
  /** Executable (bid-to-close vs ask-to-open) P&L % for this leg. */
  exit_pnl_pct: number;
  /** Which rule closed this leg. */
  exit_reason: "trim_scale_first" | "trim_scale_second" | "doubled" | "stopped" | "time_stop";
  /** ET "H:MM" of the bar this leg filled in (DST-safe via etMinutesOf). */
  at_et: string;
};

/** WS-11 — the resolved TRIM-SCALE ladder the reconstruction replays: the ORDERED profit-
 *  taking tranches (peak-P&L trigger + fraction of the ORIGINAL position) and the runner
 *  fraction that rides the plan rails after them. Plain numbers (structurally mirrors
 *  ResolvedExitPolicy.trim_levels / runner_fraction from strategy-version.ts) so this leaf
 *  never imports strategy-version — which imports THIS module, so the reverse would cycle. */
export type TrimScaleSpec = {
  trim_levels: { trigger_pct: number; fraction: number }[];
  runner_fraction: number;
};

/** ET minutes-since-midnight for an epoch-ms timestamp (DST-safe via Intl). */
export function etMinutesOf(epochMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(epochMs));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/**
 * Grade the printed plan against the CONTRACT's own minute bars, walked in time
 * order from the bar AFTER the flag onward: stop fires when the bar's low touches
 * stop_premium, target when the bar's high touches target_premium — when BOTH touch
 * inside the same bar, count the STOP (conservative; intrabar order is unknowable).
 * The flag bar ITSELF is excluded (`bar.t <= flaggedAtMs` is skipped): its own high/low
 * happened around the flag print in unknowable order, so testing them against target/stop
 * would be intrabar clairvoyance — the same discipline the skip grader applies via
 * `entryBar.t + 1`. Past the time stop, exit at the last usable close ≤15:30 ET. No bars
 * strictly after the flag → ungradeable.
 *
 * TIE-BREAK DIVERGENCE vs derivePlayStatus (deliberate, documented): on a same-bar
 * stop+target tie this grade is PESSIMISTIC (books the stop) while the live card
 * (derivePlayStatus) is OPTIMISTIC (its latched-peak check makes a target touch a
 * STICKY win — guarded by the "already-doubled stays TRIM" P0 test). The two can
 * therefore disagree only in that ambiguous both-touched window: the card can show a
 * TRIM the moment the target is tagged, while THIS mechanical grade later books −50%
 * if the stop shared the bar. That is NOT the member-facing record: record.ts reports
 * the AS-MANAGED grade (the exit-engine's realized exit — a target/ratchet trim books a
 * WIN, matching the card), and keeps this mechanical grade only as a labeled comparison.
 * So the number the member is shown and the number booked to their record agree; this
 * conservative grade is the honest hold-to-stop/target benchmark beside it.
 */
/** WS-02: the grader-facing numeric exit params. When a committed row carries a frozen
 *  exit-policy snapshot (entry_context.exit_policy_snapshot), the caller resolves it to this
 *  shape (exitPolicyGraderParams) and passes it so the grade uses the numbers the row
 *  COMMITTED under — not whatever PLAN_RULES currently holds. Omitted/nullish fields fall back
 *  to PLAN_RULES, so a legacy row (no snapshot) grades exactly as before. Kept as a plain
 *  numeric shape (not the ResolvedExitPolicy type) so this leaf never imports strategy-version
 *  (which imports THIS module — that would cycle). */
export type PlanGradeParams = {
  hard_stop_pct?: number | null;
  target_pct?: number | null;
  time_stop_et_minutes?: number | null;
};

export function gradePlanFromBars(
  bars: PlanBar[],
  entryPremium: number,
  flaggedAtMs: number,
  params?: PlanGradeParams | null
): PlanOutcome {
  if (!(entryPremium > 0)) return { outcome: "ungradeable", pnl_pct: null };
  const stopPct = params?.hard_stop_pct ?? PLAN_RULES.stop_pct;
  const targetPct = params?.target_pct ?? PLAN_RULES.target_pct;
  const timeStopMinutes = params?.time_stop_et_minutes ?? PLAN_RULES.time_stop_et_minutes;
  const stop = entryPremium * (1 + stopPct / 100);
  const target = entryPremium * (1 + targetPct / 100);
  const pnl = (exit: number) => round2(((exit - entryPremium) / entryPremium) * 100);

  let lastCloseInWindow: number | null = null;
  for (const bar of [...bars].sort((a, b) => a.t - b.t)) {
    // Exclude the flag bar itself (<=, not <) — grading its own high/low would be intrabar
    // look-ahead on the flag bar (asymmetric with the skip grader, which excludes the entry bar).
    if (bar.t <= flaggedAtMs) continue;
    const pastTimeStop = etMinutesOf(bar.t) > timeStopMinutes;
    if (pastTimeStop) break;
    // Conservative ordering: stop checked before target within the same bar.
    if (bar.l <= stop) return { outcome: "stopped", pnl_pct: pnl(stop) };
    if (bar.h >= target) return { outcome: "doubled", pnl_pct: pnl(target) };
    lastCloseInWindow = bar.c;
  }
  if (lastCloseInWindow == null) return { outcome: "ungradeable", pnl_pct: null };
  return { outcome: "time_stop", pnl_pct: pnl(lastCloseInWindow) };
}

/**
 * WS-10 — the CONSERVATIVE EXECUTABLE grade (bid/ask, not mid). gradePlanFromBars above
 * grades on the mid: it fires the stop when the trade LOW touches the stop level and books
 * the exit at that level against a mid entry basis. But a long-premium 0DTE option is BOUGHT
 * at the ASK and SOLD at the BID, so that mid grade prices a fill no member could take. This
 * grade re-prices the SAME plan on the executable frame, a marketable-limit model over the
 * option's own trade bars:
 *   - entry basis = ASK  = entryPremium × (1 + f)   (you pay up to open)
 *   - the exit side is the BID, modeled bar-by-bar as tradePrice × (1 − f)
 *   - the stop LATCHES ON THE BID: it fires when the modeled bid LOW touches the stop level
 *     (bar.l×(1−f) ≤ stop), i.e. STRICTLY EARLIER than the mid grade (which needs bar.l ≤ stop) —
 *     the negative-skew tail a mid grade never sees. Same for the target on the bid HIGH.
 *   - a time-stop sells into the closing bid (bar.c × (1 − f)).
 * `f` is the half-spread as a fraction of mid, pinned from the row's OWN entry quote
 * (plan_json.bid/ask via zeroDteHalfSpreadFrac) — the real spread the play committed under,
 * not a global constant; the caller falls back to ZERODTE_DEFAULT_HALF_SPREAD_FRAC only when
 * the committed book was one-sided/absent. The stop/target PREMIUM LEVELS are the plan's own
 * (entry × (1 ± pct)) — unchanged from the mid grade; only the trigger side and the entry/exit
 * bases move to the executable frame. Result: every executable return is ≤ its mid twin (higher
 * entry basis + a lower, earlier-triggered exit), which is the whole point — the ledger stops
 * graduating strategies that only "win" at mid.
 *
 * SCOPE: directional plan lane ONLY. A condor row is routed to gradeCondorFromBars (a 4-leg
 * credit structure with its own geometry) and never reaches here; its executable/breach
 * pricing is a separate concern (not touched by WS-10). f<0 is impossible (zeroDteHalfSpreadFrac
 * guards it); f is clamped into [0, 0.95] so a pathologically wide pinned quote can't zero out
 * the whole exit side.
 */
export function gradePlanExecutableFromBars(
  bars: PlanBar[],
  entryPremium: number,
  flaggedAtMs: number,
  halfSpreadFrac: number,
  params?: PlanGradeParams | null
): PlanOutcome {
  if (!(entryPremium > 0)) return { outcome: "ungradeable", pnl_pct: null };
  const f = Math.min(0.95, Math.max(0, halfSpreadFrac));
  const stopPct = params?.hard_stop_pct ?? PLAN_RULES.stop_pct;
  const targetPct = params?.target_pct ?? PLAN_RULES.target_pct;
  const timeStopMinutes = params?.time_stop_et_minutes ?? PLAN_RULES.time_stop_et_minutes;
  const stop = entryPremium * (1 + stopPct / 100); // mid-premium plan levels (unchanged)
  const target = entryPremium * (1 + targetPct / 100);
  const entryAsk = entryPremium * (1 + f); // pay the ask to open
  // Realized return: sell the exit BID against the ask entry basis. Exit at the stop/target
  // LEVEL is the bid you transact at when the bid touches it; a time-stop sells the closing bid.
  const pnl = (exitBid: number) => round2(((exitBid - entryAsk) / entryAsk) * 100);

  let lastBidCloseInWindow: number | null = null;
  for (const bar of [...bars].sort((a, b) => a.t - b.t)) {
    if (bar.t <= flaggedAtMs) continue; // exclude the flag bar (same discipline as the mid grade)
    if (etMinutesOf(bar.t) > timeStopMinutes) break;
    const bidLow = bar.l * (1 - f);
    const bidHigh = bar.h * (1 - f);
    // Conservative ordering: stop before target within the same bar — identical to the mid grade.
    if (bidLow <= stop) return { outcome: "stopped", pnl_pct: pnl(stop) };
    if (bidHigh >= target) return { outcome: "doubled", pnl_pct: pnl(target) };
    lastBidCloseInWindow = bar.c * (1 - f);
  }
  if (lastBidCloseInWindow == null) return { outcome: "ungradeable", pnl_pct: null };
  return { outcome: "time_stop", pnl_pct: pnl(lastBidCloseInWindow) };
}

/**
 * WS-11 — RECONSTRUCT the TRIM-SCALE as-managed path (the strategy the engine actually
 * runs) as ONE canonical, executable-priced official outcome.
 *
 * WHY THIS EXISTS. gradePlanFromBars / gradePlanExecutableFromBars above are a SINGLE
 * stop/target/time-stop walk — they exit the WHOLE position at one price. But the shipped
 * profit-management family (exit-engine.ts trim_scale, FINDINGS 2026-07-23) is a PARTIAL
 * scale-out: bank ⅓ of the original at the +25% trim, another ⅓ at +50%, and run the last ⅓
 * to the plan target/stop/time-stop. Grading a trim_scale row with a single walk therefore
 * grades a DIFFERENT strategy than the one the member is guided to trade — so the calibration
 * grade and the member-facing "as-managed" record can disagree, and the ledger can graduate a
 * strategy nobody actually trades. This function replays the FROZEN trim ladder (WS-02's
 * resolved exit-policy snapshot) leg-by-leg so the OFFICIAL number IS the as-managed path.
 *
 * EXECUTABLE PER LEG (WS-10 frame, reused verbatim): entry basis = the ASK you pay to open
 * (entryPremium × (1 + f)); every exit is the BID you sell into (tradePrice × (1 − f)). A trim
 * tranche k fires the first bar the BID HIGH reaches the trim LEVEL (entryPremium × (1 +
 * trigger_pctₖ/100)) — the same bid-side trigger discipline gradePlanExecutableFromBars applies
 * to the target — and banks `fractionₖ` of the original at that level. The runner (whatever is
 * left after the trims) then rides to the plan target (bid high ≥ target), the plan stop (bid
 * low ≤ stop, checked FIRST within a bar per the frozen collision rule — stop-before-target),
 * or the 15:30 time-stop (sell the remainder into the closing bid). `f` is the row's OWN pinned
 * half-spread (clamped [0, 0.95] like the single-walk grade), so the reconstruction pays the
 * real committed spread on every leg.
 *
 * ONE OFFICIAL NUMBER. `pnl_pct` is the fraction-weighted blend of the legs (Σ fractionₖ ×
 * exit_pnl_pctₖ); `tranches` is the per-leg audit trail; `outcome` labels how the RUNNER (the
 * last, largest-consequence leg) closed (doubled / stopped / time_stop), so by_outcome bucketing
 * stays meaningful while the tranches carry the partial-banking detail. record.ts reconciles its
 * as-managed headline to this same number (grade_vs_asmanaged_delta ≈ 0).
 *
 * SCOPE / BACK-COMPAT: called ONLY for a row whose FROZEN policy is trim_scale (scan.ts);
 * ratchet and legacy/no-snapshot rows keep the single-walk gradePlanExecutableFromBars. An empty
 * ladder, a non-positive entry, or no post-flag bars → ungradeable (never a fabricated fill).
 */
export function reconstructTrimScaleExecutableFromBars(
  bars: PlanBar[],
  entryPremium: number,
  flaggedAtMs: number,
  halfSpreadFrac: number,
  spec: TrimScaleSpec,
  params?: PlanGradeParams | null
): PlanOutcome {
  if (!(entryPremium > 0)) return { outcome: "ungradeable", pnl_pct: null };
  const levels = spec.trim_levels ?? [];
  if (levels.length === 0) {
    // No trim ladder to replay → the runner IS the whole position: defer to the single walk
    // so a degenerate/empty snapshot can never silently drop to "ungradeable".
    return gradePlanExecutableFromBars(bars, entryPremium, flaggedAtMs, halfSpreadFrac, params);
  }
  const f = Math.min(0.95, Math.max(0, halfSpreadFrac));
  const stopPct = params?.hard_stop_pct ?? PLAN_RULES.stop_pct;
  const targetPct = params?.target_pct ?? PLAN_RULES.target_pct;
  const timeStopMinutes = params?.time_stop_et_minutes ?? PLAN_RULES.time_stop_et_minutes;
  const stop = entryPremium * (1 + stopPct / 100); // mid-premium plan levels (unchanged)
  const target = entryPremium * (1 + targetPct / 100);
  // Each trim's premium LEVEL = entry × (1 + trigger%/100), the same construction as the plan
  // target — so the bid-high crossing it is the executable analog of "the peak armed the trim".
  const trimLevels = levels.map((l) => entryPremium * (1 + l.trigger_pct / 100));
  const entryAsk = entryPremium * (1 + f);
  const pnl = (exitBid: number) => round2(((exitBid - entryAsk) / entryAsk) * 100);
  const etHHMM = (t: number) => {
    const m = etMinutesOf(t);
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  };

  const tranches: PlanTrancheFill[] = [];
  let remaining = 1; // fraction of the ORIGINAL position still open
  let nextTrim = 0; // index of the next un-banked trim tranche
  let lastBidClose: number | null = null;
  let lastEt = "";
  let runnerOutcome: "doubled" | "stopped" | "time_stop" | null = null;

  for (const bar of [...bars].sort((a, b) => a.t - b.t)) {
    if (bar.t <= flaggedAtMs) continue; // exclude the flag bar (same discipline as the walks)
    if (etMinutesOf(bar.t) > timeStopMinutes) break;
    const bidLow = bar.l * (1 - f);
    const bidHigh = bar.h * (1 - f);
    const et = etHHMM(bar.t);
    // Collision rule (frozen: stop-before-target): a bar that touches the stop closes the WHOLE
    // remaining position at the stop before any trim/target on that same bar can bank — the
    // conservative intrabar order, identical to both single walks. A ⅓ already banked on an
    // EARLIER bar is safe; only same-bar ambiguity resolves pessimistically.
    if (bidLow <= stop) {
      tranches.push({
        tranche: tranches.length + 1,
        fraction: remaining,
        exit_pnl_pct: pnl(stop),
        exit_reason: "stopped",
        at_et: et,
      });
      remaining = 0;
      runnerOutcome = "stopped";
      break;
    }
    // Bank every trim tranche whose level the bid high reached this bar (peak armed it).
    while (nextTrim < levels.length && remaining > 0 && bidHigh >= trimLevels[nextTrim]!) {
      const frac = Math.min(levels[nextTrim]!.fraction, remaining);
      tranches.push({
        tranche: tranches.length + 1,
        fraction: frac,
        exit_pnl_pct: pnl(trimLevels[nextTrim]!),
        exit_reason: nextTrim === 0 ? "trim_scale_first" : "trim_scale_second",
        at_et: et,
      });
      remaining -= frac;
      nextTrim += 1;
    }
    // Runner target: once every trim is banked, the last fraction runs to the +100% plan target.
    if (nextTrim >= levels.length && remaining > 0 && bidHigh >= target) {
      tranches.push({
        tranche: tranches.length + 1,
        fraction: remaining,
        exit_pnl_pct: pnl(target),
        exit_reason: "doubled",
        at_et: et,
      });
      remaining = 0;
      runnerOutcome = "doubled";
      break;
    }
    lastBidClose = bar.c * (1 - f);
    lastEt = et;
  }

  // Runner never hit stop or target inside the window → time-stop the remainder at the last
  // closing bid. No usable post-flag bar at all (no trims banked either) → ungradeable.
  if (remaining > 0) {
    if (lastBidClose == null) return { outcome: "ungradeable", pnl_pct: null };
    tranches.push({
      tranche: tranches.length + 1,
      fraction: remaining,
      exit_pnl_pct: pnl(lastBidClose),
      exit_reason: "time_stop",
      at_et: lastEt,
    });
    // (No `remaining = 0` here — the position is fully closed by this final tranche and
    // `remaining` is never read again before the return; CodeQL flagged the assignment as a
    // dead store. The stop/target break paths above DO zero it, but only because they `break`
    // out mid-loop and the invariant matters there; this tail runs after the loop.)
    runnerOutcome = runnerOutcome ?? "time_stop";
  }

  if (tranches.length === 0) return { outcome: "ungradeable", pnl_pct: null };
  // ONE official number: the fraction-weighted blend of the legs (fractions sum to 1).
  const blended = round2(tranches.reduce((acc, t) => acc + t.fraction * t.exit_pnl_pct, 0));
  return { outcome: runnerOutcome ?? "time_stop", pnl_pct: blended, tranches };
}

// ── Live play lifecycle (pure) ────────────────────────────────────────────────────
// A play's status is DERIVED, never hand-set: entry premium + fixed rules + the
// contract's live mark (with latched peak/trough so a stop stays a stop even if
// the premium bounces). 0DTE discipline: no new plays after the entry cutoff,
// everything closes by the time stop — nothing is ever carried overnight.

export type PlayStatus = "OPEN" | "HOLD" | "TRIM" | "CLOSED";

export type LivePlayState = {
  status: PlayStatus;
  /** Premium P/L % vs entry at the current mark (null without a mark). */
  live_pnl_pct: number | null;
  /** Why a CLOSED play closed. */
  closed_reason: "stopped" | "time_stop" | null;
};

/**
 * Derive the play's lifecycle state. `peak`/`trough` are the latched extremes of
 * the mark SINCE the flag (persisted by the scanner each tick), so transitions
 * are sticky: trough ≤ stop → CLOSED forever; peak ≥ target → TRIM until close.
 * OPEN means "still enterable": mark within 10% of entry and before the cutoff.
 */
export function derivePlayStatus(input: {
  entryPremium: number | null;
  mark: number | null;
  peak: number | null;
  trough: number | null;
  nowEtMinutes: number;
  /** When true, skip the latched plan-stop close so the exit engine can honor a
   *  protective floor first (scan.ts / live-marks.ts run the engine on this pass). */
  deferPlanStop?: boolean;
}): LivePlayState {
  const { entryPremium, mark, peak, trough, nowEtMinutes, deferPlanStop } = input;
  const pnl =
    entryPremium != null && entryPremium > 0 && mark != null && mark > 0
      ? Math.round(((mark - entryPremium) / entryPremium) * 10000) / 100
      : null;

  // The hard exit closes EVERYTHING — including rows with no entry premium or no
  // quote. 0DTE has no tomorrow; data quality never exempts a play from the clock.
  if (nowEtMinutes > PLAN_RULES.time_stop_et_minutes) {
    return { status: "CLOSED", live_pnl_pct: pnl, closed_reason: "time_stop" };
  }
  if (!(entryPremium != null && entryPremium > 0)) {
    return { status: "HOLD", live_pnl_pct: null, closed_reason: null };
  }
  const stop = entryPremium * (1 + PLAN_RULES.stop_pct / 100);
  const target = entryPremium * (1 + PLAN_RULES.target_pct / 100);

  // Target checked BEFORE stop. peak/trough are latched extremes with no timestamp,
  // so a naive stop-first check can't tell "hit stop, never recovered" apart from
  // "hit target first, THEN craters" — both eventually show trough <= stop. But peak
  // only ever grows once set, so checking peak first makes a target hit STICKY: once
  // any tick pushes peak >= target, every future tick (this function is re-evaluated
  // every scan cycle against the still-open row) keeps returning TRIM regardless of
  // what trough does afterward — matching gradePlanFromBars' chronological "first
  // touch wins" grading and this file's own "peak >= target -> TRIM until close" doc
  // comment. A genuine stop-first case is unaffected: peak can't have reached target
  // yet when the row closes, so it still falls through to the stop check below.
  //
  // INTENTIONAL, GUARDED divergence from gradePlanFromBars' same-bar tie-break (see
  // that function's doc + the "already-doubled stays TRIM" P0 test): the live card is
  // OPTIMISTIC-sticky here (a real target touch is a real trim the member could take),
  // while the post-hoc mechanical grade is PESSIMISTIC on the both-touched-same-bar
  // ambiguity. They can disagree ONLY in that window. Reconciliation lives in record.ts:
  // the member-facing REPORTED record is the AS-MANAGED grade (the exit engine's realized
  // exit — the trim/ratchet that this TRIM card actually guides), so what the member is
  // shown and what is booked to their record agree; the mechanical grade is kept beside
  // it only as a labeled hold-to-stop/target comparison.
  if (peak != null && peak >= target) {
    return { status: "TRIM", live_pnl_pct: pnl, closed_reason: null };
  }
  if (!deferPlanStop && trough != null && trough <= stop) {
    return { status: "CLOSED", live_pnl_pct: PLAN_RULES.stop_pct, closed_reason: "stopped" };
  }
  // Symmetric band per this function's own doc comment ("within 10% of entry") — a lower
  // bound is required, not just an upper one, or a play sliding toward the stop (but not
  // there yet) stays labeled OPEN/"still enterable" the whole way down.
  if (
    mark != null &&
    mark <= entryPremium * 1.1 &&
    mark >= entryPremium * 0.9 &&
    nowEtMinutes < NEW_PLAY_CUTOFF_ET_MINUTES
  ) {
    return { status: "OPEN", live_pnl_pct: pnl, closed_reason: null };
  }
  return { status: "HOLD", live_pnl_pct: pnl, closed_reason: null };
}
