import test from "node:test";
import assert from "node:assert/strict";
import {
  exDividendCashForSession,
  isExDividendSession,
  underlyingPriceForStructuralStop,
} from "./ex-dividend-adjustment.js";

test("isExDividendSession matches YYYY-MM-DD", () => {
  assert.equal(isExDividendSession("2026-09-05", "2026-09-05"), true);
  assert.equal(isExDividendSession("2026-09-05", "2026-09-06"), false);
});

test("underlyingPriceForStructuralStop adds dividend for LONG on ex-div day", () => {
  const out = underlyingPriceForStructuralStop(98, "LONG", {
    exDividendSession: true,
    exDividendCash: 2,
  });
  assert.equal(out.price, 100);
  assert.equal(out.adjusted, true);
});

test("underlyingPriceForStructuralStop does not adjust SHORT", () => {
  const out = underlyingPriceForStructuralStop(98, "SHORT", {
    exDividendSession: true,
    exDividendCash: 2,
  });
  assert.equal(out.price, 98);
  assert.equal(out.adjusted, false);
});

test("exDividendCashForSession finds matching dividend", () => {
  const out = exDividendCashForSession(
    [
      { ex_dividend_date: "2026-09-05", cash_amount: 1.25 },
      { ex_dividend_date: "2026-06-05", cash_amount: 1.25 },
    ],
    "2026-09-05",
  );
  assert.equal(out.session, true);
  assert.equal(out.cash, 1.25);
});
