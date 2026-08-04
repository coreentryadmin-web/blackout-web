import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHelixDiscordEmbed,
  buildHelixTopHitsDigestEmbed,
  classifyHelixDiscordKind,
  helixDiscordWriteup,
  passesHelixDiscordFilters,
  selectHelixDiscordDigest,
  HELIX_DISCORD_MIN_PREMIUM,
} from "./helix-discord-format.ts";

const base = {
  ticker: "SPY",
  premium: 900_000,
  option_type: "PUT",
  expiry: "2026-08-21",
  strike: 735,
  direction: "bearish",
  route: "whale",
  fill_price: 8.5,
  dte: 23,
};

test("passesHelixDiscordFilters requires all three gates", () => {
  assert.equal(passesHelixDiscordFilters(base), true);
  assert.equal(passesHelixDiscordFilters({ ...base, premium: 499_999 }), false);
  assert.equal(passesHelixDiscordFilters({ ...base, fill_price: 10 }), false);
  assert.equal(passesHelixDiscordFilters({ ...base, fill_price: 0 }), false);
  assert.equal(passesHelixDiscordFilters({ ...base, fill_price: null }), false);
  assert.equal(passesHelixDiscordFilters({ ...base, dte: 31 }), false);
  assert.equal(passesHelixDiscordFilters({ ...base, dte: -1 }), false);
  assert.equal(HELIX_DISCORD_MIN_PREMIUM, 500_000);
});

test("writeup weaves GEX when present and omits when absent", () => {
  const withWall = helixDiscordWriteup({ ...base, gex_proximity: "near_put_wall" });
  assert.match(withWall, /near the put wall/);
  assert.match(withWall, /\$900K/);
  const plain = helixDiscordWriteup(base);
  assert.doesNotMatch(plain, /wall|flip/i);
});

test("classify prefers whale-structure when whale + gex", () => {
  assert.equal(
    classifyHelixDiscordKind({ ...base, premium: 2_000_000, gex_proximity: "at_call_wall" }),
    "whale-structure"
  );
  assert.equal(
    classifyHelixDiscordKind({ ...base, alert_rule: "RepeatedHits", gex_proximity: null }),
    "stack"
  );
  assert.equal(classifyHelixDiscordKind({ ...base, dte: 1, route: "stock" }), "near");
});

test("buildHelixDiscordEmbed is a short write-up not field soup", () => {
  const emb = buildHelixDiscordEmbed({
    ...base,
    fill_price: 9.41,
    dte: 2,
    gex_proximity: "near_call_wall",
    premium: 1_500_000,
  });
  assert.match(emb.title, /HELIX/);
  assert.match(emb.description, /printing near the call wall/);
  assert.doesNotMatch(emb.description, /\*\*Premium\*\*/);
  assert.match(emb.description, /Open in HELIX/);
});

test("digest embed lists ranked rows", () => {
  const emb = buildHelixTopHitsDigestEmbed({
    windowMin: 15,
    inWindowCount: 2,
    sessionFallback: false,
    rows: [
      { ...base, ticker: "NVDA", premium: 1_200_000, fill_price: 6.35, dte: 12 },
      { ...base, ticker: "MSFT", premium: 800_000, fill_price: 8.8, dte: 2 },
    ],
  });
  assert.match(emb.title, /15m/);
  assert.match(emb.description, /NVDA/);
  assert.match(emb.description, /MSFT/);
  assert.match(emb.description, /Lead:/);
});

test("selectHelixDiscordDigest prefers in-window score then premium", () => {
  const now = new Date("2026-07-29T15:00:00.000Z");
  const recent = now.toISOString();
  const stale = new Date(now.getTime() - 40 * 60_000).toISOString();
  const picked = selectHelixDiscordDigest(
    [
      {
        ...base,
        ticker: "OLD",
        premium: 3_000_000,
        score: 9,
        fill_price: 5,
        dte: 10,
        event_at: stale,
      },
      {
        ...base,
        ticker: "HOT",
        premium: 700_000,
        score: 6,
        fill_price: 4,
        dte: 5,
        event_at: recent,
      },
      {
        ...base,
        ticker: "SKIP",
        premium: 900_000,
        score: 8,
        fill_price: 12,
        dte: 5,
        event_at: recent,
      },
    ],
    { windowMin: 15, now, limit: 3 }
  );
  assert.equal(picked.sessionFallback, false);
  assert.equal(picked.inWindowCount, 1);
  assert.equal(picked.rows[0]?.ticker, "HOT");
});
