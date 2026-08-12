/** Client-safe types/constants for the public GEX snapshot lead magnet. */

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
