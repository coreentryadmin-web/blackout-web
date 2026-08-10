/**
 * FLOW VALIDATION — the layer between retrieval and synthesis.
 *
 * WHY IT EXISTS, with the live measurement that forced it. On 2026-08-10, SPX flow carried repeated
 * $750k–$1.5M CALL prints at STRIKE 200 against a spot of 7,760. That looks like a malformed
 * contract, and the first instinct is to hunt a parser bug. It is not one. Checked against the
 * arithmetic:
 *
 *     intrinsic value of one SPX 200 call = (7760.59 − 200) × $100 = $756,059
 *     observed single-contract premium                            = $753,145
 *     ratio                                                       = 0.9961
 *
 * A ratio of ~1.00 is the signature of a REAL deep-in-the-money LEAPS call — a stock-replacement /
 * synthetic-long position, priced at intrinsic with almost no extrinsic left. Symbol parsing,
 * strike scaling and the underlying were all correct.
 *
 * THE ACTUAL BUG IS DOWNSTREAM, AND IT IS WORSE. Premium-weighted flow aggregation treats those
 * prints as ordinary directional conviction. They are not comparable: $753k at the 200 strike buys
 * ONE contract of delta-1 exposure, while $753k at the 7800 strike buys dozens of contracts of
 * actual directional bet. Because deep-ITM prints are almost always calls, they push net premium
 * one way with structural reliability. Measured on the same 500-row SPX tape:
 *
 *     net premium INCLUDING deep-ITM = +$38.75M   → reads as bullish call flow
 *     net premium EXCLUDING deep-ITM =  −$7.76M   → reads bearish
 *
 * 47 rows out of 500 (9.4%) INVERTED THE SIGN of the headline flow read. That number reaches
 * members through HELIX's net flow, the Largo context rail, and every "flow is bullish" sentence
 * Largo writes.
 *
 * THE PRINCIPLE. A validator's job is not to make data look clean — it is to stop the synthesis
 * layer from reasoning over numbers that do not mean what the aggregation assumes. So:
 *
 *  - NOTHING IS SILENTLY DROPPED. Every exclusion is returned with its reason. A row removed
 *    without a trace turns "we discounted this" into "this never happened", which is the same
 *    class of lie as inventing it.
 *  - EXCLUSION IS SCOPED, NOT GLOBAL. A deep-ITM print is excluded from the DIRECTIONAL tally and
 *    still shown on the tape. It is real; it just is not a vote.
 *  - MALFORMED AND UNUSUAL ARE DIFFERENT VERDICTS. A strike far from spot whose premium matches
 *    intrinsic is unusual and TRUE. One whose premium does not is suspect. Collapsing them would
 *    have deleted a real institutional position as "bad data".
 *
 * PURE AND TOTAL: no IO, no clock (callers pass `nowMs`), no throw.
 */

export type FlowIssueCode =
  | "strike_missing"
  | "premium_missing"
  | "expiry_missing"
  | "expired"
  | "premium_is_intrinsic"
  | "strike_implausible"
  | "stale";

export type FlowIssueSeverity =
  /** Keep it everywhere; just say so. */
  | "note"
  /** Keep on the tape, remove from the DIRECTIONAL tally. */
  | "exclude_directional"
  /** Remove from everything — the row cannot be trusted at all. */
  | "exclude";

export type FlowIssue = {
  code: FlowIssueCode;
  severity: FlowIssueSeverity;
  /** Member-facing, specific, and never accusatory about data that turns out to be real. */
  message: string;
};

/** The minimum shape a print must have to be validated. Extra fields pass through untouched. */
export type FlowPrint = {
  ticker?: string | null;
  strike?: number | null;
  premium?: number | null;
  option_type?: string | null;
  expiry?: string | null;
  alerted_at?: string | null;
};

export type ValidatedPrint<T extends FlowPrint> = {
  row: T;
  issues: FlowIssue[];
  /** False when any issue is `exclude`. */
  usable: boolean;
  /** False when any issue is `exclude` or `exclude_directional`. */
  directional: boolean;
};

/**
 * How deep in the money a contract must be before its premium stops being a measure of conviction.
 *
 * MEASURED, NOT GUESSED. The live ITM-depth distribution on 2026-08-10 shows a clean separation
 * rather than a continuum (intrinsic ÷ spot, 500 prints per name):
 *
 *              OTM/ATM   0-5%ITM   5-20%    20-50%    >50%
 *     SPX        65%       23%       4%       1%       7%   ← the stock-replacement cluster
 *     SPY        32%       31%      31%       4%       1%
 *     NVDA       49%       37%      14%        —        —
 *
 * The deep cluster is distinct: SPX jumps from 1% of rows at 20-50% to 7% above 50%, and that 7%
 * carries $34.4M. 20% is placed in the empty valley between ordinary ITM directional trades and
 * that cluster, so it separates the two populations instead of cutting through either.
 *
 * A NOTE ON WHAT WAS TRIED AND REJECTED. The first version tried to CORROBORATE a far strike by
 * checking whether its premium divided into whole contracts priced at intrinsic. That test is
 * vacuous: `premium ÷ intrinsic` rounded to the nearest whole contract reproduces intrinsic for any
 * large contract count, so every ITM print passed it. It fired on 363 of 500 SPY rows before the
 * live run caught it. Aggregate premium cannot recover a per-contract price, and no arithmetic on
 * this data can separate "real deep-ITM LEAPS" from "malformed strike" — so this module does not
 * claim to. It excludes both from the DIRECTIONAL read, where they are equally wrong either way,
 * and flags the extreme ones for verification without asserting which they are.
 */
export const DEEP_ITM_THRESHOLD = 0.2;

/**
 * Beyond this distance from spot, a strike is surfaced for human verification.
 *
 * NOT called malformed. The SPX 200 print sits 97% from spot and is REAL — a deep-ITM LEAPS whose
 * premium ($753,145) matches intrinsic ((7760.59 − 200) × 100 = $756,059) to 0.4%. Asserting
 * "bad data" would have deleted a genuine institutional position. The honest verdict is
 * "anomalous — verify", which is also the only verdict the data supports.
 */
export const STRIKE_VERIFY_MONEYNESS = 0.5;

/** Older than this and a print describes a tape that has moved on. */
export const STALE_PRINT_MS = 30 * 60 * 1000;

const CONTRACT_MULTIPLIER = 100;

/**
 * Per-contract intrinsic value, or null when it cannot be computed.
 *
 * This is the whole validator's load-bearing calculation: it is what separates "the parser is
 * broken" from "an institution bought a synthetic long".
 */
export function intrinsicPerContract(
  spot: number | null,
  strike: number | null,
  optionType: string | null | undefined
): number | null {
  if (spot == null || strike == null || !Number.isFinite(spot) || !Number.isFinite(strike)) return null;
  const isCall = String(optionType ?? "").toUpperCase().startsWith("C");
  const isPut = String(optionType ?? "").toUpperCase().startsWith("P");
  if (!isCall && !isPut) return null;
  const diff = isCall ? spot - strike : strike - spot;
  return Math.max(0, diff) * CONTRACT_MULTIPLIER;
}

/**
 * Validate one print against live spot.
 *
 * `spot` may be null (no quote this turn) — in that case the moneyness checks are SKIPPED rather
 * than guessed. A validator that fails open on missing reference data would reject a healthy tape
 * every time the quote feed hiccuped, which is a worse failure than the one it is preventing.
 */
export function validatePrint<T extends FlowPrint>(row: T, spot: number | null, nowMs: number): ValidatedPrint<T> {
  const issues: FlowIssue[] = [];
  const strike = num(row.strike);
  const premium = num(row.premium);

  if (strike == null) {
    issues.push({ code: "strike_missing", severity: "exclude", message: "no strike on the print" });
  }
  if (premium == null || premium <= 0) {
    issues.push({ code: "premium_missing", severity: "exclude", message: "no premium on the print" });
  }

  if (row.expiry) {
    const exp = Date.parse(`${row.expiry}T23:59:59Z`);
    if (Number.isFinite(exp) && exp < nowMs) {
      issues.push({ code: "expired", severity: "exclude", message: `expired ${row.expiry}` });
    }
  } else {
    // A note, not an exclusion: an undated print is still a real premium event, it just cannot
    // participate in anything expiry-scoped.
    issues.push({ code: "expiry_missing", severity: "note", message: "no expiry on the print" });
  }

  if (row.alerted_at) {
    const t = Date.parse(row.alerted_at);
    if (Number.isFinite(t) && nowMs - t > STALE_PRINT_MS) {
      issues.push({
        code: "stale",
        severity: "note",
        message: `printed ${Math.round((nowMs - t) / 60000)}m ago`,
      });
    }
  }

  if (spot != null && Number.isFinite(spot) && spot > 0 && strike != null && premium != null && premium > 0) {
    const intrinsic = intrinsicPerContract(spot, strike, row.option_type);
    const itmDepth = intrinsic == null ? 0 : intrinsic / CONTRACT_MULTIPLIER / spot;
    const moneyness = Math.abs(strike - spot) / spot;

    if (itmDepth > DEEP_ITM_THRESHOLD) {
      issues.push({
        code: "premium_is_intrinsic",
        severity: "exclude_directional",
        // Named as what it IS. The print is real and worth showing; it is simply a POSITION rather
        // than an OPINION. Premium-weighting it as conviction is what inverts the tape's direction.
        message: `${(itmDepth * 100).toFixed(0)}% in the money — premium is mostly intrinsic, so it sizes a position rather than a view`,
      });
    }

    // Surfaced for verification, never asserted malformed — see STRIKE_VERIFY_MONEYNESS. This is
    // additive to the deep-ITM exclusion above: a 97%-ITM strike is both non-directional AND worth
    // a human look, and reporting only one of those loses the other.
    if (moneyness > STRIKE_VERIFY_MONEYNESS) {
      issues.push({
        code: "strike_implausible",
        severity: itmDepth > DEEP_ITM_THRESHOLD ? "note" : "exclude",
        message: `strike ${strike} sits ${(moneyness * 100).toFixed(0)}% from spot ${spot.toFixed(2)} — verify contract symbol, underlying and strike multiplier`,
      });
    }
  }

  const usable = !issues.some((i) => i.severity === "exclude");
  return {
    row,
    issues,
    usable,
    directional: usable && !issues.some((i) => i.severity === "exclude_directional"),
  };
}

export type FlowValidationSummary = {
  total: number;
  /** Rows that survived every hard check. */
  usable: number;
  /** Rows that count toward the directional tally. */
  directional: number;
  /** Net premium over DIRECTIONAL rows — the honest number. */
  netPremium: number | null;
  /** Net premium over every usable row, including the deep-ITM distortion. Kept so the two can be
   *  compared rather than one quietly replacing the other. */
  netPremiumUnfiltered: number | null;
  /** True when the two disagree on SIGN — the loud case, worth saying out loud. */
  signInverted: boolean;
  /** What was removed and why, aggregated by code. Never empty when something was removed. */
  exclusions: Array<{ code: FlowIssueCode; count: number; message: string }>;
};

/**
 * Validate a tape and produce the directional net premium.
 *
 * Returns BOTH nets on purpose. Replacing the old number silently would fix the read and hide that
 * it ever needed fixing — and `signInverted` is exactly the condition under which a member deserves
 * to be told that the headline flow number changed direction once stock-replacement prints were
 * set aside.
 */
export function validateFlowTape<T extends FlowPrint>(
  rows: readonly T[],
  spot: number | null,
  nowMs: number
): { validated: ValidatedPrint<T>[]; summary: FlowValidationSummary } {
  const validated = rows.map((r) => validatePrint(r, spot, nowMs));

  const signed = (v: ValidatedPrint<T>) => {
    const p = num(v.row.premium) ?? 0;
    return String(v.row.option_type ?? "").toUpperCase().startsWith("P") ? -p : p;
  };

  const usableRows = validated.filter((v) => v.usable);
  const directionalRows = usableRows.filter((v) => v.directional);

  const netPremium = directionalRows.length ? directionalRows.reduce((s, v) => s + signed(v), 0) : null;
  const netPremiumUnfiltered = usableRows.length ? usableRows.reduce((s, v) => s + signed(v), 0) : null;

  const byCode = new Map<FlowIssueCode, { count: number; message: string }>();
  for (const v of validated) {
    for (const i of v.issues) {
      if (i.severity === "note") continue;
      const prev = byCode.get(i.code);
      byCode.set(i.code, { count: (prev?.count ?? 0) + 1, message: prev?.message ?? i.message });
    }
  }

  return {
    validated,
    summary: {
      total: rows.length,
      usable: usableRows.length,
      directional: directionalRows.length,
      netPremium,
      netPremiumUnfiltered,
      signInverted:
        netPremium != null &&
        netPremiumUnfiltered != null &&
        netPremium !== 0 &&
        netPremiumUnfiltered !== 0 &&
        Math.sign(netPremium) !== Math.sign(netPremiumUnfiltered),
      exclusions: [...byCode.entries()].map(([code, v]) => ({ code, count: v.count, message: v.message })),
    },
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
