/**
 * MARKET EVIDENCE — canonical validation/normalization before synthesis and envelope build.
 *
 * THE FAILURE THIS FIXES (measured live 2026-08-11, NVDA options-play question):
 *  - Headline cited Night Hawk edition LONG; system reads said "no plays" (zerodte board only).
 *  - Aug 24 / Dec 17 flow called "0DTE" on Aug 11.
 *  - Put wall cited as 212.5 (a flow strike) while Vector put wall was 190.
 *  - "EMA stack DOWN" with spot above EMA20 > EMA50 > EMA200 (bullish stack by definition).
 *  - Spot ranged 216.65–223.52 (3.17% apart) yet precise entry/stop/targets were given.
 *
 * ONE canonical object is built from tool results; the envelope and integrity gates consume it
 * so headline, system reads, levels, and caveats cannot disagree.
 *
 * PURE AND TOTAL: no IO, no throw. Callers pass `nowMs` and session date.
 */

import { canonicalSession, canonicalTicker, parseOccSymbol } from "./entities";
import { collectReadings, findSourceConflicts, type SourceConflict } from "./cross-source";

/** Typed price entities — never interchange strikes, walls, and flow levels. */
export type LevelEntityType =
  | "FLOW_STRIKE"
  | "CALL_WALL"
  | "PUT_WALL"
  | "GAMMA_FLIP"
  | "GAMMA_MAGNET"
  | "VWAP"
  | "OPTION_STRIKE"
  | "SPOT"
  | "TARGET"
  | "INVALIDATION";

export type OptionHorizon = "0DTE" | "1DTE" | "SWING" | "LEAP" | "UNKNOWN";

export type TypedLevel = {
  type: LevelEntityType;
  price: number;
  label: string;
  source: string;
  ticker?: string;
  expiry?: string;
  horizon?: OptionHorizon;
};

export type NightHawkPlayRef = {
  ticker: string;
  direction: string;
  status?: string | null;
  strike?: number | null;
  expiry?: string | null;
  entryPremium?: number | null;
  conviction?: string | null;
  /** Which Night Hawk surface this came from. */
  product: "edition" | "zerodte" | "swing";
};

export type NightHawkState = {
  edition: NightHawkPlayRef[];
  zerodte: NightHawkPlayRef[];
  swing: NightHawkPlayRef[];
  /** Merged view for the requested ticker — edition picks win over empty zerodte. */
  forTicker: NightHawkPlayRef[];
  consulted: { edition: boolean; zerodte: boolean; swing: boolean };
};

export type TechnicalRead = {
  spot: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  vwap: number | null;
  /** Vector/polygon-largo definition: price vs EMA20 vs EMA50. */
  trendStack: "bullish" | "bearish" | "mixed" | "unknown";
  source: string;
};

export type FlowContractRef = {
  ticker: string;
  strike: number;
  expiry: string;
  right: "C" | "P";
  premium: number;
  horizon: OptionHorizon;
  source: string;
};

export type SpotConsensus = {
  ticker: string;
  authoritative: number | null;
  conflict: SourceConflict | null;
  preciseRecommendationsBlocked: boolean;
};

export type MarketEvidenceIssue = {
  code:
    | "spot_disagreement"
    | "nighthawk_product_split"
    | "horizon_mislabel"
    | "entity_type_confusion"
    | "technical_mismatch"
    | "stale_recommendation";
  severity: "block" | "warn";
  message: string;
};

export type MarketEvidence = {
  ticker: string | null;
  sessionDate: string;
  asOfMs: number;
  spot: SpotConsensus | null;
  levels: TypedLevel[];
  nightHawk: NightHawkState | null;
  technicals: TechnicalRead | null;
  flowContracts: FlowContractRef[];
  walls: {
    callWall: number | null;
    putWall: number | null;
    gammaFlip: number | null;
    gammaMagnet: number | null;
    vwap: number | null;
  };
  issues: MarketEvidenceIssue[];
  preciseRecommendationsBlocked: boolean;
};

/** Material spot spread above which precise trade levels must not be stated. */
export const PRECISE_REC_BLOCK_SPREAD_PCT = 1.0;

/** Default conflict detection tolerance (intra-turn drift). */
export const SPOT_CONFLICT_TOLERANCE_PCT = 0.5;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Classify an option expiry relative to a session calendar date.
 *
 * 0DTE = same session day; 1DTE = next session day; SWING ≤14d; else LEAP.
 */
export function classifyOptionHorizon(expiry: string | null | undefined, sessionDate: string): OptionHorizon {
  const exp = canonicalSession(expiry);
  const sess = canonicalSession(sessionDate);
  if (!exp || !sess) return "UNKNOWN";
  const days = Math.round((Date.parse(`${exp}T12:00:00Z`) - Date.parse(`${sess}T12:00:00Z`)) / 86_400_000);
  if (days <= 0) return "0DTE";
  if (days === 1) return "1DTE";
  if (days <= 14) return "SWING";
  return "LEAP";
}

/**
 * Vector/polygon-largo trend stack — price vs EMA20 vs EMA50 only.
 * EMA200 is carried for display but does not define the stack label.
 */
export function computeTrendStack(
  spot: number | null,
  ema20: number | null,
  ema50: number | null
): TechnicalRead["trendStack"] {
  if (spot == null || ema20 == null || ema50 == null) return "unknown";
  if (spot > ema20 && ema20 > ema50) return "bullish";
  if (spot < ema20 && ema20 < ema50) return "bearish";
  return "mixed";
}

function parseStrikeFromOptionsPlay(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:call|put|c|p)\b/i.exec(text);
  return m ? num(Number(m[1])) : null;
}

function parseExpiryFromOptionsPlay(text: string | null | undefined): string | null {
  if (!text) return null;
  // "Aug 12" or "8/12" style in options_play prose
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso) return iso[1]!;
  const us = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
  if (us) {
    const year = us[3] ? (us[3].length === 2 ? `20${us[3]}` : us[3]) : String(new Date().getFullYear());
    return `${year}-${String(Number(us[1])).padStart(2, "0")}-${String(Number(us[2])).padStart(2, "0")}`;
  }
  return null;
}

/** Night Hawk Legacy evening edition — `{ available, edition_for, plays[] }`. */
function findEditionPayload(results: readonly unknown[]): Record<string, unknown> | null {
  for (const r of results) {
    if (!isRecord(r)) continue;
    if (!Array.isArray(r.plays)) continue;
    if ("edition_for" in r || "recap_headline" in r || "published_at" in r) return r;
  }
  return null;
}

/** 0DTE Command board — `{ plays, fresh_finds }` without edition fields. */
function findZerodtePayload(results: readonly unknown[]): Record<string, unknown> | null {
  for (const r of results) {
    if (!isRecord(r)) continue;
    if ("fresh_finds" in r || "scan_meta" in r) return r;
    if (Array.isArray(r.plays) && !("edition_for" in r) && !("recap_headline" in r)) {
      // Could be zerodte or swing — prefer fresh_finds discriminator above
      if (Array.isArray(r.plays) && r.plays.some((p) => isRecord(p) && "live_pnl_pct" in p)) return r;
    }
  }
  return null;
}

/** Swing lane — `{ sample_plays, committed_count, horizon }`. */
function findSwingPayload(results: readonly unknown[]): Record<string, unknown> | null {
  for (const r of results) {
    if (!isRecord(r)) continue;
    if (Array.isArray(r.sample_plays) && ("committed_count" in r || "horizon" in r)) return r;
  }
  return null;
}

function playsFromEdition(edition: Record<string, unknown>): NightHawkPlayRef[] {
  const rows = edition.plays;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(isRecord)
    .map((p) => ({
      ticker: String(p.ticker ?? "").toUpperCase(),
      direction: String(p.direction ?? ""),
      status: str(p.status),
      strike: parseStrikeFromOptionsPlay(str(p.options_play)),
      expiry: parseExpiryFromOptionsPlay(str(p.options_play)),
      entryPremium: num(p.entry_premium),
      conviction: str(p.conviction),
      product: "edition" as const,
    }))
    .filter((p) => p.ticker);
}

function playsFromZerodte(board: Record<string, unknown>, ticker: string): NightHawkPlayRef[] {
  const want = ticker.toUpperCase();
  const rows = board.plays;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(isRecord)
    .filter((p) => String(p.ticker ?? "").toUpperCase() === want)
    .map((p) => ({
      ticker: want,
      direction: String(p.direction ?? ""),
      status: str(p.status),
      strike: num(p.strike),
      expiry: str(p.expiry),
      entryPremium: num(p.entry_premium),
      conviction: null,
      product: "zerodte" as const,
    }));
}

function playsFromSwing(lane: Record<string, unknown>, ticker: string): NightHawkPlayRef[] {
  const want = ticker.toUpperCase();
  const rows = lane.sample_plays ?? lane.committed;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(isRecord)
    .filter((p) => String(p.ticker ?? "").toUpperCase() === want)
    .map((p) => ({
      ticker: want,
      direction: String(p.direction ?? ""),
      status: str(p.status),
      strike: num(p.strike),
      expiry: str(p.expiry),
      entryPremium: null,
      conviction: null,
      product: "swing" as const,
    }));
}

export function extractNightHawkState(results: readonly unknown[], ticker: string | null): NightHawkState | null {
  const edition = findEditionPayload(results);
  const zerodte = findZerodtePayload(results);
  const swing = findSwingPayload(results);
  if (!edition && !zerodte && !swing) return null;

  const editionPlays = edition ? playsFromEdition(edition) : [];
  const zerodtePlays = zerodte && ticker ? playsFromZerodte(zerodte, ticker) : [];
  const swingPlays = swing && ticker ? playsFromSwing(swing, ticker) : [];

  const want = ticker?.toUpperCase() ?? null;
  const editionForTicker = want ? editionPlays.filter((p) => p.ticker === want) : editionPlays;
  const forTicker =
    editionForTicker.length > 0
      ? editionForTicker
      : zerodtePlays.length > 0
        ? zerodtePlays
        : swingPlays;

  return {
    edition: editionPlays,
    zerodte: zerodtePlays,
    swing: swingPlays,
    forTicker,
    consulted: {
      edition: edition != null,
      zerodte: zerodte != null,
      swing: swing != null,
    },
  };
}

function findPositioning(results: readonly unknown[]): Record<string, unknown> | null {
  for (const r of results) {
    if (!isRecord(r)) continue;
    if ("gamma_posture" in r) return r;
    if ("call_wall" in r && "put_wall" in r) return r;
  }
  return null;
}

function findTechnicals(results: readonly unknown[]): TechnicalRead | null {
  let best: TechnicalRead | null = null;
  for (const r of results) {
    if (!isRecord(r)) continue;
    const emasRaw = isRecord(r.emas)
      ? r.emas
      : isRecord(r.technicals)
        ? (r.technicals as Record<string, unknown>).emas
        : null;
    const emas = isRecord(emasRaw) ? emasRaw : null;
    const ema20 = num(emas?.ema20 ?? r.ema20);
    const ema50 = num(emas?.ema50 ?? r.ema50);
    const ema200 = num(emas?.ema200 ?? r.ema200);
    const spot = num(r.spot ?? r.price);
    const trendStackRaw = str(r.trend_stack);
    const trendStack =
      trendStackRaw === "bullish" || trendStackRaw === "bearish" || trendStackRaw === "mixed"
        ? trendStackRaw
        : computeTrendStack(spot, ema20, ema50);
    const rsiObj = isRecord(r.rsi) ? r.rsi : null;
    const rsi = num(rsiObj?.daily ?? r.rsi14 ?? r.rsi);
    const vwap = num(r.vwap ?? (isRecord(r.technicals) ? (r.technicals as Record<string, unknown>).vwap : null));
    if (spot == null && ema20 == null && trendStackRaw == null) continue;

    const row: TechnicalRead = {
      spot,
      ema20,
      ema50,
      ema200,
      rsi,
      vwap,
      trendStack,
      source: "tool",
    };
    // Prefer the payload that actually carries EMAs / trend_stack over a bare spot quote.
    if (!best || (ema20 != null && best.ema20 == null) || trendStackRaw != null) {
      best = row;
    }
  }
  return best;
}

function extractFlowContracts(
  results: readonly unknown[],
  ticker: string | null,
  sessionDate: string
): FlowContractRef[] {
  const out: FlowContractRef[] = [];
  const want = ticker?.toUpperCase() ?? null;

  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 5) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 80)) walk(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const t = canonicalTicker(str(obj.ticker ?? obj.symbol))?.key ?? null;
    const strike = num(obj.strike);
    const premium = num(obj.premium);
    const expiry = str(obj.expiry);
    const occ = parseOccSymbol(str(obj.symbol ?? obj.contract));
    if (premium != null && premium > 0 && (strike != null || occ)) {
      const tk = t ?? occ?.ticker ?? null;
      if (!want || tk === want) {
        out.push({
          ticker: tk ?? want ?? "?",
          strike: strike ?? occ!.strike,
          expiry: expiry ?? occ!.expiry,
          right: String(obj.option_type ?? occ?.right ?? "C")
            .toUpperCase()
            .startsWith("P")
            ? "P"
            : "C",
          premium,
          horizon: classifyOptionHorizon(expiry ?? occ?.expiry, sessionDate),
          source: "flow",
        });
      }
    }
    for (const v of Object.values(obj)) walk(v, depth + 1);
  };

  for (const r of results) walk(r, 0);
  return out.slice(0, 40);
}

function buildTypedLevels(
  positioning: Record<string, unknown> | null,
  technicals: TechnicalRead | null,
  spotConsensus: SpotConsensus | null
): TypedLevel[] {
  const levels: TypedLevel[] = [];
  const push = (type: LevelEntityType, price: unknown, label: string, source: string) => {
    const p = num(price);
    if (p != null && p > 0) levels.push({ type, price: p, label, source });
  };

  if (positioning) {
    push("CALL_WALL", positioning.call_wall, "Call wall", "Vector");
    push("PUT_WALL", positioning.put_wall, "Put wall", "Vector");
    push("GAMMA_FLIP", positioning.flip ?? positioning.gamma_flip, "Gamma flip", "Vector");
    push("GAMMA_MAGNET", positioning.magnet ?? positioning.gamma_magnet, "Gamma magnet", "Vector");
  }
  if (technicals?.vwap != null) {
    levels.push({ type: "VWAP", price: technicals.vwap, label: "VWAP", source: "Vector" });
  }
  if (spotConsensus?.authoritative != null) {
    levels.push({
      type: "SPOT",
      price: spotConsensus.authoritative,
      label: "Spot",
      source: spotConsensus.conflict ? "consensus" : "Polygon",
    });
  }
  return levels;
}

export function buildSpotConsensus(
  results: readonly unknown[],
  ticker: string | null,
  tolerancePct = SPOT_CONFLICT_TOLERANCE_PCT
): SpotConsensus | null {
  if (!ticker) return null;
  const conflicts = findSourceConflicts(results, tolerancePct);
  const conflict = conflicts.find((c) => c.ticker === canonicalTicker(ticker)?.key) ?? null;
  const readings = collectReadings(results).filter((r) => r.ticker === canonicalTicker(ticker)?.key);
  const authoritative =
    conflict == null && readings.length
      ? readings[readings.length - 1]!.value
      : conflict
        ? (conflict.min + conflict.max) / 2
        : readings[0]?.value ?? null;

  const spreadPct = conflict?.spreadPct ?? null;
  const preciseRecommendationsBlocked =
    spreadPct != null && spreadPct >= PRECISE_REC_BLOCK_SPREAD_PCT;

  return {
    ticker: canonicalTicker(ticker)!.key,
    authoritative,
    conflict,
    preciseRecommendationsBlocked,
  };
}

/** Validate prose claims against canonical evidence — post-synthesis integrity gate. */
export function validateProseAgainstEvidence(
  prose: string,
  evidence: MarketEvidence
): MarketEvidenceIssue[] {
  const issues: MarketEvidenceIssue[] = [];
  const lower = prose.toLowerCase();

  if (evidence.preciseRecommendationsBlocked) {
    issues.push({
      code: "spot_disagreement",
      severity: "block",
      message:
        `Sources disagree on ${evidence.spot?.ticker} spot by ${evidence.spot?.conflict?.spreadPct.toFixed(2)}% — ` +
        `do not state precise entry, stop, or targets until prices reconcile.`,
    });
  }

  // Night Hawk product split: edition pick exists but prose/system would show zerodte-only empty
  if (evidence.nightHawk) {
    const { edition, zerodte, forTicker } = evidence.nightHawk;
    if (forTicker.some((p) => p.product === "edition") && zerodte.length === 0 && edition.length > 0) {
      if (/\bno plays\b/i.test(lower) && /\bnight hawk\b/i.test(lower)) {
        issues.push({
          code: "nighthawk_product_split",
          severity: "warn",
          message:
            "Night Hawk evening edition has picks; 0DTE Command board may show none for this name (covered elsewhere). Do not report 'no plays' without naming which product.",
        });
      }
    }
  }

  // Horizon mislabel: "0DTE" near a non-0DTE expiry mentioned in prose
  for (const fc of evidence.flowContracts) {
    if (fc.horizon === "0DTE") continue;
    const monthDay = fc.expiry.slice(5); // MM-DD
    const [mm, dd] = monthDay.split("-");
    const augStyle = `${Number(mm)}/${Number(dd)}`;
    const monthAbbrevs = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const verbalDate =
      monthAbbrevs[Number(mm) - 1] != null ? `${monthAbbrevs[Number(mm) - 1]!} ${Number(dd)}` : null;
    const mentionsExpiry =
      lower.includes(fc.expiry) ||
      lower.includes(monthDay.toLowerCase()) ||
      lower.includes(augStyle) ||
      (verbalDate != null && lower.includes(verbalDate)) ||
      (lower.includes(String(fc.strike)) && lower.includes(String(Number(dd))));
    if ((lower.includes("0dte") || lower.includes("0-dte")) && mentionsExpiry) {
      issues.push({
        code: "horizon_mislabel",
        severity: "warn",
        message: `${fc.ticker} ${fc.strike} ${fc.expiry} is ${fc.horizon}, not 0DTE on ${evidence.sessionDate}.`,
      });
    }
  }

  // Entity confusion: prose cites "put wall" at a flow strike price (not dealer put wall)
  const putWall = evidence.walls.putWall;
  if (putWall != null) {
    for (const m of prose.matchAll(/\bput wall\b[^.\n]{0,80}?\$?(\d[\d,]*(?:\.\d+)?)/gi)) {
      const cited = Number.parseFloat(String(m[1]).replace(/,/g, ""));
      if (!Number.isFinite(cited)) continue;
      if (Math.abs(cited - putWall) <= 0.01) continue;
      const flowPutAtCited = evidence.flowContracts.some(
        (fc) => fc.right === "P" && Math.abs(fc.strike - cited) <= 0.01
      );
      if (flowPutAtCited) {
        issues.push({
          code: "entity_type_confusion",
          severity: "warn",
          message: `Put wall is ${putWall} (dealer gamma), not ${cited} (flow strike). Do not interchange FLOW_STRIKE and PUT_WALL.`,
        });
        break;
      }
    }
  }

  // Technical mismatch: "EMA stack down" vs computed bullish
  const tech = evidence.technicals;
  if (tech?.trendStack === "bullish" && /\bema stack down\b/i.test(lower)) {
    issues.push({
      code: "technical_mismatch",
      severity: "warn",
      message: `EMA stack is bullish (spot ${tech.spot} > EMA20 ${tech.ema20} > EMA50 ${tech.ema50}), not bearish.`,
    });
  }
  if (tech?.trendStack === "bearish" && /\bema stack up\b/i.test(lower)) {
    issues.push({
      code: "technical_mismatch",
      severity: "warn",
      message: `EMA stack is bearish (spot below declining EMAs), not bullish.`,
    });
  }

  return issues;
}

/**
 * Build canonical market evidence from a turn's tool results.
 */
export function buildMarketEvidence(
  capturedResults: readonly unknown[] | null | undefined,
  ticker: string | null,
  sessionDate: string,
  nowMs: number
): MarketEvidence | null {
  const results = capturedResults ?? [];
  if (!results.length) return null;

  const positioning = findPositioning(results);
  const technicals = findTechnicals(results);
  const spot = ticker ? buildSpotConsensus(results, ticker) : null;
  const nightHawk = extractNightHawkState(results, ticker);
  const flowContracts = extractFlowContracts(results, ticker, sessionDate);

  const walls = {
    callWall: num(positioning?.call_wall),
    putWall: num(positioning?.put_wall),
    gammaFlip: num(positioning?.flip ?? positioning?.gamma_flip),
    gammaMagnet: num(positioning?.magnet ?? positioning?.gamma_magnet),
    vwap: technicals?.vwap ?? null,
  };

  const levels = buildTypedLevels(positioning, technicals, spot);
  for (const fc of flowContracts.slice(0, 8)) {
    levels.push({
      type: "FLOW_STRIKE",
      price: fc.strike,
      label: `${fc.ticker} ${fc.strike}${fc.right} flow`,
      source: "UW",
      ticker: fc.ticker,
      expiry: fc.expiry,
      horizon: fc.horizon,
    });
  }

  const issues: MarketEvidenceIssue[] = [];
  if (spot?.preciseRecommendationsBlocked && spot.conflict) {
    issues.push({
      code: "spot_disagreement",
      severity: "block",
      message: `${spot.ticker} spot ranges ${spot.conflict.min}–${spot.conflict.max} (${spot.conflict.spreadPct.toFixed(2)}% apart) across sources.`,
    });
  }
  if (nightHawk && nightHawk.edition.length > 0 && nightHawk.zerodte.length === 0 && nightHawk.forTicker.length > 0) {
    issues.push({
      code: "nighthawk_product_split",
      severity: "warn",
      message:
        "Night Hawk evening edition picks and 0DTE Command open plays are different products — reconcile before stating 'no plays'.",
    });
  }

  return {
    ticker: ticker ? canonicalTicker(ticker)?.key ?? ticker.toUpperCase() : null,
    sessionDate,
    asOfMs: nowMs,
    spot,
    levels,
    nightHawk,
    technicals,
    flowContracts,
    walls,
    issues,
    preciseRecommendationsBlocked: spot?.preciseRecommendationsBlocked ?? false,
  };
}

/** Merge post-synthesis prose checks into evidence issues (deduped by code). */
export function mergeEvidenceIssues(
  evidence: MarketEvidence,
  prose: string
): MarketEvidence {
  const extra = validateProseAgainstEvidence(prose, evidence);
  const seen = new Set(evidence.issues.map((i) => i.code));
  const merged = [...evidence.issues];
  for (const i of extra) {
    if (!seen.has(i.code)) {
      merged.push(i);
      seen.add(i.code);
    }
  }
  return {
    ...evidence,
    issues: merged,
    preciseRecommendationsBlocked:
      evidence.preciseRecommendationsBlocked || merged.some((i) => i.code === "spot_disagreement" && i.severity === "block"),
  };
}

const OPEN_BOARD_STATUS = /^(OPEN|HOLD|TRIM)$/i;

/** 0DTE Command board state for one ticker — consulted vs committed. */
export type ZerodteBoardState = {
  consulted: boolean;
  /** Ledger play on the 0DTE board (OPEN/HOLD/TRIM — not WATCH fresh finds). */
  hasOpenPlay: boolean;
  openPlays: NightHawkPlayRef[];
  hasEditionPlay: boolean;
};

/** Whether the 0DTE Command board was read and whether this ticker has a committed play. */
export function assessZerodteBoardState(evidence: MarketEvidence): ZerodteBoardState {
  const nh = evidence.nightHawk;
  const ticker = evidence.ticker?.toUpperCase() ?? null;
  if (!nh) {
    return { consulted: false, hasOpenPlay: false, openPlays: [], hasEditionPlay: false };
  }
  const openPlays = nh.zerodte.filter(
    (p) => !p.status || OPEN_BOARD_STATUS.test(String(p.status))
  );
  const hasEditionPlay =
    ticker != null && nh.edition.some((p) => p.ticker === ticker);
  return {
    consulted: nh.consulted.zerodte,
    hasOpenPlay: openPlays.length > 0,
    openPlays,
    hasEditionPlay,
  };
}

/** Whether an evening-edition pick is a fresh entry or an existing thesis needing confirmation. */
export function assessEditionActionability(evidence: MarketEvidence): {
  freshEntry: boolean;
  existingThesis: boolean;
  contractLabel: string;
  originalEntry: number | null;
  note: string;
} | null {
  const nh = evidence.nightHawk?.forTicker.find((p) => p.product === "edition");
  if (!nh) return null;

  const spot = evidence.spot?.authoritative;
  const spotForStructure = evidence.spot?.conflict?.min ?? spot;
  const vwap = evidence.walls.vwap;
  const flip = evidence.walls.gammaFlip;
  const belowStructure =
    spotForStructure != null &&
    ((vwap != null && spotForStructure < vwap) || (flip != null && spotForStructure < flip));

  const strike = nh.strike;
  const expiry = nh.expiry;
  const right = /long|call/i.test(nh.direction) ? "C" : "P";
  const contractLabel =
    strike != null && expiry
      ? `${expiry} $${strike}${right}`
      : nh.direction;

  const freshEntry = !belowStructure && !evidence.preciseRecommendationsBlocked;

  return {
    freshEntry,
    existingThesis: !freshEntry,
    contractLabel,
    originalEntry: nh.entryPremium ?? null,
    note: belowStructure
      ? "Do not chase the original entry unless the current contract price and trigger remain valid."
      : "Revalidate current contract mark and spread before entry.",
  };
}

/**
 * Fail-closed caveat when spot sources disagree materially — replaces weak footnote behavior.
 */
export function applyEvidenceIntegrityCaveat(text: string, evidence: MarketEvidence): string {
  const blocks = evidence.issues.filter((i) => i.severity === "block");
  if (blocks.length === 0 && !evidence.preciseRecommendationsBlocked) return text;

  const spot = evidence.spot?.conflict;
  const head =
    spot != null
      ? `> **Data integrity hold.** ${evidence.ticker} spot readings range ${spot.min} to ${spot.max} (${spot.spreadPct.toFixed(2)}% apart). ` +
        `Precise entry, stop, and target levels are withheld until sources reconcile. Treat directional bias as approximate only.`
      : `> **Data integrity hold.** ${blocks.map((b) => b.message).join(" ")}`;

  if (text.includes("Data integrity hold")) return text;
  return `${text}\n\n${head}`;
}

/**
 * Convert canonical typed levels to BieLevel[] for the envelope.
 */
export function evidenceLevelsForEnvelope(
  evidence: MarketEvidence
): { label: string; price: number; note?: string }[] {
  const ORDER: LevelEntityType[] = [
    "SPOT",
    "VWAP",
    "GAMMA_FLIP",
    "GAMMA_MAGNET",
    "CALL_WALL",
    "PUT_WALL",
  ];
  const out: { label: string; price: number; note?: string }[] = [];
  for (const type of ORDER) {
    const row = evidence.levels.find((l) => l.type === type);
    if (row) out.push({ label: row.label, price: row.price, note: row.source });
  }
  return out;
}
