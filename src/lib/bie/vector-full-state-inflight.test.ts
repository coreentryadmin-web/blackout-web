import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeInFlight } from "./vector-full-state-inflight";

test("dedupeInFlight: two concurrent calls for the same key share ONE factory invocation", async () => {
  let calls = 0;
  let resolve!: (v: string) => void;
  const pending = new Promise<string>((r) => {
    resolve = r;
  });
  const factory = () => {
    calls += 1;
    return pending;
  };

  // Fire two "concurrent" calls for the same key before either resolves — this is exactly the
  // play-brief-context.ts + ecosystem-context.ts shape: both want fetchVectorFullState(ticker,
  // "all") for the same ticker at the same instant.
  const p1 = dedupeInFlight("NVDA:all:5", factory);
  const p2 = dedupeInFlight("NVDA:all:5", factory);

  assert.equal(calls, 1, "a second concurrent call for the same key must NOT invoke factory again");

  resolve("live-state");
  assert.equal(await p1, "live-state");
  assert.equal(await p2, "live-state");
  assert.equal(p1, p2, "both callers must receive the exact same promise");
});

test("dedupeInFlight: a DIFFERENT key is never deduped against an in-flight call", async () => {
  let calls = 0;
  const factory = async () => {
    calls += 1;
    return `result-${calls}`;
  };

  const a = dedupeInFlight("NVDA:all:5", factory);
  const b = dedupeInFlight("TSLA:all:5", factory);

  assert.equal(calls, 2, "a different key must get its own factory invocation");
  assert.equal(await a, "result-1");
  assert.equal(await b, "result-2");
});

test("dedupeInFlight: the entry clears after settling, so a later NON-overlapping call gets a fresh invocation", async () => {
  let calls = 0;
  const factory = async () => {
    calls += 1;
    return `result-${calls}`;
  };

  const first = await dedupeInFlight("NVDA:all:5", factory);
  const second = await dedupeInFlight("NVDA:all:5", factory);

  assert.equal(calls, 2, "a call made AFTER the first one settled must run its own factory");
  assert.equal(first, "result-1");
  assert.equal(second, "result-2");
});

test("dedupeInFlight: a rejected factory still clears its entry (never wedges the key forever)", async () => {
  let calls = 0;
  const factory = async () => {
    calls += 1;
    if (calls === 1) throw new Error("boom");
    return "recovered";
  };

  await assert.rejects(() => dedupeInFlight("SPY:all:5", factory));
  const recovered = await dedupeInFlight("SPY:all:5", factory);
  assert.equal(recovered, "recovered");
  assert.equal(calls, 2, "the failed call must not permanently block future calls for the same key");
});
