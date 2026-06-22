// Pure, alias-free time-parse guard for tape comparators. Lives in its own file
// (only the global Date built-in, no @/lib/* imports) so it is unit-testable under
// `npx tsx --test` and safe to import from the client-safe spx-desk-merge.ts.
//
// Comparators that sort prints by `new Date(t.time).getTime()` produce NaN when a
// timestamp is unparseable; NaN poisons every comparison (a<b, a>b, a===b all
// false), which under V8's unstable sort corrupts the whole ordering. safeTime
// sinks an unparseable value to 0 (epoch / oldest) so a single bad print can never
// reorder the rest of the tape.
export function safeTime(x: unknown): number {
  const t = Date.parse(x as string);
  return Number.isFinite(t) ? t : 0;
}
