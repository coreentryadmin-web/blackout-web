import assert from "node:assert/strict";
import { test } from "node:test";
import {
  burstWindowExpired,
  ingestBurstItemPure,
  discordBurstWindowSec,
} from "./discord-burst-buffer.ts";

test("discordBurstWindowSec defaults to 240s", () => {
  assert.equal(discordBurstWindowSec(), 240);
});

test("ingestBurstItemPure starts a fresh buffer on first item", () => {
  const now = 1_000_000;
  const { flush, next } = ingestBurstItemPure(null, "NVDA", { p: 1 }, now, 240);
  assert.equal(flush, null);
  assert.equal(next.items.length, 1);
  assert.equal(next.ticker, "NVDA");
});

test("ingestBurstItemPure flushes when window rolls", () => {
  const windowSec = 240;
  const start = 1_000_000;
  const first = ingestBurstItemPure(null, "NVDA", { p: 1 }, start, windowSec);
  const rolled = ingestBurstItemPure(
    first.next,
    "NVDA",
    { p: 2 },
    start + windowSec * 1000 + 1,
    windowSec
  );
  assert.equal(rolled.flush?.length, 1);
  assert.equal(rolled.next.items.length, 1);
  assert.deepEqual(rolled.next.items[0], { p: 2 });
});

test("burstWindowExpired is false inside window", () => {
  const buf = { ticker: "SPY", items: [{}], windowStartMs: 0, lastAtMs: 1000 };
  assert.equal(burstWindowExpired(buf, 1000 + 239_000, 240), false);
  assert.equal(burstWindowExpired(buf, 1000 + 241_000, 240), true);
});
