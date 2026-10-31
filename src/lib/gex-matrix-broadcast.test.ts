import { test } from "node:test";
import assert from "node:assert/strict";
import { broadcastMatrixDelta, subscribeMatrixDeltas } from "./gex-matrix-broadcast";
import type { MatrixDelta } from "./gex-matrix-delta";

function fakeDelta(ticker = "SPY"): MatrixDelta {
  return { ticker } as unknown as MatrixDelta;
}

test("subscribeMatrixDeltas delivers a broadcast payload to the subscriber's writer", async () => {
  const received: string[] = [];
  const unsubscribe = subscribeMatrixDeltas({
    write: async (data) => {
      received.push(data);
    },
  });

  try {
    const delta = fakeDelta("SPY");
    await broadcastMatrixDelta(delta);

    assert.equal(received.length, 1);
    assert.match(received[0], /^data: /);
    assert.deepEqual(JSON.parse(received[0].slice("data: ".length).trim()), delta);
  } finally {
    unsubscribe();
  }
});

test("a subscriber whose writer rejects is pruned and stops receiving broadcasts", async () => {
  let calls = 0;
  const unsubscribe = subscribeMatrixDeltas({
    write: async () => {
      calls++;
      throw new Error("connection closed");
    },
  });

  // First broadcast hits the dead writer and removes it from the subscriber set.
  await broadcastMatrixDelta(fakeDelta("QQQ"));
  assert.equal(calls, 1);

  // Second broadcast must not call the pruned writer again.
  await broadcastMatrixDelta(fakeDelta("QQQ"));
  assert.equal(calls, 1, "dead subscriber must have been removed after its first failed write");

  unsubscribe();
});

test("unsubscribe stops further delivery to that writer", async () => {
  let calls = 0;
  const unsubscribe = subscribeMatrixDeltas({
    write: async () => {
      calls++;
    },
  });

  unsubscribe();
  await broadcastMatrixDelta(fakeDelta("IWM"));

  assert.equal(calls, 0, "unsubscribed writer must not receive broadcasts");
});
