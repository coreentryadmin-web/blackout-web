/**
 * Swing regime banding for G-S4 (regime blind) and funnel metrics.
 *
 * Uses the dossier REGIME pillar (0–1, direction-aligned SPY trend proxy). Degraded bands block COMMIT
 * when G-S4 is enforced — candidates stay on the WATCH rail per design §G-S4.
 */

/** Bucket a normalized (0–1) regime read into a named band; null/absent → UNKNOWN. */
export function regimeBandFor01(regime01: number | null | undefined): string {
  if (regime01 == null || !Number.isFinite(regime01)) return "UNKNOWN";
  if (regime01 >= 0.66) return "RISK_ON";
  if (regime01 >= 0.34) return "NEUTRAL";
  return "RISK_OFF";
}

/** True when broad-market regime is too degraded (or unknown) to authorize a new COMMIT. */
export function isRegimeDegradedForCommit(regime01: number | null | undefined): boolean {
  const band = regimeBandFor01(regime01);
  return band === "RISK_OFF" || band === "UNKNOWN";
}
