import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtMoney, fmtMoneySigned } from "./gex-heatmap-money-format";

test("fmtMoney promotes K -> M at the rounding boundary (RED before fix: printed $1000.0K)", () => {
  assert.equal(fmtMoney(999_950), "$1.0M");
});

test("fmtMoney promotes M -> B at the rounding boundary (RED before fix: printed $1000.0M)", () => {
  assert.equal(fmtMoney(999_950_000), "$1.0B");
});

test("fmtMoney does not over-promote values that round down within their own unit", () => {
  assert.equal(fmtMoney(999_949), "$999.9K");
  assert.equal(fmtMoney(999_949_999), "$999.9M");
});

test("fmtMoney formats ordinary values in each unit band", () => {
  assert.equal(fmtMoney(500), "$500");
  assert.equal(fmtMoney(22_100), "$22.1K");
  assert.equal(fmtMoney(45_200_000), "$45.2M");
  assert.equal(fmtMoney(1_200_000_000), "$1.2B");
});

test("fmtMoney handles negative values and the sub-$1 dot", () => {
  assert.equal(fmtMoney(-999_950), "-$1.0M");
  assert.equal(fmtMoney(0.4), "·");
  assert.equal(fmtMoney(0), "·");
});

test("fmtMoneySigned always carries an explicit sign and promotes at the same boundary", () => {
  assert.equal(fmtMoneySigned(999_950_000), "+$1.0B");
  assert.equal(fmtMoneySigned(-999_950_000), "-$1.0B");
  assert.equal(fmtMoneySigned(0), "·");
});
