/**
 * Pure helper for railway-cron-schedule-audit.mjs, extracted so it can be
 * unit-tested with the plain node test runner (the audit script itself has
 * module-scope side effects — it walks the filesystem at import time).
 */

/**
 * Approximate UTC hour range -> ET (dual-offset note) for a 5-field cron
 * string's HOUR field specifically (field index 1: "minute hour day month
 * weekday").
 *
 * Root cause this replaces: the previous implementation ran one unanchored
 * regex over the WHOLE cron string looking for "<token> <num>-<num>" anywhere
 * in it, rather than reading the hour field by position. For any cron whose
 * hour field is a comma-list (e.g. "10 20,21 * * 1-5", "15 13,14 * * 1-5" —
 * both real schedules in this repo's railway.*.toml files) there is no dash
 * in the hour field, so the regex kept scanning rightward and matched the
 * trailing WEEKDAY range "1-5" instead — printing "1:00-5:59 UTC" as if that
 * were the cron's firing hours, when "1-5" is actually "Monday-Friday". This
 * silently mislabeled the UTC/ET band for every comma-list-hour cron in the
 * audit's own output (banger-discovery, GEX-EOD-Snapshot, Largo-Morning-Brief,
 * nighthawk-backfill-repair, NightHawk-Morning-Confirm,
 * NightHawk-Outcomes-Cron, SPX-Signal-Weight-Optimize, Swing-Discovery,
 * zerodte-skip-grade — confirmed live against this repo's railway.*.toml).
 *
 * Fix: split the cron string into its 5 whitespace-separated fields and test
 * ONLY field[1] (the hour field) for a plain numeric dash-range. A
 * comma-list, a step (every-5-minutes style), or a bare wildcard hour field
 * has no single continuous UTC window to report, so this correctly returns
 * null for those rather than fabricating one from an unrelated field.
 */
export function utcBandToEt(cron) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length < 2) return null;
  const hourField = fields[1];
  const m = hourField.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return {
    utc: `${start}:00–${end}:59 UTC`,
    edt: `${start - 4}:00–${end - 4}:59 ET (EDT, Mar–Nov)`,
    est: `${start - 5}:00–${end - 5}:59 ET (EST, Nov–Mar)`,
  };
}
