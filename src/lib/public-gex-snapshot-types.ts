/** Client-safe types/constants for the public GEX snapshot lead magnet. */

export type PublicWallRole = "support" | "resistance" | "concentration";

export type PublicGexSnapshot = {
  available: boolean;
  ticker: string;
  spot: number | null;
  change_pct: number | null;
  asof: string | null;
  call_wall: number | null;
  put_wall: number | null;
  flip: number | null;
  posture: "long" | "short" | null;
  /** What each wall can honestly be called given spot — see classifyWall. Null when unknowable. */
  call_wall_role: PublicWallRole | null;
  put_wall_role: PublicWallRole | null;
  read: string;
};

const ALLOWED_TICKERS = ["SPX", "SPY", "QQQ"] as const;
export type PublicGexTicker = (typeof ALLOWED_TICKERS)[number];

export function isPublicGexTicker(value: string): value is PublicGexTicker {
  return (ALLOWED_TICKERS as readonly string[]).includes(value);
}

export function publicGexTickers(): readonly PublicGexTicker[] {
  return ALLOWED_TICKERS;
}

/** Strip vendor/infra provenance before the read string leaves the server. */
export function sanitizePublicRead(read: string): string {
  return read
    .replace(/\s*\([^()]*\b(?:UW|Unusual\s*Whales|Polygon|Massive)\b[^()]*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Which claim a wall can honestly support, given where price actually is.
 *
 * `computeGexWalls` splits strikes by the SIGN of net dealer gamma and takes no spot argument, so
 * "put wall" means "most negative dealer gamma" — which can legitimately land ABOVE spot (live
 * 2026-08-12: SPX spot 7748.5, put wall 8000, most likely an 8/21 OpEx line). The NUMBER is right.
 * Calling it "support" is what's wrong: a reader on a chart at 7748 is told their support sits 250
 * points overhead, which is incoherent as a level and the one reading a trader must never be handed.
 *
 * Same defect and same remedy as the Thermal Key Levels tile (#2115) — fix the LABEL, never the
 * wall definition, so the ~150 consumers of `computeGexWalls` keep the exact numbers they have.
 * Applied symmetrically: a call wall BELOW spot is equally incoherent as "resistance".
 */
export function classifyWall(
  kind: "call" | "put",
  wall: number | null,
  spot: number | null
): PublicWallRole | null {
  // Degrade to no claim rather than guessing a side — a null or zero spot cannot order anything.
  if (wall == null || spot == null || !Number.isFinite(wall) || !Number.isFinite(spot) || spot <= 0) {
    return null;
  }
  if (kind === "call") return wall > spot ? "resistance" : "concentration";
  return wall < spot ? "support" : "concentration";
}

/**
 * Rewrite the regime narration's trailing "Resistance X, support Y." clause so it never asserts a
 * level that sits on the wrong side of price.
 *
 * Targeted at the clause rather than the whole sentence: everything before it (spot vs flip, the
 * long/short-gamma explanation) is already true and is what makes the snapshot useful. Only the
 * directional claim can be false. A wall on the wrong side is dropped rather than relabelled inline,
 * because "resistance 7800, concentration 8000" would read as a level too — the tile carries the
 * honest wording, and the prose simply stops asserting what it cannot support.
 *
 * If the producer's wording changes and the clause no longer matches, the read passes through
 * untouched: this can only ever remove a false claim, never invent one.
 */
export function correctPublicRead(
  read: string,
  levels: { spot: number | null; call_wall: number | null; put_wall: number | null }
): string {
  const clause = /\s*Resistance\s+[\d,.]+\s*,\s*support\s+[\d,.]+\s*\./i;
  if (!clause.test(read)) return read;

  const callRole = classifyWall("call", levels.call_wall, levels.spot);
  const putRole = classifyWall("put", levels.put_wall, levels.spot);
  const fmt = (n: number) => n.toLocaleString("en-US");

  const parts: string[] = [];
  if (callRole === "resistance" && levels.call_wall != null) parts.push(`Resistance ${fmt(levels.call_wall)}`);
  if (putRole === "support" && levels.put_wall != null) parts.push(`support ${fmt(levels.put_wall)}`);

  const replacement = parts.length
    ? ` ${parts.join(", ")}.`
    : // Both walls sit on the wrong side: say so plainly rather than leaving a bare sentence, so the
      // absence reads as a deliberate statement about the book and not as missing data.
      " Both gamma walls currently sit on the far side of spot, so neither is acting as a level.";

  return read.replace(clause, replacement).replace(/\s{2,}/g, " ").trim();
}
