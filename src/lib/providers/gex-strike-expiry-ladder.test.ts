import { test } from "node:test";
import assert from "node:assert/strict";
import { ladderFromGexStrikeExpiryCells } from "./gex-strike-expiry-ladder";
import type { UwGexStrikeExpiryRow } from "./unusual-whales";

const row = (expiry: string, strike: number, net_gex: number): UwGexStrikeExpiryRow => ({
  ticker: "SPX",
  strike,
  expiry,
  call_gamma_oi: 0,
  put_gamma_oi: 0,
  net_gex,
  price: null,
});

test("sums net_gex across ALL expiries when no allow-list is given (back-compat)", () => {
  const cells = new Map([
    ["2026-07-01|7500", row("2026-07-01", 7500, 1_000_000)],
    ["2026-09-19|7500", row("2026-09-19", 7500, -50_000_000)], // far-dated monthly OpEx
  ]);
  const { ladder, cell_count } = ladderFromGexStrikeExpiryCells(cells);
  assert.equal(ladder.get(7500), -49_000_000);
  assert.equal(cell_count, 2);
});

test("restricts the sum to the allowed near-term expiries only", () => {
  const cells = new Map([
    ["2026-07-01|7500", row("2026-07-01", 7500, 1_000_000)],
    ["2026-09-19|7500", row("2026-09-19", 7500, -50_000_000)], // excluded
  ]);
  const { ladder, cell_count } = ladderFromGexStrikeExpiryCells(cells, ["2026-07-01"]);
  assert.equal(ladder.get(7500), 1_000_000);
  assert.equal(cell_count, 1);
});

test("returns an empty ladder (not a crash) when nothing matches the allow-list", () => {
  const cells = new Map([["2026-09-19|7500", row("2026-09-19", 7500, -50_000_000)]]);
  const { ladder, cell_count } = ladderFromGexStrikeExpiryCells(cells, ["2026-07-01"]);
  assert.equal(ladder.size, 0);
  assert.equal(cell_count, 0);
});

test("sums multiple rows at the same strike across different allowed expiries", () => {
  const cells = new Map([
    ["2026-07-01|7500", row("2026-07-01", 7500, 1_000_000)],
    ["2026-07-02|7500", row("2026-07-02", 7500, 2_000_000)],
  ]);
  const { ladder } = ladderFromGexStrikeExpiryCells(cells, ["2026-07-01", "2026-07-02"]);
  assert.equal(ladder.get(7500), 3_000_000);
});

test("an empty allow-list array is treated the same as no allow-list (defensive)", () => {
  const cells = new Map([["2026-09-19|7500", row("2026-09-19", 7500, -50_000_000)]]);
  const { ladder } = ladderFromGexStrikeExpiryCells(cells, []);
  assert.equal(ladder.get(7500), -50_000_000);
});
