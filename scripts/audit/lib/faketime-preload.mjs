/**
 * Move the process clock forward by a fixed offset, for the date-bomb scanner.
 *
 * WHY A SHIM AND NOT `libfaketime`. This sandbox has no libfaketime and the CI runner has no
 * guarantee of one either, so the offset has to live inside Node. Patching the global `Date` is
 * enough: everything that asks "what is today" — `new Date()`, `Date.now()`, and every helper built
 * on them (`etYmd()`, `calendarDte()`, session-date pickers) — goes through one of those two.
 *
 * WHAT IS DELIBERATELY *NOT* SHIFTED. Explicit constructions (`new Date("2026-08-21")`,
 * `new Date(ms)`) pass straight through unchanged. That asymmetry is the whole point: a test is a
 * date bomb precisely when a HARDCODED date is compared against a MOVING "now", so the hardcoded
 * side must stay put while now advances. Shifting both would move them together and the bomb would
 * never fire.
 *
 * `Date.parse`, `Date.UTC` and the rest are inherited as statics through `extends`, so they keep
 * real behaviour without being re-declared. `performance.now()` is untouched, so any test that
 * measures elapsed time still measures real elapsed time.
 *
 * Preload with: NODE_OPTIONS="--import <this file>" FAKE_TIME_OFFSET_MS=<ms>
 */
const OFFSET_MS = Number(process.env.FAKE_TIME_OFFSET_MS ?? 0);

if (Number.isFinite(OFFSET_MS) && OFFSET_MS !== 0) {
  const RealDate = Date;

  class ShiftedDate extends RealDate {
    constructor(...args) {
      // No-arg `new Date()` means "now" — the only construction that should move.
      if (args.length === 0) super(RealDate.now() + OFFSET_MS);
      else super(...args);
    }
    static now() {
      return RealDate.now() + OFFSET_MS;
    }
  }

  globalThis.Date = ShiftedDate;
}
