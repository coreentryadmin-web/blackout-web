// Single source of truth for the ET session-calendar-date string (YYYY-MM-DD).
//
// Pure + alias-free + no "server-only": importable from server engines/stores
// AND from client modules, and directly unit-testable under `tsx --test`.
//
// MONEY-PATH INVARIANT: this MUST stay byte-identical in behavior to the ~7
// copies it replaces (spx-play/lotto/power-hour stores+engines, spx-play-claude,
// admin-spx-dashboard). Do NOT add year/month/day option fields or change the
// locale/timeZone — 'en-CA' yields ISO-ordered YYYY-MM-DD and the tz boundary
// is what every session-date comparison depends on. Changing any of these would
// shift the daily session-reset boundary and corrupt lock/settle/sizing state.

const ET_TIME_ZONE = "America/New_York";

/**
 * The current calendar date in US/Eastern as "YYYY-MM-DD".
 * @param now injectable clock for deterministic tests; defaults to new Date()
 *            so the zero-arg call path is byte-identical to the originals.
 */
export function todayEt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET_TIME_ZONE }).format(now);
}

/**
 * Normalize an upstream execution timestamp to the ET calendar date (YYYY-MM-DD).
 *
 * Dark pool and flow tapes ship ISO instants, bare dates, and occasional space-separated
 * timestamps. Comparing with `startsWith(todayEt())` drops valid same-session prints when
 * the string is UTC-dated on the next calendar day while still RTH in New York.
 */
export function execAtEtYmd(execAt: string | null | undefined): string | null {
  const raw = String(execAt ?? "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = Date.parse(iso.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`);
  if (!Number.isFinite(parsed)) {
    const prefix = raw.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : null;
  }

  return new Intl.DateTimeFormat("en-CA", { timeZone: ET_TIME_ZONE }).format(new Date(parsed));
}
