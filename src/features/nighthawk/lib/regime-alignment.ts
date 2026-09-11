export type RegimeAlignmentTone = "up" | "warn" | "muted";
export type RegimeAlignmentNote = { label: string; tone: RegimeAlignmentTone };

/**
 * A Legacy pick is a next-day digest — it can sit 12-16+ hours between its ~7pm ET evening
 * publish and the next morning's open, and the broad market regime can genuinely flip overnight.
 * `play.regime` (captured at publish time) and the board's own live `macro.regime` both already
 * exist, but nothing compared them — a member had to mentally diff two separately-rendered
 * strings in different parts of the UI to notice a pick's regime thesis had gone stale.
 *
 * Deliberately case-insensitive but exact-string comparison otherwise (no attempt to normalize
 * regime vocabulary drift between the two sources) — an unrecognized mismatch in spelling reads
 * as a genuine drift, which is the honest, fail-safe direction for a staleness warning.
 */
export function regimeAlignmentNote(
  playRegime: string | null | undefined,
  currentRegime: string | null | undefined
): RegimeAlignmentNote | null {
  const played = playRegime?.trim();
  const current = currentRegime?.trim();
  if (!played || !current) return null;

  if (played.toUpperCase() === current.toUpperCase()) {
    return { label: `Still ${current} — thesis regime intact`, tone: "up" };
  }
  return {
    label: `Published in ${played}, market now ${current} — validate before entry`,
    tone: "warn",
  };
}
