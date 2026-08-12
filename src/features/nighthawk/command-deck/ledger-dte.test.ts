import test from "node:test";
import assert from "node:assert/strict";
import { ledgerRowDte, etYmdOfInstant } from "./ledger-dte";

/**
 * The regression these guard: after the close, every board row is ledger-only, the synthetic setup
 * hardcoded `dte: null`, and the whole desk rendered "?DTE" (observed live on prod, all 7 plays).
 */

test("a same-day 0DTE play reads 0, not '?'", () => {
  // RIOT 21P expiring the same session it was flagged.
  assert.equal(ledgerRowDte("RIOT260812P00021000", "2026-08-12T14:17:00Z", null), 0);
});

test("a multi-day contract reports the real gap", () => {
  // Flagged Monday, expiring that Friday.
  assert.equal(ledgerRowDte("NVDA260814C00180000", "2026-08-10T14:30:00Z", null), 4);
});

test("the reference day is the play's own session, so a closed play never counts DOWN", () => {
  // Graded days ago. Measured from "now" this would be negative and get suppressed to "?"; measured
  // from its first flag it is the 0DTE it always was.
  const muchLater = new Date("2026-09-01T15:00:00Z");
  assert.equal(ledgerRowDte("RIOT260812P00021000", "2026-08-12T14:17:00Z", null, muchLater), 0);
});

test("exit time is the fallback reference when the flag instant is missing", () => {
  assert.equal(ledgerRowDte("RIOT260812P00021000", null, "2026-08-12T19:50:00Z"), 0);
});

test("with neither timestamp it falls back to today", () => {
  const now = new Date("2026-08-10T15:00:00Z");
  assert.equal(ledgerRowDte("NVDA260814C00180000", null, null, now), 4);
});

test("the ET day is what counts — an evening flag does not roll into tomorrow", () => {
  // 2026-08-12T23:30:00Z is 19:30 ET on the 12th. Reading this in UTC would call it the 13th and
  // report one day too few.
  assert.equal(etYmdOfInstant("2026-08-12T23:30:00Z"), "2026-08-12");
  assert.equal(ledgerRowDte("NVDA260814C00180000", "2026-08-12T23:30:00Z", null), 2);
});

test("no OCC, or an unparseable one, stays '?' rather than guessing", () => {
  assert.equal(ledgerRowDte(null, "2026-08-12T14:17:00Z", null), null);
  assert.equal(ledgerRowDte("", "2026-08-12T14:17:00Z", null), null);
  assert.equal(ledgerRowDte("not-an-occ", "2026-08-12T14:17:00Z", null), null);
  assert.equal(etYmdOfInstant("garbage"), null);
});

test("an expiry BEFORE the reference session is refused, never rendered as a negative DTE", () => {
  assert.equal(ledgerRowDte("RIOT260812P00021000", "2026-08-20T14:17:00Z", null), null);
});

test("an absurd gap is refused — a wrong number is worse than an honest '?'", () => {
  // A LEAP-dated symbol on a 0DTE row means the row is pointing at the wrong contract.
  assert.equal(ledgerRowDte("RIOT281215P00021000", "2026-08-12T14:17:00Z", null), null);
});

test("the OCC strike divisor is not mistaken for the date (the classic parse slip)", () => {
  // 00021000 = $21.000. If the parser mis-split, the expiry would move and the DTE with it.
  assert.equal(ledgerRowDte("RIOT260812P00021000", "2026-08-12T13:45:00Z", null), 0);
});
