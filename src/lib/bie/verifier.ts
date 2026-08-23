// BLACKOUT Intelligence Engine — Layer 4 numeric claim verifier (pure).
// Every figure an LLM answer contains must be traceable to data the platform
// actually served that turn (live feed + tool results). Numbers that can't be
// traced are flagged — the answer states uncertainty instead of wearing fake
// precision. Deterministic and unit-tested; no model judges another model here.

export type ClaimVerification = {
  total: number;
  verified: number;
  unverified: number[];
  /** verified / total, or NULL when the answer makes no numeric claims (total === 0). Null is
   *  deliberate: coverage over zero claims is uncalibrated, and returning 1 (100%) advertised a
   *  degraded, data-less answer as fully grounded — the "fabricated certainty" LARGO-PRODUCT-CONTRACT
   *  forbids, and exactly what the empty-round P0 payload showed (`{total:0,verified:0,coverage:1}`).
   *  Every consumer must treat null as "not applicable", never as a low OR high score. (#2582 follow-up) */
  coverage: number | null;
};

/** Numbers an answer "claims": decimals, percents, $-amounts, 3+ digit ints.
 *  Small bare integers (list counts, "3 lines"), years, and times are not claims. */
export function extractNumericClaims(text: string): number[] {
  const out: number[] = [];
  // Strip markdown emphasis + commas inside numbers for cleaner matching.
  const cleaned = text.replace(/[*_`]/g, "").replace(/(\d),(\d{3})\b/g, "$1$2");
  const re = /\$?\s?(-?\d+(?:\.\d+)?)\s?%?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const raw = m[1]!;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const hasDecimal = raw.includes(".");
    const abs = Math.abs(n);
    const isDollar = cleaned[m.index] === "$" || cleaned.slice(Math.max(0, m.index - 1), m.index) === "$";
    const isPct = cleaned.slice(m.index + m[0].length - 1, m.index + m[0].length) === "%" || m[0].trimEnd().endsWith("%");
    // Years and clock-like values are prose, not claims.
    if (!hasDecimal && abs >= 1900 && abs <= 2100) continue;
    // Bare small integers without $/% context are counts ("3 plays"), not claims.
    if (!hasDecimal && !isDollar && !isPct && abs <= 31) continue;
    out.push(n);
  }
  return out;
}

/** Collect every numeric value reachable in the turn's source data (tool results,
 *  live-feed objects, payloads) — the ground truth an answer may cite. */
export function collectContextNumbers(source: unknown, out: number[] = [], depth = 0): number[] {
  if (depth > 8 || source == null) return out;
  if (typeof source === "number") {
    if (Number.isFinite(source)) out.push(source);
    return out;
  }
  if (typeof source === "string") {
    // Strings inside tool results often carry formatted numbers ("7,502.5", "$4.20").
    for (const n of extractAllNumbers(source)) out.push(n);
    return out;
  }
  if (Array.isArray(source)) {
    for (const v of source.slice(0, 200)) collectContextNumbers(v, out, depth + 1);
    return out;
  }
  if (typeof source === "object") {
    for (const v of Object.values(source as Record<string, unknown>)) collectContextNumbers(v, out, depth + 1);
  }
  return out;
}

function extractAllNumbers(text: string): number[] {
  const out: number[] = [];
  const cleaned = text.replace(/(\d),(\d{3})\b/g, "$1$2");
  const re = /-?\d+(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** A claim is verified when a source number matches within 0.5% (or 0.02 absolute
 *  for small values) — tolerant of rounding, intolerant of invention. Derived
 *  values the desk itself teaches (percent deltas, x2/x0.5 of a source value)
 *  also count, so "target $8.40" verifies against a $4.20 entry. */
/**
 * The heading of the caveat `applyVerificationCaveat` appends when Layer-4 coverage drops below
 * threshold — and the string `auditLargoAnswerGrounding` looks for to tell "already disclosed" from
 * "silently ungrounded".
 *
 * IT USED TO BE `"BIE verification"`, WHICH NOTHING EVER EMITTED. The producer wrote
 * `_Data check: …_`, so `alreadyDisclosed` was false on every answer that had in fact been
 * caveated, and the cron re-flagged disclosures as undisclosed — defeating the entire point of the
 * check. Two hand-kept strings, drifted, with nothing binding them.
 *
 * So it is now the marker the producer BUILDS ITS HEADING FROM (`turn-outcome.ts` imports this),
 * and it is also the phrase the terminal's caveat matcher keys on
 * (`features/largo/answer/answer-caveats.ts` → kind `verification` → label "Grounding note").
 * One constant, one producer, two consumers — it cannot drift again without a test failing.
 */
export const LARGO_RUNTIME_CAUTION_MARKER = "Grounding note";

/** Same thresholds largo-terminal.ts uses before appending the caution footer. */
export const LARGO_GROUNDING_MIN_CLAIMS = 4;
export const LARGO_GROUNDING_COVERAGE_THRESHOLD = 0.5;

/**
 * Cron-side Largo answer audit — uses the SAME claim extraction + matching as the in-turn Layer-4
 * verifier (verifyClaims), and flags only when runtime would have appended the caution footer but
 * did not (undisclosed low coverage). Answers that already carry the footer are not re-flagged.
 */
export function auditLargoAnswerGrounding(
  answerText: string,
  toolResults: unknown[]
): { verification: ClaimVerification; shouldFlag: boolean } {
  const verification = verifyClaims(answerText, collectContextNumbers(toolResults));
  const alreadyDisclosed = answerText.includes(LARGO_RUNTIME_CAUTION_MARKER);
  const shouldFlag =
    !alreadyDisclosed &&
    verification.total >= LARGO_GROUNDING_MIN_CLAIMS &&
    verification.coverage != null &&
    verification.coverage < LARGO_GROUNDING_COVERAGE_THRESHOLD;
  return { verification, shouldFlag };
}

export function verifyClaims(answerText: string, contextNumbers: number[]): ClaimVerification {
  const claims = extractNumericClaims(answerText);
  // No numeric claims → coverage is UNDEFINED, not 100%. Returning null keeps a data-less answer
  // from advertising perfect grounding downstream (the payload leaves the process). (#2582 follow-up)
  if (claims.length === 0) return { total: 0, verified: 0, unverified: [], coverage: null };

  const ctx = contextNumbers.filter((n) => Number.isFinite(n));
  const matches = (claim: number): boolean =>
    ctx.some((src) => {
      const candidates = [src, src * 2, src * 0.5, -src, src * 100, src / 100];
      return candidates.some((c) => {
        const tol = Math.max(Math.abs(c) * 0.005, 0.02);
        return Math.abs(claim - c) <= tol;
      });
    });

  const unverified: number[] = [];
  let verified = 0;
  for (const claim of claims) {
    if (matches(claim)) verified += 1;
    else unverified.push(claim);
  }
  return {
    total: claims.length,
    verified,
    unverified: unverified.slice(0, 10),
    coverage: Math.round((verified / claims.length) * 100) / 100,
  };
}
