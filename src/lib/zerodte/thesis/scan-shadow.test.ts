import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { attachThesisFirstShadow, thesisFirstEntryContext } from "./scan-shadow";
import { thesisFirstEnv } from "./types";

const origThesis = process.env.ZERODTE_THESIS_FIRST;
const origShadow = process.env.ZERODTE_THESIS_FIRST_SHADOW;

describe("scan-shadow", () => {
  test("attachThesisFirstShadow stamps thesis_first on setups (shadow default)", () => {
    process.env.ZERODTE_THESIS_FIRST = "0";
    delete process.env.ZERODTE_THESIS_FIRST_SHADOW;
    assert.equal(thesisFirstEnv().shadow, true);

    const setup = {
      ticker: "NVDA",
      direction: "long" as const,
      discovery_origin: ["FLOW" as const, "BREAKOUT" as const],
      gross_premium: 4_000_000,
      score: 78,
      underlying_price: 181,
      key_resistances: [182],
      rel_volume: 2.5,
      intraday: null,
      flow_quality: null,
    };
    attachThesisFirstShadow([setup as never]);
    assert.ok(setup.thesis_first);
    assert.ok(setup.thesis_first!.thesis.rails_fired.length >= 1);

    const blob = thesisFirstEntryContext(setup.thesis_first);
    assert.ok(blob);
    assert.equal(blob!.trade_archetype, setup.thesis_first!.thesis.trade_archetype);
    assert.ok(typeof blob!.systems_aligned === "number");
  });

  test("attachThesisFirstShadow no-op when shadow disabled", () => {
    process.env.ZERODTE_THESIS_FIRST = "0";
    process.env.ZERODTE_THESIS_FIRST_SHADOW = "0";
    assert.equal(thesisFirstEnv().shadow, false);

    const setup = {
      ticker: "TSLA",
      direction: "long" as const,
      discovery_origin: ["FLOW" as const],
      gross_premium: 1_000_000,
      score: 70,
      intraday: null,
      flow_quality: null,
    };
    attachThesisFirstShadow([setup as never]);
    assert.equal(setup.thesis_first, undefined);
  });
});

process.on("exit", () => {
  if (origThesis === undefined) delete process.env.ZERODTE_THESIS_FIRST;
  else process.env.ZERODTE_THESIS_FIRST = origThesis;
  if (origShadow === undefined) delete process.env.ZERODTE_THESIS_FIRST_SHADOW;
  else process.env.ZERODTE_THESIS_FIRST_SHADOW = origShadow;
});
