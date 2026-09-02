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
  buildDarkpoolBurstEmbed,
  darkpoolDiscordLiveRthOnly,
} from "./darkpool-discord-format.ts";

test("passesDarkpoolDiscordFilters requires >= $5M default", () => {
  const ok = {
    ticker: "NVDA",
    premium: 5_500_000,
    side: "buy" as const,
    executed_at: "2026-08-04T14:18:11.000Z",
  };
  assert.equal(passesDarkpoolDiscordFilters(ok), true);
  assert.equal(passesDarkpoolDiscordFilters({ ...ok, premium: 4_999_999 }), false);
  assert.equal(passesDarkpoolDiscordFilters({ ...ok, executed_at: "" }), false);
  assert.equal(DARKPOOL_DISCORD_MIN_PREMIUM, 5_000_000);
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
  assert.match(emb.description ?? "", /Open this block in HELIX/);
});

test("selectDarkpoolDigestPrints ranks in-window by premium", () => {
  const now = new Date("2026-08-04T14:32:00.000Z");
  const recent = "2026-08-04T14:28:00.000Z";
  const stale = "2026-08-04T13:00:00.000Z";
  const { rows, inWindowCount } = selectDarkpoolDigestPrints(
    [
      { ticker: "AAPL", premium: 6_000_000, side: "buy", executed_at: recent },
      { ticker: "NVDA", premium: 8_000_000, side: "buy", executed_at: recent },
      { ticker: "OLD", premium: 9_000_000, side: "sell", executed_at: stale },
    ],
    { now, limit: 2 }
  );
  assert.equal(inWindowCount, 2);
  assert.equal(rows[0]?.ticker, "NVDA");
});

test("selectDarkpoolDigestPrints rejects a future-dated block instead of counting it in-window", () => {
  // Same future-print bug already fixed in Helix's Repeat Hits/digest filters: an executed_at
  // ahead of `now` makes `nowMs - ms` negative, which trivially satisfies `<= windowMs` and would
  // let a clock-skewed block win the digest pick on premium alone.
  const now = new Date("2026-08-04T14:32:00.000Z");
  const recent = "2026-08-04T14:28:00.000Z";
  const future = new Date(now.getTime() + 10 * 60_000).toISOString();
  const { rows, inWindowCount } = selectDarkpoolDigestPrints(
    [
      { ticker: "AAPL", premium: 6_000_000, side: "buy", executed_at: recent },
      { ticker: "FUTURE", premium: 20_000_000, side: "buy", executed_at: future },
    ],
    { now, limit: 2 }
  );
  assert.equal(inWindowCount, 1);
  assert.equal(rows[0]?.ticker, "AAPL");
});

test("dedup key is stable for same print", () => {
  const p = {
    ticker: "SPY",
    premium: 5_000_000,
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
      { ticker: "NVDA", premium: 7_000_000, side: "buy", executed_at: "2026-08-04T14:20:00.000Z", price: 140 },
      { ticker: "AAPL", premium: 5_500_000, side: "sell", executed_at: "2026-08-04T14:10:00.000Z", price: 220 },
    ],
  });
  assert.match(emb.title, /Top blocks/);
  assert.match(emb.description, /NVDA/);
});

test("buildDarkpoolBurstEmbed collapses multiple blocks", () => {
  const emb = buildDarkpoolBurstEmbed({
    ticker: "NVDA",
    windowMin: 4,
    prints: [
      { ticker: "NVDA", premium: 6_000_000, side: "buy", executed_at: "2026-08-04T14:00:00.000Z" },
      { ticker: "NVDA", premium: 7_000_000, side: "buy", executed_at: "2026-08-04T14:02:00.000Z" },
    ],
  });
  assert.match(emb.title, /burst \(2 blocks\)/);
  assert.match(emb.description ?? "", /\$13\.0M/);
});

test("darkpoolDiscordLiveRthOnly defaults true", () => {
  assert.equal(darkpoolDiscordLiveRthOnly(), true);
});

test("buildDarkpoolDiscordEmbed weaves adv_context_line", () => {
  const emb = buildDarkpoolDiscordEmbed({
    ticker: "NVDA",
    premium: 6_000_000,
    side: "buy",
    executed_at: "2026-08-04T14:18:11.000Z",
    adv_context_line: "Size: 4.2% of 20D ~12M ADV",
  });
  assert.match(emb.description ?? "", /4\.2% of 20D/);
});
