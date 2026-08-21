/**
 * Meridian SECTOR COHORTS — put a name's earnings setup next to its peers'.
 *
 * ── WHY A COHORT AT ALL ──────────────────────────────────────────────────────────────
 * "NVDA is pricing a 7.2% move" is a number without a scale. Whether 7.2% is rich, cheap, or
 * exactly normal depends entirely on what the rest of the group is pricing that week — semis
 * routinely price 7-9% into a print while regional banks price 3%. The cohort is what converts
 * an absolute number into a judgement, and it is the input the peer-distribution view needs.
 *
 * ── WHY SIC, AND WHY THE 2-DIGIT MAJOR GROUP ─────────────────────────────────────────
 * SIC is what Polygon actually ships on `/v3/reference/tickers/{t}` (`sic_code`,
 * `sic_description`) — it is a real field on a real feed, not a classification we invent. But the
 * FOUR-digit code is too fine to make a cohort out of: 3674 (semiconductors) would separate NVDA
 * from AVGO's 3672, leaving cohorts of one, and a distribution over one member is not a
 * distribution. The one-digit DIVISION is too coarse in the other direction — it files a
 * semiconductor company and a breakfast-cereal company together under "Manufacturing".
 *
 * The 2-digit MAJOR GROUP is the level that matches how a desk actually thinks: 36 electronics
 * and semis, 73 software and business services, 28 pharma and chemicals, 60 banks. That is the
 * cohort key here. Division is kept only as the fallback label for a major group we have no
 * specific name for, so an unusual name is grouped honestly rather than dropped.
 *
 * ── WHAT THIS FILE WILL NOT DO ───────────────────────────────────────────────────────
 * It will not report a distribution it cannot support. A percentile computed against three peers
 * is arithmetic, not evidence, so cohorts below `MIN_COHORT_PEERS` return a cohort with its
 * members listed and `distribution: null` — the reader sees who the peers are and is told, in as
 * many words, that there are too few of them to rank against.
 */

import { num, round } from "./meridian-viz-core";

/** Below this many PEERS (excluding the subject) no percentile is reported. */
export const MIN_COHORT_PEERS = 4;

export type SectorClassification = {
  /** Cohort key — the 2-digit SIC major group, zero-padded. Null when unclassifiable. */
  majorGroup: string | null;
  /** Human name for the cohort. Specific where we have one, else the SIC division. */
  label: string | null;
  /** The raw 4-digit code, carried so a panel can show provenance. */
  sicCode: string | null;
  /** Polygon's own 4-digit description, verbatim. Never rewritten. */
  sicDescription: string | null;
};

/**
 * SIC major groups seen across optionable US equities, named the way a desk says them.
 *
 * Deliberately not the full 83-entry federal table: every entry here is a group that actually
 * shows up in an options-listed earnings calendar, and the division fallback covers the rest
 * rather than shipping dozens of names nobody will read to cover a case that never fires.
 */
const MAJOR_GROUP_LABELS: Record<string, string> = {
  "01": "Agriculture",
  "10": "Metals & Mining",
  "12": "Coal Mining",
  "13": "Oil & Gas",
  "14": "Nonmetallic Minerals",
  "15": "Construction",
  "16": "Heavy Construction",
  "17": "Building Trades",
  "20": "Food & Beverage",
  "21": "Tobacco",
  "22": "Textiles",
  "23": "Apparel",
  "24": "Lumber & Wood",
  "25": "Furniture",
  "26": "Paper & Packaging",
  "27": "Publishing & Printing",
  "28": "Pharma & Chemicals",
  "29": "Petroleum Refining",
  "30": "Rubber & Plastics",
  "31": "Leather & Footwear",
  "32": "Glass, Clay & Concrete",
  "33": "Primary Metals",
  "34": "Fabricated Metal",
  "35": "Machinery & Computer Hardware",
  "36": "Semis & Electronics",
  "37": "Transportation Equipment",
  "38": "Instruments & Medical Devices",
  "39": "Misc Manufacturing",
  "40": "Railroads",
  "41": "Ground Passenger Transit",
  "42": "Trucking & Warehousing",
  "44": "Marine Transport",
  "45": "Air Transport",
  "46": "Pipelines",
  "47": "Transport Services",
  "48": "Telecom & Media",
  "49": "Utilities",
  "50": "Wholesale — Durables",
  "51": "Wholesale — Nondurables",
  "52": "Building Retail",
  "53": "General Merchandise",
  "54": "Food Retail",
  "55": "Auto Retail",
  "56": "Apparel Retail",
  "57": "Home Furnishings Retail",
  "58": "Restaurants",
  "59": "Specialty & Online Retail",
  "60": "Banks",
  "61": "Consumer & Business Credit",
  "62": "Brokers & Exchanges",
  "63": "Insurance Carriers",
  "64": "Insurance Brokers",
  "65": "Real Estate",
  "67": "Holding & Investment Offices",
  "70": "Lodging",
  "72": "Personal Services",
  "73": "Software & Business Services",
  "75": "Auto Services",
  "78": "Motion Pictures",
  "79": "Recreation & Gaming",
  "80": "Healthcare Services",
  "82": "Education",
  "83": "Social Services",
  "87": "Engineering & Research Services",
  "99": "Nonclassifiable",
};

/** SIC divisions, used only when a major group has no specific name above. */
const DIVISIONS: ReadonlyArray<{ lo: number; hi: number; label: string }> = [
  { lo: 1, hi: 9, label: "Agriculture & Fishing" },
  { lo: 10, hi: 14, label: "Mining" },
  { lo: 15, hi: 17, label: "Construction" },
  { lo: 20, hi: 39, label: "Manufacturing" },
  { lo: 40, hi: 49, label: "Transport & Utilities" },
  { lo: 50, hi: 51, label: "Wholesale Trade" },
  { lo: 52, hi: 59, label: "Retail Trade" },
  { lo: 60, hi: 67, label: "Finance & Real Estate" },
  { lo: 70, hi: 89, label: "Services" },
  { lo: 91, hi: 99, label: "Public Administration" },
];

/**
 * Classify one name from Polygon's reference fields.
 *
 * Codes arrive as either a number or a string, and short codes are genuinely 3-digit (SIC 100 is
 * agricultural production), so the code is left-padded to four rather than truncated — reading
 * "10" off a raw `100` would file a farm under Metals & Mining.
 */
export function classifySic(
  sicCode: unknown,
  sicDescription?: unknown
): SectorClassification {
  const raw = String(sicCode ?? "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  const desc = String(sicDescription ?? "").trim() || null;
  if (!digits || digits.length > 4) {
    return { majorGroup: null, label: null, sicCode: null, sicDescription: desc };
  }
  const padded = digits.padStart(4, "0");
  const major = padded.slice(0, 2);
  const majorNum = Number(major);
  const label =
    MAJOR_GROUP_LABELS[major] ??
    DIVISIONS.find((d) => majorNum >= d.lo && majorNum <= d.hi)?.label ??
    null;
  return { majorGroup: major, label, sicCode: padded, sicDescription: desc };
}

/* ── Peer distribution ────────────────────────────────────────────────────────────── */

export type CohortMember = {
  ticker: string;
  /** The metric being ranked. Null members are carried but never counted. */
  value: number | null;
  /** Optional, for the panel: when this name reports. */
  date?: string | null;
};

export type PeerDistribution = {
  /** 0..1 — share of peers the subject sits at or above. Null when the subject has no value. */
  percentile: number | null;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  /** Peers with a usable value, EXCLUDING the subject. The honest n. */
  peers: number;
};

export type SectorCohort = {
  majorGroup: string;
  label: string;
  /** Every member we could classify into this group, subject included, value-sorted desc. */
  members: CohortMember[];
  /** Null when there are fewer than MIN_COHORT_PEERS peers — stated, not silently degraded. */
  distribution: PeerDistribution | null;
  /** Why there is no distribution, in words the panel can print. */
  insufficientReason: string | null;
};

/**
 * Linear-interpolated quantile over an ascending array. Interpolated rather than
 * nearest-rank because these cohorts are small: with n=6 the nearest-rank p25 and p75 both
 * collapse onto actual members, which makes the IQR jump around as one name is added.
 */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Build the cohort a subject belongs to and rank it inside.
 *
 * The subject is excluded from its own distribution. Including it would drag every statistic
 * toward the value being judged — most visibly in a cohort of five, where a name is guaranteed
 * to look closer to the median simply because it IS part of the median.
 */
export function buildSectorCohort(input: {
  subject: string;
  subjectValue: number | null;
  classification: SectorClassification;
  /** Everyone else on the calendar already classified into the same group. */
  peers: readonly CohortMember[];
}): SectorCohort | null {
  const { majorGroup, label } = input.classification;
  if (!majorGroup) return null;

  const subjectTicker = String(input.subject ?? "").toUpperCase();
  const peerRows = (input.peers ?? []).filter(
    (p) => String(p?.ticker ?? "").toUpperCase() !== subjectTicker
  );
  const values = peerRows.map((p) => num(p.value)).filter((v): v is number => v != null);

  const members = [
    { ticker: subjectTicker, value: num(input.subjectValue) },
    ...peerRows.map((p) => ({ ...p, ticker: String(p.ticker).toUpperCase(), value: num(p.value) })),
  ].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

  const cohortLabel = label ?? `SIC ${majorGroup}`;
  if (values.length < MIN_COHORT_PEERS) {
    return {
      majorGroup,
      label: cohortLabel,
      members,
      distribution: null,
      insufficientReason: `only ${values.length} peer${values.length === 1 ? "" : "s"} reporting with a comparable number — too few to rank against`,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const subjectValue = num(input.subjectValue);
  const percentile =
    subjectValue == null
      ? null
      : round(sorted.filter((v) => v <= subjectValue).length / sorted.length, 4);

  return {
    majorGroup,
    label: cohortLabel,
    members,
    distribution: {
      percentile,
      median: round(quantile(sorted, 0.5), 4),
      p25: round(quantile(sorted, 0.25), 4),
      p75: round(quantile(sorted, 0.75), 4),
      min: round(sorted[0]!, 4),
      max: round(sorted[sorted.length - 1]!, 4),
      peers: sorted.length,
    },
    insufficientReason: null,
  };
}

/**
 * One sentence for the panel.
 *
 * Says "rich"/"cheap" only outside the interquartile range. Inside it the honest statement is
 * "in line", and calling a 55th-percentile print "rich" would manufacture a signal out of the
 * middle of a distribution.
 */
export function describeCohortPosition(
  cohort: SectorCohort | null,
  opts: { unit?: string; noun?: string } = {}
): string | null {
  if (!cohort) return null;
  const noun = opts.noun ?? "implied move";
  if (!cohort.distribution) return `${cohort.label} — ${cohort.insufficientReason}`;
  const d = cohort.distribution;
  const unit = opts.unit ?? "";
  const median = `${d.median}${unit}`;
  if (d.percentile == null) {
    return `${cohort.label} peers are pricing a median ${median} (n=${d.peers})`;
  }
  const pct = Math.round(d.percentile * 100);
  const stance =
    d.percentile >= 0.75 ? "rich to" : d.percentile <= 0.25 ? "cheap to" : "in line with";
  return `${noun} is ${stance} its ${cohort.label} cohort — ${pct}th percentile of ${d.peers} peers, median ${median}`;
}

/**
 * Order names for sector classification so a limited lookup budget buys usable cohorts.
 *
 * The lane is routinely bigger than the budget — measured live 2026-08-18, 199 earnings rows
 * against a 120-lookup cap — so something is always skipped. What matters is WHICH.
 *
 * A cohort cannot rank anything until it has `MIN_COHORT_PEERS` peers carrying a comparable
 * number, and on that same measurement only 22 of the 199 rows had a numeric implied move.
 * Classifying in calendar order therefore spent lookups on rows that could never contribute to a
 * distribution while skipping rows that could. Sorting the ones WITH a value to the front costs
 * nothing extra and is the difference between a panel that ranks and a panel that says "too few
 * peers".
 *
 * Deliberately a STABLE partition, not a full re-sort: within each half the caller's order is
 * preserved, so the calendar's own ordering still decides ties and the output is deterministic.
 */
export function orderTickersForClassification<T>(
  rows: readonly T[] | null | undefined,
  hasValue: (row: T) => boolean,
  tickerOf: (row: T) => string
): string[] {
  const withValue: string[] = [];
  const without: string[] = [];
  for (const row of rows ?? []) {
    const ticker = String(tickerOf(row) ?? "").trim();
    if (!ticker) continue;
    (hasValue(row) ? withValue : without).push(ticker);
  }
  return [...withValue, ...without];
}
