// LARGO PRODUCT CONTRACT — the types.
//
// `docs/audit/LARGO-PRODUCT-CONTRACT.md` states the contract in prose. Prose is remembered or
// forgotten; this file makes the load-bearing parts mechanical, so `tsc` enforces what a reviewer
// would otherwise have to catch by eye across five lanes working in parallel.
//
// THE ONE DESIGN DECISION THAT MATTERS. `ProductRead` is a DISCRIMINATED UNION, not a bag with
// optional fields:
//
//     { ok: true;  data: T }                 |  { ok: false; unavailable: Unavailable }
//
// That makes the contract's most important rule — C3, never return `[]`/`null`/`{}` to mean
// "unavailable" — **structurally impossible to violate**. You cannot construct an `ok: true` read
// with no data, and you cannot signal absence without stating a reason. A convention that says
// "please include a reason" gets skipped under deadline; a type that will not compile does not.
//
// This is the shape behind the defect the contract was written for: Vector Pulse returning an empty
// signal list on the first read of a session, where empty means "no baseline yet" and reads as "the
// tape is quiet". Both are `[]`. Only one is a finding.
//
// ADDITIVE BY CONSTRUCTION. `ProductRead<T>` wraps a product's own `T` — it never replaces it. A
// product keeps every native field it has; the contract adds the frame around it. Flattening
// product-specific intelligence to satisfy this is a violation, not compliance.

/** The products Largo reasons across. */
export type ProductId = "helix" | "thermal" | "vector" | "meridian" | "nighthawk" | "spx";

/**
 * How current a value is.
 *
 * `cached` and `snapshot` are deliberately distinct: a cached value could have been recomputed on
 * demand, while a snapshot is a point-in-time capture that by design will not be. A member reading
 * "positioning as of 09:31" deserves to know which of those they are looking at.
 */
export type Freshness = "live" | "delayed" | "cached" | "snapshot" | "stale";

/** Normalized direction. Products keep their own richer notion alongside this. */
export type Direction = "bullish" | "bearish" | "neutral";

/** SPX ≈ 10 × SPY. A cross-product comparison that mixes classes yields a plausible wrong number. */
export type TickerClass = "index" | "equity" | "etf";

export type ProvenanceSource =
  | "polygon"
  | "unusual_whales"
  | "benzinga"
  | "internal_db"
  | "redis"
  | "computed";

/**
 * Why there is no data — never merely that there is none.
 *
 * `retryable` separates "the upstream is down, ask again" from "this does not exist for this
 * ticker", which are different answers to a member and must not collapse into one.
 */
export type Unavailable = {
  reason: string;
  what_is_missing: string;
  retryable: boolean;
};

/**
 * Calibrated confidence.
 *
 * OMIT this entirely when a product cannot calibrate. An invented 0.7 is worse than nothing here,
 * because the integration layer compares it against another lane's measured one — fabricated
 * certainty does not stay local, it corrupts the cross-product ranking.
 */
export type Confidence = {
  /** 0..1 inclusive. */
  score: number;
  /** What the score is derived from. A score with no basis is not a fact. */
  basis: string;
  /** Population behind the score, or null when it is not sample-derived. */
  sample_size: number | null;
};

/** The frame every Largo-facing product read carries. */
export type ProductReadMeta = {
  product: ProductId;
  /** "YYYY-MM-DD HH:mm ET" — never an epoch as the only time (C1). */
  as_of: string;
  freshness: Freshness;
  age_seconds: number | null;
  source: ProvenanceSource;
  /** For derived values: what computed this. */
  computed_by?: string;
  /**
   * REQUIRED alongside any rate / coverage / fill number. A fill rate without its cohort is not a
   * fact about the field — `intel.thermal` reads 0% filled on micro-caps with no options market and
   * 10/10 at importance>=4. Same field, opposite conclusions.
   */
  cohort?: string;
};

/**
 * A product's answer to one question, with everything needed to read it and nothing implied.
 *
 * The union is the point — see the file header.
 */
export type ProductRead<T> = ProductReadMeta &
  ({ ok: true; data: T } | { ok: false; unavailable: Unavailable });

/** A normalized directional claim a product makes, joinable across lanes. */
export type ProductSignal = {
  ticker: string;
  ticker_class: TickerClass;
  direction: Direction;
  /** The specific numbers behind the claim, not a restatement of it (C7). */
  evidence: string[];
  /** Omitted, never faked, when the product cannot calibrate (C6). */
  confidence?: Confidence;
  /** The product's own richer reading — posture, regime, tone, tier. Never flattened away. */
  native?: Record<string, unknown>;
};

/** Build an `ok` read. */
export function productRead<T>(meta: ProductReadMeta, data: T): ProductRead<T> {
  return { ...meta, ok: true, data };
}

/** Build an `unavailable` read. The reason is mandatory by signature, not by convention. */
export function productUnavailable<T>(
  meta: ProductReadMeta,
  unavailable: Unavailable
): ProductRead<T> {
  return { ...meta, ok: false, unavailable };
}

/** Uppercase canonical root: `SPX`, never `I:SPX` or `SPXW` (C4). */
export function canonicalTicker(raw: string): string {
  const t = String(raw ?? "").trim().toUpperCase();
  // Polygon prefixes indices with `I:`; UW and the option roots append W/X variants for the
  // weekly/PM-settled contracts. All three denote the same underlying to a member.
  const withoutPrefix = t.startsWith("I:") ? t.slice(2) : t;
  if (withoutPrefix === "SPXW" || withoutPrefix === "SPXPM") return "SPX";
  return withoutPrefix;
}

const VALID_FRESHNESS: readonly Freshness[] = ["live", "delayed", "cached", "snapshot", "stale"];
const VALID_DIRECTION: readonly Direction[] = ["bullish", "bearish", "neutral"];
const ET_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} ET$/;

/**
 * Contract violations in a read, as human-readable strings. Empty means compliant.
 *
 * Runtime checking exists because `tsc` cannot see a payload assembled from `unknown` provider JSON
 * — which is exactly how most of these values arrive. Tests assert this returns empty; it is not
 * meant to run on the hot path.
 */
export function contractViolations(read: unknown): string[] {
  const out: string[] = [];
  if (!read || typeof read !== "object" || Array.isArray(read)) return ["read is not an object"];
  const r = read as Record<string, unknown>;

  if (typeof r.as_of !== "string" || !ET_STAMP.test(r.as_of)) {
    out.push(`as_of must be "YYYY-MM-DD HH:mm ET" (got ${JSON.stringify(r.as_of)})`);
  }
  if (typeof r.freshness !== "string" || !VALID_FRESHNESS.includes(r.freshness as Freshness)) {
    out.push(`freshness must be one of ${VALID_FRESHNESS.join("|")} (got ${JSON.stringify(r.freshness)})`);
  }
  if (r.age_seconds !== null && typeof r.age_seconds !== "number") {
    out.push("age_seconds must be a number or null");
  }
  if (typeof r.source !== "string") out.push("source (provenance) is required");

  if (r.ok === true) {
    if (!("data" in r)) out.push("ok:true read must carry data");
  } else if (r.ok === false) {
    const u = r.unavailable as Record<string, unknown> | undefined;
    if (!u || typeof u !== "object") {
      out.push("ok:false read must carry unavailable{reason,what_is_missing,retryable}");
    } else {
      if (!u.reason) out.push("unavailable.reason is required — absence must state why");
      if (!u.what_is_missing) out.push("unavailable.what_is_missing is required");
      if (typeof u.retryable !== "boolean") out.push("unavailable.retryable must be a boolean");
    }
  } else {
    out.push("ok must be true or false");
  }

  return out;
}

/** Contract violations in a signal. Empty means compliant. */
export function signalViolations(signal: unknown): string[] {
  const out: string[] = [];
  if (!signal || typeof signal !== "object" || Array.isArray(signal)) return ["signal is not an object"];
  const s = signal as Record<string, unknown>;

  if (typeof s.ticker !== "string" || !s.ticker) out.push("ticker is required");
  else if (s.ticker !== canonicalTicker(s.ticker)) {
    out.push(`ticker must be canonical (got ${s.ticker}, want ${canonicalTicker(s.ticker)})`);
  }
  if (typeof s.ticker_class !== "string") out.push("ticker_class is required");
  if (typeof s.direction !== "string" || !VALID_DIRECTION.includes(s.direction as Direction)) {
    out.push(`direction must be one of ${VALID_DIRECTION.join("|")}`);
  }
  if (!Array.isArray(s.evidence) || s.evidence.length === 0) {
    out.push("evidence must be a non-empty array of the numbers behind the claim");
  }

  // Confidence is OPTIONAL by design. Present-but-malformed is the failure, because a
  // half-specified score still gets compared against another lane's real one.
  if (s.confidence !== undefined) {
    const c = s.confidence as Record<string, unknown>;
    if (!c || typeof c !== "object") out.push("confidence must be an object when present");
    else {
      if (typeof c.score !== "number" || !(c.score >= 0 && c.score <= 1)) {
        out.push("confidence.score must be a number in 0..1");
      }
      if (typeof c.basis !== "string" || !c.basis) {
        out.push("confidence.basis is required — a score with no basis is not a fact");
      }
      if (c.sample_size !== null && typeof c.sample_size !== "number") {
        out.push("confidence.sample_size must be a number or null");
      }
    }
  }

  return out;
}
