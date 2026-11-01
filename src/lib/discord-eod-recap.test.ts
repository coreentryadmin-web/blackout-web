import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildDarkpoolEodRecapEmbed,
  buildHelixEodRecapEmbed,
  filterDarkpoolSessionPrints,
  filterHelixSessionFlows,
  hoursSinceSessionOpenEt,
  isDiscordEodRecapWindow,
} from "./discord-eod-recap.ts";
import type { HelixDiscordFlowInput } from "./helix-discord-format.ts";

const moduleSrc = readFileSync(fileURLToPath(new URL("./discord-eod-recap.ts", import.meta.url)), "utf8");

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

test("isDiscordEodRecapWindow — false on NYSE holiday even in 4:04-4:14 ET band", () => {
  assert.equal(isDiscordEodRecapWindow(new Date("2026-09-07T20:06:00.000Z")), false); // Labor Day 4:06 PM ET
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

// Regression: sessionOpenMs used to hardcode "T13:30:00.000Z" as 9:30 AM ET, which is only
// correct under EDT. Under EST (DST ends the first Sunday of November), 9:30 AM ET is
// 14:30 UTC, so the old constant read as 8:30 AM ET and let an hour of genuine pre-market
// flow leak into the EOD recap filter as regular-session activity.
test("filterHelixSessionFlows excludes pre-market flows under EST (DST-correct session open)", () => {
  const sessionDate = "2026-11-16"; // Monday, after DST ends 2026-11-01 — EST (UTC-5) in effect
  const now = new Date("2026-11-16T21:00:00.000Z"); // 4:00 PM ET
  const preMarket: HelixDiscordFlowInput = {
    ...helixBase,
    ticker: "PRE",
    event_at: "2026-11-16T13:45:00.000Z", // 8:45 AM ET — pre-market, must be excluded
  };
  const rth: HelixDiscordFlowInput = {
    ...helixBase,
    ticker: "RTH",
    event_at: "2026-11-16T15:00:00.000Z", // 10:00 AM ET — regular session, must be kept
  };
  const kept = filterHelixSessionFlows([preMarket, rth], sessionDate, now);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.ticker, "RTH");
});

test("filterDarkpoolSessionPrints excludes pre-market prints under EST (DST-correct session open)", () => {
  const sessionDate = "2026-11-16";
  const now = new Date("2026-11-16T21:00:00.000Z");
  const prints = filterDarkpoolSessionPrints(
    [
      { ticker: "PRE", premium: 6_000_000, side: "buy", executed_at: "2026-11-16T13:45:00.000Z" },
      { ticker: "RTH", premium: 6_000_000, side: "sell", executed_at: "2026-11-16T15:00:00.000Z" },
    ],
    sessionDate,
    now
  );
  assert.equal(prints.length, 1);
  assert.equal(prints[0]?.ticker, "RTH");
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

// Regression: the helix-discord-digest cron's EOD branch used to reuse `inputs`, fetched with
// a fixed `since_hours: 6` sized for the 15/30-min live digest. At the earliest EOD window tick
// (4:04 PM ET, EDT), that is 6h34m after a 9:30 AM open — more than the 6h the live-digest fetch
// requested — so the first ~34 minutes of the session's flow was silently excluded from the DB
// query itself, before the in-process session filter ever saw those rows. This asserts the gap
// `hoursSinceSessionOpenEt` exists to close: a caller sizing its fetch off this value (rounded up
// + 1h buffer, as the route now does) always covers the full session, where a bare `6` would not.
test("hoursSinceSessionOpenEt exceeds 6h at the earliest EOD recap tick (EDT)", () => {
  const sessionDate = "2026-08-04"; // EDT in effect
  const hours = hoursSinceSessionOpenEt(sessionDate, new Date("2026-08-04T20:04:00.000Z")); // 4:04 PM ET
  assert.ok(hours > 6, `expected >6h since 9:30 AM open, got ${hours}`);
  assert.ok(hours < 7, `expected <7h at 4:04 PM ET, got ${hours}`);
});

test("hoursSinceSessionOpenEt exceeds 6h at the earliest EOD recap tick (EST)", () => {
  const sessionDate = "2026-11-16"; // after DST ends — EST in effect
  const hours = hoursSinceSessionOpenEt(sessionDate, new Date("2026-11-16T21:04:00.000Z")); // 4:04 PM ET
  assert.ok(hours > 6, `expected >6h since 9:30 AM open, got ${hours}`);
});

test("hoursSinceSessionOpenEt is exactly 0 at session open and floors at 0 beforehand", () => {
  const sessionDate = "2026-08-04";
  assert.equal(hoursSinceSessionOpenEt(sessionDate, new Date("2026-08-04T13:30:00.000Z")), 0);
  assert.equal(hoursSinceSessionOpenEt(sessionDate, new Date("2026-08-04T12:00:00.000Z")), 0);
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

// Regression for #3960 (CLQ-037/044): sharedCacheSetNx now THROWS on a Redis command error
// instead of silently falling back to an in-memory acquire — every caller must decide fail-open
// vs fail-closed explicitly. This EOD-recap dedup guard is duplicate-post-tolerant, so it must
// fail OPEN (post anyway) rather than let a transient Redis blip suppress the recap entirely.
test("claimDiscordEodRecap fails OPEN on a sharedCacheSetNx rejection", () => {
  assert.match(
    moduleSrc,
    /return sharedCacheSetNx\(eodRecapDedupKey\(channel, sessionDate\)[\s\S]{0,80}\)\.catch\(\s*\(\) => true\s*\)/,
    "claimDiscordEodRecap must have an explicit .catch(() => true) now that Redis errors propagate"
  );
});
