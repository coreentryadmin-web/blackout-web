/**
 * Normalize Unusual Whales earnings payloads before they reach the model.
 *
 * THE PROBLEM. UW serves its ENTIRE earnings surface as strings, and its move/return fields as
 * unlabelled FRACTIONS carried to absurd precision. Measured live 2026-08-21 across
 * `/api/earnings/{ticker}`, `/api/earnings/premarket` and `/api/earnings/afterhours`:
 * **32 of 32 fields string-typed, 13 of them with more than 4 decimal places, up to 24.**
 *
 *     "expected_move_perc": "0.05330873875951118285"     (NVDA — five point three three percent)
 *     "reaction":           "-0.0915"                    (WMT  — down nine point one five percent)
 *     "post_earnings_move_1w": "-0.04864187586700675706"
 *
 * `get_earnings`, `get_earnings_history` and `get_earnings_market` passed these through verbatim.
 * Two failures compound:
 *
 *   1. UNITS. A model shown `reaction: -0.0915` beside `expected_move: 11.56` (dollars) and
 *      `street_mean_est: 2.09` (dollars) has no way to know the first is a fraction. Read as a
 *      percent it says WMT slipped 0.09% on its print. It fell 9.15%. That is a 100x error on
 *      the single number a member most often asks for, and it reads as a confident answer.
 *   2. PRECISION. 20 significant decimals on a quantity derived from two 2-decimal closes is
 *      false precision — it implies a measurement nobody made.
 *
 * `roundFloats`, the repo's response-shaping helper, is BLIND to both: it short-circuits on
 * `typeof v === "number"`, and every one of these values is a string.
 *
 * SCOPE — THIS MODULE FIXES (1) ONLY. #2419 (`core/round-for-reading.ts`) now rounds every tool
 * result at the model's boundary and DOES handle numeric strings, so precision is already solved
 * upstream of here. Measured on a real UW row:
 *
 *   raw          reaction "-0.0915"   expected_move_perc "0.05330873875951118285"
 *   #2419 alone  reaction "-0.0915"   expected_move_perc "0.0533087"
 *   this + #2419 reaction_pct -9.15   expected_move_pct  5.33
 *
 * #2419 fixes the decimals and cannot fix the units — a correctly-rounded fraction is still read
 * as a percent. The two are complementary; this module deliberately does NOT re-round, and does
 * NOT coerce provider strings to numbers, because #2419 preserves string type on purpose ("silently
 * turning `\"7705\"` into `7705` would change the shape of a result that consumers and the model
 * have both been reading as text"). The `_pct` fields below ARE emitted as numbers — they are values
 * this module COMPUTES, not provider text passed through, so there is no provider shape to preserve.
 *
 * THE UNIT CONVENTION IS VERIFIED, NOT ASSUMED. Two independent live checks:
 *
 *   - `reaction` is exactly `(post_earnings_close - pre_earnings_close) / pre_earnings_close`.
 *     Across six unrelated tickers (AIIR, WMT, BABA, DE, NTES, AEG) the served value and the
 *     value derived from the row's own two closes agree to ~1e-5 — the residual is UW's own
 *     4-decimal rounding.
 *   - `short_straddle_*` / `long_straddle_*` are returns: short and long are near mirror images
 *     (sum ≈ -0.01 to -0.08, i.e. the spread) across every NVDA print on file, at magnitudes of
 *     5%-75%.
 *
 * `expected_move_perc` was already established: `src/lib/zerodte/earnings.ts` multiplies it by
 * 100 to reach a percent, and has done since that surface was built. This module makes the three
 * Largo earnings tools agree with the 0DTE surface instead of contradicting it.
 *
 * THE UNIT NOW LIVES IN THE NAME. Every converted field is renamed to end in `_pct`, so the
 * meaning travels with the value rather than depending on a caller remembering a convention. The
 * raw fractional key is NOT also emitted — keeping both would hand the model two numbers for one
 * quantity differing by 100x, which is worse than the bug.
 */

/**
 * Fraction → percent, keyed by UW's field name, valued by the name it is served under.
 *
 * Every entry is a MOVE or a RETURN expressed as a fraction of a price. A field is only listed
 * here if its unit was verified live (see the module note) — an unrecognised numeric field is
 * left under its own name rather than being guessed into a percent, because a missing unit is
 * recoverable and a wrong one is not.
 */
const FRACTION_TO_PCT_ENTRIES: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ["expected_move_perc", "expected_move_pct"],
  ["reaction", "reaction_pct"],
  ["pre_earnings_move_1d", "pre_earnings_move_1d_pct"],
  ["pre_earnings_move_3d", "pre_earnings_move_3d_pct"],
  ["pre_earnings_move_1w", "pre_earnings_move_1w_pct"],
  ["pre_earnings_move_2w", "pre_earnings_move_2w_pct"],
  ["post_earnings_move_1d", "post_earnings_move_1d_pct"],
  ["post_earnings_move_3d", "post_earnings_move_3d_pct"],
  ["post_earnings_move_1w", "post_earnings_move_1w_pct"],
  ["post_earnings_move_2w", "post_earnings_move_2w_pct"],
  ["short_straddle_1d", "short_straddle_1d_pct"],
  ["short_straddle_1w", "short_straddle_1w_pct"],
  ["long_straddle_1d", "long_straddle_1d_pct"],
  ["long_straddle_1w", "long_straddle_1w_pct"],
] as const);

/**
 * A Map, not the plain object, for the runtime lookup. Keys reaching it are arbitrary payload
 * property names straight off UW's wire, and a bare `OBJ[key]` would also resolve inherited
 * Object.prototype members — `"constructor"` would come back a truthy FUNCTION and be treated
 * as a rename target. Same reasoning `roundFloats` documents for its own per-key overrides: a
 * Map has no prototype chain, so `undefined` unambiguously means "not a fraction field".
 */
const FRACTION_TO_PCT = new Map<string, string>(FRACTION_TO_PCT_ENTRIES);

/**
 * A canonical JSON number: optional sign, no leading zeros (except a bare "0"), optional
 * fraction. Deliberately strict — `"007"`, `"1e5"`, `"$4"` and `"2026-08-26"` all fail, so an
 * identifier that merely looks numeric is never silently turned into a number and a date is
 * never mangled into one. Surrounding whitespace IS tolerated (the value is trimmed first):
 * padding is an upstream formatting artifact carrying no meaning, and `" 007 "` still fails on
 * its leading zero once trimmed.
 */
const CANONICAL_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** Percents are rounded to 2dp here because this module computes them; nothing else is touched. */
const PCT_DP = 2;

function round(value: number, dp: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return value;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/**
 * Parse a fraction field's value to a number when it unambiguously is one; else null.
 *
 * Only ever called on a key in the rename table, so there is no identifier to protect here — an
 * unparseable value simply yields a null percent rather than a guess.
 */
function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!CANONICAL_NUMBER.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Recursively normalize a UW earnings payload of ANY shape.
 *
 * Shape-agnostic on purpose: `/api/earnings/{ticker}` yields a flat row array while
 * `/api/companies/{ticker}/earnings-estimates` yields `{ ticker, estimates: [...] }`, and both
 * reach these tools through `extractRows`. A recursive walk handles either without each tool
 * having to know which it holds — and stays correct if UW nests something new.
 *
 * Non-numeric values (dates, sectors, `report_time`, company names) pass through untouched.
 */
export function normalizeUwEarnings<T>(value: T): T {
  const walk = (v: unknown, key: string): unknown => {
    if (Array.isArray(v)) return v.map((el) => walk(el, key));
    if (v !== null && typeof v === "object") {
      // Collect ENTRIES and rebuild with Object.fromEntries rather than assigning `out[k] = …`.
      // A plain assignment where `k` is "__proto__" sets the object's PROTOTYPE instead of
      // creating an own property — so that field would be silently DROPPED from the payload
      // (caught by the prototype-collision test, which only exposes it when the fixture is
      // built with JSON.parse, the way these payloads really arrive). fromEntries creates a
      // genuine own property for every key, and is also not a dynamic-property-assignment sink.
      const entries: Array<[string, unknown]> = [];
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const pctName = FRACTION_TO_PCT.get(k);
        if (pctName) {
          const n = asNumber(val);
          // A null/absent fraction stays null under the NEW name — dropping the key entirely
          // would make "UW has no reading" indistinguishable from "this field does not exist".
          entries.push([pctName, n == null ? null : round(n * 100, PCT_DP)]);
          continue;
        }
        entries.push([k, walk(val, k)]);
      }
      return Object.fromEntries(entries);
    }
    // Every non-fraction leaf passes through UNCHANGED — including numeric strings. Rounding and
    // type are #2419's job at the tool boundary, and it preserves provider string shape on purpose.
    return v;
  };
  return walk(value, "") as T;
}

/** The UW field names this module rewrites — exported so tests can assert full coverage. */
export const UW_FRACTION_FIELDS: readonly string[] = Object.freeze(
  FRACTION_TO_PCT_ENTRIES.map(([from]) => from)
);
