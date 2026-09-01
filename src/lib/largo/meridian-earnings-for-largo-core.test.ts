import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  printKeysFromUwRows,
  stampMeridianReactionsOnUwRows,
} from "./meridian-earnings-for-largo-core";

describe("meridian-earnings-for-largo-core", () => {
  test("printKeysFromUwRows extracts ticker, date, and timing", () => {
    const keys = printKeysFromUwRows([
      { ticker: "NVDA", report_date: "2026-05-28", report_time: "16:20" },
    ]);
    assert.equal(keys.length, 1);
    assert.equal(keys[0]!.ticker, "NVDA");
    assert.equal(keys[0]!.ymd, "2026-05-28");
  });

  test("stampMeridianReactionsOnUwRows adds meridian_reaction_pct", () => {
    const reactions = new Map([
      [
        "NVDA",
        new Map([
          [
            "2026-05-28",
            {
              reaction_pct: 3.4,
              reaction_basis: "amc_session",
              reaction_measure: "prior_close_to_close",
              reaction_settled: true,
            },
          ],
        ]),
      ],
    ]);
    const out = stampMeridianReactionsOnUwRows(
      [{ ticker: "NVDA", report_date: "2026-05-28", reaction: "-0.02" }],
      reactions
    );
    assert.equal(out[0]!.meridian_reaction_pct, 3.4);
    assert.match(String(out[0]!.reaction_authority), /Prefer meridian_reaction_pct/);
  });

  test("rows without report_date pass through unchanged", () => {
    const row = { ticker: "NVDA", report_date: "" };
    const out = stampMeridianReactionsOnUwRows([row], new Map());
    assert.deepEqual(out[0], row);
  });
});
