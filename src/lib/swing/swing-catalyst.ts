// src/lib/swing/swing-catalyst.ts — the CATALYST + VOLATILITY grounded reads for swing discovery.
//
// WHY THIS EXISTS: `assembleSwingDossierInput` (swing-ingest.ts) originally grounded only STRUCTURE,
// REL_STRENGTH and FLOW — the four remaining pillars (VOLATILITY / CATALYST / REGIME / DATA_QUALITY) were
// left null, so `scoreSwingPillars` silently renormalized the whole 7-pillar engine to a 3-pillar
// momentum+flow screen. Worse, the archetype classifier's catalyst/earnings signal clusters
// (`catalystInWindow01` / `earningsGapRecent01` / `postEarningsDrift01`) were NEVER grounded, so the two
// EVENT/IMMEDIATE archetypes the persistence FAST-TRACK was built for — EVENT_DRIVEN and POST_EARNINGS_DRIFT
// (taxonomy.ts `ARCHETYPE_PERSISTENCE`) — could never be produced: dead code in the live rail.
//
// This module is the missing grounding, PURE + deterministic so it's testable without live providers. It
// consumes ALREADY-FETCHED, already-parsed provider outputs (Benzinga catalyst news, the ticker's earnings
// rows, the UW EOD IV rank) and maps them to the 0–1 pillar/archetype inputs the dossier consumes. The IO
// (the actual Benzinga/UW calls) lives in the ingest shell + the cron route; nothing here does IO.
//
// NULL-HONESTY (the repo's standing law): a read we can't ground stays null — never a fabricated 0. No fresh
// catalyst AND no earnings-in-window ⇒ `catalystStrength01` is null (the CATALYST pillar drops from the
// score), NOT a measured 0. A name outside the post-earnings drift window carries null drift extras, not 0.

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

// ─── tuning (provisional priors, not graduated edges) ───────────────────────────
/** A Benzinga catalyst within a WEEK is still a live driver for a multi-day swing thesis (unlike the 0DTE
 *  catalyst-news reader's 24h window — a swing holds for days, so a 3-day-old FDA headline still matters). */
export const SWING_CATALYST_WINDOW_DAYS = 7;
/** Post-earnings DRIFT window: ≈10 trading sessions after a print is the classic drift horizon. Outside it a
 *  name is not "drifting off earnings" — the extras stay null (honest absence), so POST_EARNINGS_DRIFT can't
 *  misfire on a stale print. */
export const POST_EARNINGS_DRIFT_WINDOW_DAYS = 15;
/** A ±10% EPS surprise saturates the gap-size read (a huge beat/miss). */
export const EARNINGS_SURPRISE_SATURATION_PCT = 10;
/** A +12% direction-aligned move over the ~10-session lookback saturates the drift read. */
export const POST_EARNINGS_DRIFT_SATURATION_PCT = 12;
/** An UNCONFIRMED (estimated) earnings date is softer evidence than a confirmed one — halve its weight. */
export const EARNINGS_UNCONFIRMED_WEIGHT = 0.5;

/** The confirmed-working Benzinga catalyst channels — a real corporate catalyst, not tape noise. Mirrors
 *  `polygon-news.ts` DEFAULT_CATALYST_CHANNELS + the cortex `CATALYST_CHANNELS` set (kept local so this
 *  pure module has no cortex dependency). Lowercase for matching. */
export const SWING_CATALYST_CHANNELS = new Set([
  "m&a",
  "guidance",
  "short sellers",
  "insider trades",
  "fda",
  "buybacks",
  "offerings",
  "ipos",
  "earnings",
]);

/** The minimal shape of a Benzinga news item the freshness read needs (subset of polygon-news `NewsItem`). */
export interface SwingCatalystNewsItem {
  channels: string[];
  /** Publish timestamp (ISO-ish) as Benzinga returns it. */
  publishedAt: string;
}

/** True when a news item carries at least one real catalyst channel. */
export function isCatalystNewsItem(item: SwingCatalystNewsItem): boolean {
  return item.channels.some((c) => SWING_CATALYST_CHANNELS.has(String(c).toLowerCase().trim()));
}

/**
 * Age (in DAYS) of the freshest in-window catalyst headline, or null when there is none. Only real
 * catalyst-channel items with a parseable, non-future timestamp count; a headline older than the swing
 * catalyst window is not "today's driver" and is ignored. PURE.
 */
export function freshestCatalystAgeDays(
  items: SwingCatalystNewsItem[] | null | undefined,
  nowMs: number,
): number | null {
  if (!Array.isArray(items) || !Number.isFinite(nowMs)) return null;
  let best: number | null = null;
  for (const item of items) {
    if (!item || !isCatalystNewsItem(item)) continue;
    const ms = Date.parse(String(item.publishedAt));
    if (!Number.isFinite(ms)) continue; // no real timestamp → cannot verify freshness → not a catalyst claim
    const ageDays = (nowMs - ms) / 86_400_000;
    if (ageDays < 0 || ageDays > SWING_CATALYST_WINDOW_DAYS) continue;
    if (best == null || ageDays < best) best = ageDays;
  }
  return best;
}

/** A parsed earnings-window read: the NEXT (future) print and the most-recent PAST print, in calendar days
 *  relative to the scan. Either side is null when the earnings feed carries no row for it. */
export interface SwingEarningsWindows {
  /** Next expected earnings: calendar days until the print (≥0), + whether UW confirmed the date. */
  nextEarnings: { daysUntil: number | null; isConfirmed: boolean | null } | null;
  /** Most recent past earnings: calendar days since the print (≥0), + the EPS surprise % if disclosed. */
  lastEarnings: { daysAgo: number | null; surprisePct: number | null } | null;
}

const EARNINGS_DATE_KEYS = ["earnings_date", "report_date", "date", "expected_report_date"];

function ymdOf(row: Record<string, unknown>): string | null {
  for (const k of EARNINGS_DATE_KEYS) {
    const v = row[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
  }
  return null;
}

/** Whole calendar days between two YYYY-MM-DD strings (to − from). Null on unparseable input. */
function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function confirmedOf(row: Record<string, unknown>): boolean | null {
  for (const k of ["is_confirmed", "confirmed", "is_date_confirmed"]) {
    const v = row[k];
    if (typeof v === "boolean") return v;
    if (v === "true" || v === 1) return true;
    if (v === "false" || v === 0) return false;
  }
  return null;
}

/** EPS surprise % from a past-earnings row: prefer a disclosed surprise field, else derive from
 *  actual-vs-estimate. Null when neither is present. */
function surprisePctOf(row: Record<string, unknown>): number | null {
  const direct = row.surprise_pct ?? row.eps_surprise_pct ?? row.surprise;
  if (direct != null && Number.isFinite(Number(direct))) return Number(direct);
  const est = row.street_mean_est ?? row.eps_estimate ?? row.estimate ?? row.estimated_eps;
  const act = row.actual_eps ?? row.eps_actual ?? row.actual ?? row.reported_eps;
  const e = est != null ? Number(est) : null;
  const a = act != null ? Number(act) : null;
  if (e != null && a != null && Number.isFinite(e) && Number.isFinite(a) && e !== 0) {
    return ((a - e) / Math.abs(e)) * 100;
  }
  return null;
}

/**
 * Parse a ticker's earnings rows (the `/api/earnings/{ticker}` feed used by fetchUwTickerEarningsHistory —
 * it carries BOTH the upcoming estimated print and past reports) into the next/last earnings windows,
 * relative to `asOfMs`. PURE. One feed call grounds both the CATALYST hazard (earnings-in-window) and the
 * POST_EARNINGS_DRIFT extras (a recent print), so the shell never needs a second earnings fetch.
 */
export function parseEarningsWindows(
  rows: ReadonlyArray<Record<string, unknown>> | null | undefined,
  asOfMs: number,
): SwingEarningsWindows {
  const empty: SwingEarningsWindows = { nextEarnings: null, lastEarnings: null };
  if (!Array.isArray(rows) || !Number.isFinite(asOfMs)) return empty;
  const todayYmd = new Date(asOfMs).toISOString().slice(0, 10);

  let next: { daysUntil: number; isConfirmed: boolean | null } | null = null;
  let last: { daysAgo: number; surprisePct: number | null } | null = null;

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const date = ymdOf(row as Record<string, unknown>);
    if (!date) continue;
    const delta = daysBetweenYmd(todayYmd, date);
    if (delta == null) continue;
    if (delta >= 0) {
      // Future (or today): keep the SOONEST — that's the next expected print.
      if (next == null || delta < next.daysUntil) {
        next = { daysUntil: delta, isConfirmed: confirmedOf(row as Record<string, unknown>) };
      }
    } else {
      // Past: keep the MOST RECENT (delta closest to 0) — that's the last report.
      const daysAgo = -delta;
      if (last == null || daysAgo < last.daysAgo) {
        last = { daysAgo, surprisePct: surprisePctOf(row as Record<string, unknown>) };
      }
    }
  }
  return { nextEarnings: next, lastEarnings: last };
}

/** The grounded catalyst reads the dossier consumes — the CATALYST pillar input + the event-archetype extras. */
export interface SwingCatalystReads {
  /** CATALYST pillar strength (raw, before the sub-lane earnings-hazard discount). Null when no catalyst. */
  catalystStrength01: number | null;
  /** CATALYST pillar hazard flag — a binary earnings event lands INSIDE the intended holding window. */
  earningsInWindow: boolean;
  /** EVENT_DRIVEN archetype fit input — the same catalyst strength (classification, not hazard-discounted). */
  catalystInWindow01: number | null;
  /** POST_EARNINGS_DRIFT fit input — recency + size of a recent earnings gap. Null outside the drift window. */
  earningsGapRecent01: number | null;
  /** POST_EARNINGS_DRIFT fit input — direction-aligned continuation since the print. Null outside the window. */
  postEarningsDrift01: number | null;
}

const EMPTY_CATALYST_READS: SwingCatalystReads = {
  catalystStrength01: null,
  earningsInWindow: false,
  catalystInWindow01: null,
  earningsGapRecent01: null,
  postEarningsDrift01: null,
};

export interface SwingCatalystDeriveInput {
  /** The DTE the thesis intends to trade — bounds the earnings-in-window hazard + the pre-earnings proximity. */
  intendedDte: number | null;
  /** Direction-signed 10-session return (a down-move is positive for a SHORT) — the post-earnings DRIFT proxy. */
  signedReturnPct10d: number | null;
  /** Age (days) of the freshest in-window Benzinga catalyst headline, or null. From `freshestCatalystAgeDays`. */
  freshCatalystAgeDays: number | null;
  /** The parsed next/last earnings windows (from `parseEarningsWindows`). */
  earnings: SwingEarningsWindows;
}

/**
 * Ground the CATALYST pillar + the event-archetype fit inputs from the fetched catalyst reads. PURE.
 *
 * CATALYST STRENGTH = the STRONGEST present catalyst signal: a fresh Benzinga catalyst headline (recency-
 * weighted), OR a known upcoming earnings inside the holding window (pre-earnings momentum, proximity-weighted
 * and softened when the date is unconfirmed). When neither is present, strength is null (the pillar drops —
 * never a fabricated 0). `catalystInWindow01` mirrors the raw strength so EVENT_DRIVEN classifies on the same
 * evidence; the pillar SCORE additionally discounts it for the earnings-in-window binary hazard (the label is
 * "is this event-driven", the hazard bears on the score, not the classification — kept separate on purpose).
 *
 * POST_EARNINGS_DRIFT extras fire ONLY inside the drift window after a real print: `earningsGapRecent01`
 * blends how recent the print was with the gap SIZE (the disclosed EPS surprise magnitude, else the realized
 * aligned move), and `postEarningsDrift01` is the direction-aligned continuation since the print. Outside the
 * window both are null, so the archetype can't misfire on a stale earnings date.
 */
export function deriveCatalystReads(input: SwingCatalystDeriveInput): SwingCatalystReads {
  const { intendedDte, signedReturnPct10d, freshCatalystAgeDays, earnings } = input;

  // Fresh catalyst headline, recency-weighted (fresher ⇒ stronger).
  const freshNews01 =
    isNum(freshCatalystAgeDays) && freshCatalystAgeDays <= SWING_CATALYST_WINDOW_DAYS
      ? clamp01(1 - freshCatalystAgeDays / SWING_CATALYST_WINDOW_DAYS)
      : null;

  // Upcoming earnings INSIDE the intended holding window = a known catalyst (and, for the pillar, a hazard).
  const daysUntil = earnings.nextEarnings?.daysUntil ?? null;
  const earningsInWindow =
    isNum(daysUntil) && isNum(intendedDte) && daysUntil >= 0 && daysUntil <= intendedDte;
  const preEarnings01 =
    earningsInWindow && isNum(daysUntil) && isNum(intendedDte)
      ? clamp01(1 - daysUntil / (intendedDte + 1)) *
        (earnings.nextEarnings?.isConfirmed === false ? EARNINGS_UNCONFIRMED_WEIGHT : 1)
      : null;

  const catalystParts = [freshNews01, preEarnings01].filter(isNum);
  const catalystStrength01 = catalystParts.length ? Math.max(...catalystParts) : null;

  // Post-earnings drift: only meaningful inside the drift window after a real, recent print.
  const daysAgo = earnings.lastEarnings?.daysAgo ?? null;
  const inDriftWindow = isNum(daysAgo) && daysAgo >= 0 && daysAgo <= POST_EARNINGS_DRIFT_WINDOW_DAYS;
  let earningsGapRecent01: number | null = null;
  let postEarningsDrift01: number | null = null;
  if (inDriftWindow && isNum(daysAgo)) {
    const recency01 = clamp01(1 - daysAgo / POST_EARNINGS_DRIFT_WINDOW_DAYS);
    const surprisePct = earnings.lastEarnings?.surprisePct ?? null;
    // Gap SIZE: prefer the disclosed EPS surprise magnitude, else the realized aligned-move magnitude.
    const sizeProxy01 = isNum(surprisePct)
      ? clamp01(Math.abs(surprisePct) / EARNINGS_SURPRISE_SATURATION_PCT)
      : isNum(signedReturnPct10d)
        ? clamp01(Math.abs(signedReturnPct10d) / POST_EARNINGS_DRIFT_SATURATION_PCT)
        : null;
    earningsGapRecent01 = sizeProxy01 != null ? (recency01 + sizeProxy01) / 2 : recency01;
    // Drift = direction-aligned continuation since the print (only continuation IN the trade direction counts).
    postEarningsDrift01 = isNum(signedReturnPct10d)
      ? clamp01(signedReturnPct10d / POST_EARNINGS_DRIFT_SATURATION_PCT)
      : null;
  }

  return {
    catalystStrength01,
    earningsInWindow,
    catalystInWindow01: catalystStrength01,
    earningsGapRecent01,
    postEarningsDrift01,
  };
}

/** Convenience: the empty (all-absent) catalyst reads — used when no catalyst context was fetched. */
export function emptyCatalystReads(): SwingCatalystReads {
  return { ...EMPTY_CATALYST_READS };
}

/**
 * VOLATILITY pillar contract-quality from the UW EOD IV rank. PURE.
 *
 * The swing lane trades 0.50–0.75Δ LONG premium (debit calls/puts — taxonomy sub-lanes), so contract quality
 * is INVERSE to IV rank: a LOW IV rank means cheap premium + less vega/theta bleed to fight (high quality); a
 * HIGH IV rank means expensive, decay-heavy premium (low quality). Returns null when no IV rank is available
 * (the pillar drops — never a fabricated 0). `iv_rank` is normalized whether UW returns a 0–100 rank or a
 * 0–1 fraction.
 */
export function contractQualityFromIvRank(ivRank: number | null | undefined): number | null {
  if (!isNum(ivRank)) return null;
  const rank01 = ivRank > 1 ? ivRank / 100 : ivRank; // tolerate a 0–100 rank OR an already-0–1 fraction
  return clamp01(1 - clamp01(rank01));
}
