/** Pure edition meta helpers — safe to unit-test without importing the builder graph. */

/** Map DB meta.recap_only_reason onto the member-facing edition field. */
export function recapOnlyReasonFromMeta(
  meta: Record<string, unknown> | null | undefined,
  playsLength: number
): string | null {
  if (playsLength > 0) return null;
  const raw = meta?.recap_only_reason;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed || null;
}
