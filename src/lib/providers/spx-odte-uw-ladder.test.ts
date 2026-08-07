import { test } from "node:test";
import assert from "node:assert/strict";
import { uwRowsFromStrikeLadder, strikeLadderFromUwRows } from "./spx-odte-uw-ladder";

test("uwRowsFromStrikeLadder normalizes net to call_gamma_oi rows", () => {
  const rows = uwRowsFromStrikeLadder(
    new Map([
      [7750, 835_268_500],
      [7900, 200_000_100],
    ])
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].strike, 7750);
  assert.equal(Number(rows[0].call_gamma_oi) + Number(rows[0].put_gamma_oi), 835_268_500);
});

test("strikeLadderFromUwRows round-trips normalized rows", () => {
  const rows = [
    { strike: 7750, call_gamma_oi: 100, put_gamma_oi: -20 },
    { strike: 7900, call_gamma_oi: 50, put_gamma_oi: 0 },
  ];
  const ladder = strikeLadderFromUwRows(rows);
  assert.equal(ladder.get(7750), 80);
  assert.equal(ladder.get(7900), 50);
});
