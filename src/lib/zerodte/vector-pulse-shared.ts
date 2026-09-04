/**
 * Pure Vector pulse types + direction lookup — no server-only, safe for unit tests.
 */

export type ZeroDteVectorPulse = {
  /** Best live premium % from entry across this ticker's leaders today. */
  premium_pct: number | null;
  peak_premium_pct: number | null;
  action_status: string | null;
  /** Tagged +50% live or peak — Vector winner floor. */
  is_winner: boolean;
  /** +15%…+49% building band. */
  is_runner: boolean;
  /** Best leader contract side (call/put). */
  side: "call" | "put" | null;
  /** Desk direction implied by side. */
  direction: "long" | "short" | null;
  strike: number | null;
  occ: string | null;
  rank: number | null;
  role: string | null;
};

/** Per-ticker pulses keyed by desk direction — avoids picking a winning PUT when 0DTE wants LONG. */
export type ZeroDteVectorPulseByTicker = Record<
  string,
  Partial<Record<"long" | "short", ZeroDteVectorPulse>>
>;

/** Resolve direction-specific pulse; falls back to legacy flat map shape. */
export function vectorPulseForDirection(
  map: ZeroDteVectorPulseByTicker | Record<string, ZeroDteVectorPulse>,
  ticker: string,
  direction: "long" | "short"
): ZeroDteVectorPulse | null {
  const tk = ticker.trim().toUpperCase();
  const entry = map[tk];
  if (!entry) return null;
  if ("long" in entry || "short" in entry) {
    return (entry as Partial<Record<"long" | "short", ZeroDteVectorPulse>>)[direction] ?? null;
  }
  const legacy = entry as ZeroDteVectorPulse;
  if (legacy.direction && legacy.direction !== direction) return null;
  return legacy;
}
