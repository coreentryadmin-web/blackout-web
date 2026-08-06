import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDarkpoolEodRecapEmbed,
  buildHelixEodRecapEmbed,
  filterDarkpoolSessionPrints,
  filterHelixSessionFlows,
  isDiscordEodRecapWindow,
} from "./discord-eod-recap.ts";
import type { HelixDiscordFlowInput } from "./helix-discord-format.ts";

const helixBase: HelixDiscordFlowInput = {
  ticker: "NVDA",
  premium: 900_000,
  option_type: "CALL",
  expiry: "2026-08-21",
  strike: 140,
  fill_price: 8,
  dte: 5,
  event_at: "2026-08-04T15:00:00.000Z",
};

test("isDiscordEodRecapWindow is true ~4:05 PM ET", () => {
  assert.equal(isDiscordEodRecapWindow(new Date("2026-08-04T20:06:00.000Z")), true);
  assert.equal(isDiscordEodRecapWindow(new Date("2026-08-04T15:00:00.000Z")), false);
});

test("buildHelixEodRecapEmbed summarizes session leaders", () => {
  const emb = buildHelixEodRecapEmbed({
    sessionDate: "2026-08-04",
    flows: [helixBase, { ...helixBase, ticker: "TSLA", premium: 1_200_000 }],
    now: new Date("2026-08-04T20:06:00.000Z"),
  });
  assert.match(emb.title, /Session recap/);
  assert.match(emb.description ?? "", /TSLA/);
});

test("filterDarkpoolSessionPrints keeps RTH prints", () => {
  const sessionDate = "2026-08-04";
  const now = new Date("2026-08-04T20:06:00.000Z");
  const prints = filterDarkpoolSessionPrints(
    [
      { ticker: "NVDA", premium: 6_000_000, side: "buy", executed_at: "2026-08-04T15:00:00.000Z" },
      { ticker: "OLD", premium: 6_000_000, side: "sell", executed_at: "2026-08-03T15:00:00.000Z" },
    ],
    sessionDate,
    now
  );
  assert.equal(prints.length, 1);
  assert.equal(prints[0]?.ticker, "NVDA");
});

test("filterHelixSessionFlows mirrors session window", () => {
  const sessionDate = "2026-08-04";
  const now = new Date("2026-08-04T20:06:00.000Z");
  const flows = filterHelixSessionFlows(
    [helixBase, { ...helixBase, event_at: "2026-08-03T15:00:00.000Z" }],
    sessionDate,
    now
  );
  assert.equal(flows.length, 1);
});

test("buildDarkpoolEodRecapEmbed includes buy/sell counts", () => {
  const emb = buildDarkpoolEodRecapEmbed({
    sessionDate: "2026-08-04",
    prints: [
      { ticker: "NVDA", premium: 6_000_000, side: "buy", executed_at: "2026-08-04T15:00:00.000Z" },
      { ticker: "AAPL", premium: 7_000_000, side: "sell", executed_at: "2026-08-04T16:00:00.000Z" },
    ],
    now: new Date("2026-08-04T20:06:00.000Z"),
  });
  assert.match(emb.description ?? "", /buy \/ 1 sell/);
});
