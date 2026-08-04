import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDarkpoolDiscordEmbed,
  buildDarkpoolTopBlocksDigestEmbed,
  darkpoolDiscordDedupKey,
  extractDarkPoolWsPrints,
  normalizeDarkPoolDiscordPrint,
  passesDarkpoolDiscordFilters,
  selectDarkpoolDigestPrints,
  DARKPOOL_DISCORD_MIN_PREMIUM,
} from "./darkpool-discord-format.ts";

test("passesDarkpoolDiscordFilters requires >= $1M default", () => {
  const ok = {
    ticker: "NVDA",
    premium: 1_500_000,
    side: "buy" as const,
    executed_at: "2026-08-04T14:18:11.000Z",
  };
  assert.equal(passesDarkpoolDiscordFilters(ok), true);
  assert.equal(passesDarkpoolDiscordFilters({ ...ok, premium: 999_999 }), false);
  assert.equal(passesDarkpoolDiscordFilters({ ...ok, executed_at: "" }), false);
  assert.equal(DARKPOOL_DISCORD_MIN_PREMIUM, 1_000_000);
});

test("normalizeDarkPoolDiscordPrint drops rows without timestamp", () => {
  assert.equal(
    normalizeDarkPoolDiscordPrint({ ticker: "NVDA", premium: 2_000_000 }),
    null
  );
  const row = normalizeDarkPoolDiscordPrint({
    ticker: "NVDA",
    premium: 2_000_000,
    executed_at: "2026-08-04T14:18:11.000Z",
    side: "buy",
    price: 142.5,
    size: 125_000,
  });
  assert.equal(row?.ticker, "NVDA");
  assert.equal(row?.side, "buy");
});

test("extractDarkPoolWsPrints handles batch payloads", () => {
  const prints = extractDarkPoolWsPrints([
    { ticker: "AAPL", premium: 1_200_000, executed_at: "2026-08-04T14:00:00.000Z", side: "sell" },
    { ticker: "MSFT", premium: 800_000, executed_at: "2026-08-04T14:01:00.000Z" },
  ]);
  assert.equal(prints.length, 2);
  assert.equal(prints[0]?.ticker, "AAPL");
});

test("buildDarkpoolDiscordEmbed includes ticker and ET copy", () => {
  const emb = buildDarkpoolDiscordEmbed({
    ticker: "NVDA",
    premium: 4_200_000,
    side: "buy",
    executed_at: "2026-08-04T14:18:11.000Z",
    price: 142.5,
    share_size: 125_000,
  });
  assert.match(emb.title, /NVDA/);
  assert.match(emb.description, /\$4\.20M/);
  assert.match(emb.description, /BUY side/);
  assert.match(emb.description, /Open in HELIX/);
});

test("selectDarkpoolDigestPrints ranks in-window by premium", () => {
  const now = new Date("2026-08-04T14:32:00.000Z");
  const recent = "2026-08-04T14:28:00.000Z";
  const stale = "2026-08-04T13:00:00.000Z";
  const { rows, inWindowCount } = selectDarkpoolDigestPrints(
    [
      { ticker: "AAPL", premium: 1_100_000, side: "buy", executed_at: recent },
      { ticker: "NVDA", premium: 3_000_000, side: "buy", executed_at: recent },
      { ticker: "OLD", premium: 9_000_000, side: "sell", executed_at: stale },
    ],
    { now, limit: 2 }
  );
  assert.equal(inWindowCount, 2);
  assert.equal(rows[0]?.ticker, "NVDA");
});

test("dedup key is stable for same print", () => {
  const p = {
    ticker: "SPY",
    premium: 1_000_000,
    side: "neutral" as const,
    executed_at: "2026-08-04T14:00:00.000Z",
    price: 628.5,
  };
  assert.equal(darkpoolDiscordDedupKey(p), darkpoolDiscordDedupKey({ ...p }));
});

test("digest embed lists ranked blocks", () => {
  const emb = buildDarkpoolTopBlocksDigestEmbed({
    windowMin: 15,
    inWindowCount: 2,
    rows: [
      { ticker: "NVDA", premium: 2_000_000, side: "buy", executed_at: "2026-08-04T14:20:00.000Z", price: 140 },
      { ticker: "AAPL", premium: 1_500_000, side: "sell", executed_at: "2026-08-04T14:10:00.000Z", price: 220 },
    ],
  });
  assert.match(emb.title, /Top blocks/);
  assert.match(emb.description, /NVDA/);
});
