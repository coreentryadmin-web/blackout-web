// Round a tool result to a precision a reader can use, at the boundary where data stops being
// COMPUTED WITH and starts being READ.
//
// WHY. A live scan of 23 tool results found 547 numbers carrying more decimals than any real
// measurement has: `total_premium = 4276339.059400001`, `avg30_stock_volume =
// 45756696.409090909091` (twenty significant digits, the repeating decimal of an average),
// `delta = 0.9160819881475173`, `iv = 0.022560723076101536`. Those digits are IEEE-754 residue and
// provider formatting, not precision — and once they reach a reader they get printed. This repo
// has been carrying "several endpoints serve unrounded floats — round at the data layer" as a
// known systemic note for months.
//
// WHY HERE AND NOT IN THE PROVIDERS. "The data layer" is the tempting place and it is the wrong
// one. `mapBars` and the chain fetchers feed COMPUTE paths — entry context, the GEX matrix,
// position sizing. Rounding a delta before it is used in a calculation changes the calculation's
// result, which would be introducing a real defect to fix a cosmetic one. So the rounding happens
// at the model's tool boundary (`makeGuardedToolRunner`), which is used only by the answer loop.
// Every other `runLargoTool` caller — `full-platform-snapshot`, `platform-context`, `helix-read` —
// is untouched and keeps full precision.
//
// Same principle as stamping session dates onto bars: fix it where the READER is.

/** Decimals kept for magnitudes at or above 1 — prices, premiums, volumes, GEX notional. */
const DECIMALS_AT_OR_ABOVE_ONE = 4;
/** Significant digits kept below 1 — greeks and IV, where a fixed decimal count destroys small values. */
const SIGNIFICANT_BELOW_ONE = 6;

/** A string that is ENTIRELY a number — how Unusual Whales serves its whole surface. */
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;

/**
 * Round one number for reading.
 *
 * Integers pass through untouched — a share count, a strike, an OI, an epoch. Above 1 a fixed 4dp
 * is right, because the quantity's own precision is what matters. Below 1 it must be SIGNIFICANT
 * digits instead: a gamma of 0.0000123456789 rounded to 4dp is 0.0000, which turns a real small
 * number into a false zero — the exact class of harm this module exists to avoid.
 */
export function roundNumberForReading(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return n;
  const abs = Math.abs(n);
  if (abs >= 1) return Number(n.toFixed(DECIMALS_AT_OR_ABOVE_ONE));
  return Number(n.toPrecision(SIGNIFICANT_BELOW_ONE));
}

/**
 * Round a numeric STRING, returning a string. The type is preserved deliberately: UW's payloads
 * are string-typed throughout, and silently turning `"7705"` into `7705` would change the shape of
 * a result that consumers and the model have both been reading as text.
 */
function roundNumericStringForReading(s: string): string {
  const trimmed = s.trim();
  if (!NUMERIC_STRING.test(trimmed)) return s;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return s;
  const rounded = roundNumberForReading(n);
  // An unchanged value keeps its ORIGINAL text. `"7.10"` is a deliberate two-decimal quote and
  // String(7.1) would drop the trailing zero — a silent change to what the provider stated.
  return rounded === n ? s : String(rounded);
}

/**
 * Deep-copy a tool result with every number and numeric string rounded for reading.
 *
 * Structure is preserved exactly — same keys, same order, same array lengths, same non-numeric
 * values. Only the precision of numbers changes. Anything it cannot walk (a cycle, a class
 * instance, a Map) is returned as-is rather than mangled: a result this cannot round is a result
 * it must not damage.
 */
export function roundResultForReading<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === "number") return roundNumberForReading(value) as unknown as T;
  if (typeof value === "string") return roundNumericStringForReading(value) as unknown as T;
  if (!value || typeof value !== "object") return value;

  // A cycle would otherwise recurse forever. Returning the node untouched is correct: the caller
  // gets a structurally identical result, just unrounded in that branch.
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => roundResultForReading(v, seen)) as unknown as T;
  }
  // Only plain objects are rebuilt. A Date, Map, Set or class instance is left alone — copying it
  // into a bare object would lose its behaviour, which is worse than leaving a float long.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = roundResultForReading(v, seen);
  }
  return out as unknown as T;
}
