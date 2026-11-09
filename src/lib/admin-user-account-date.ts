/**
 * Account date (created/last sign-in/last active) for the admin Users table — anchored to
 * **US Eastern**, this product's one clock everywhere else (see `et-clock.ts`'s module header).
 *
 * Pure + side-effect-free + no "server-only"/React import, split out of `UserManagement.tsx` so it
 * is directly unit-testable: importing that component module transitively pulls in JSX-heavy
 * sibling components (e.g. `src/components/marks/geometry.tsx`) that throw `ReferenceError: React
 * is not defined` when loaded outside Next.js's own JSX runtime — the exact "any module importing
 * a JSX-laden chain can't be unit-tested directly, extract the pure logic" trap this repo's audit
 * lane already documents for `server-only` imports.
 *
 * BUG THIS FIXES: this used to live inline in `UserManagement.tsx` as `toLocaleDateString` with no
 * `timeZone` option, which renders the VIEWER's browser-local calendar date, not ET. `ts` is an
 * absolute Clerk epoch-ms instant (`createdAt`/`lastSignInAt`/`lastActiveAt`), so for any admin
 * outside America/New_York the displayed calendar date could disagree with the real ET date by a
 * full day around the ET midnight boundary — the same bug shape already fixed on this desk's
 * trading surfaces (DarkPoolPanel's `fmtDate`, SignalAnalyticsPanel's date-range label), just on
 * the admin Users table's account-lifecycle columns instead.
 */
export function formatAdminUserDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
