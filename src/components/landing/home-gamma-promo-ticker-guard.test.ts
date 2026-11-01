import assert from "node:assert/strict";
import { test } from "node:test";
import { runGuardedTickerLoad } from "./home-gamma-promo-ticker-guard";

/**
 * Regression (round 240, DISCOVERY lane): `HomeGammaPromo`'s `loadTicker` had no protection
 * against out-of-order resolution between its 5s background poll and a manual ticker-pill click.
 * Clicking QQQ while an SPX poll tick is still in flight starts a second, concurrent fetch for
 * QQQ. Network timing decides which settles LAST, not click order. If the SPX poll's response
 * arrives after the QQQ click's, the old code did `setSnapshot(spxData)` unconditionally,
 * overwriting the already-correct QQQ data with SPX's — while the "QQQ" tab stayed visibly
 * selected. `runGuardedTickerLoad` is the extracted guard that now wraps every call, proven here
 * directly against the real exported function with no React rendering: an older ticker's request
 * resolves AFTER a newer one, and the final applied state must still be the newer ticker's.
 */

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test("runGuardedTickerLoad: an older ticker's response resolving AFTER a newer one does not overwrite it", async () => {
  let wanted = "SPX";
  const getWantedTicker = () => wanted;

  const reqSpx = deferred<{ ticker: string }>(); // older, slower (background poll)
  const reqQqq = deferred<{ ticker: string }>(); // newer, faster (member's click)

  let applied: { ticker: string } | null = null;

  // Background poll tick for the currently-shown ticker (SPX) starts first.
  const runSpx = runGuardedTickerLoad(
    "SPX",
    getWantedTicker,
    () => reqSpx.promise,
    (d) => { applied = d; }
  );

  // Member clicks QQQ before the poll resolves — this is the `wanted` ref flipping, same as
  // `loadTicker` setting `wantedTicker.current = next` synchronously before awaiting its fetch.
  wanted = "QQQ";
  const runQqq = runGuardedTickerLoad(
    "QQQ",
    getWantedTicker,
    () => reqQqq.promise,
    (d) => { applied = d; }
  );

  // The member's own click resolves FIRST (it's a fresh request; the stale poll is still pending).
  reqQqq.resolve({ ticker: "QQQ" });
  await runQqq;
  assert.deepEqual(applied, { ticker: "QQQ" });

  // The stale SPX poll resolves LAST — this is the exact ordering that exposed the bug. It must
  // be dropped, never repainting SPX numbers under the QQQ tab the member already selected.
  reqSpx.resolve({ ticker: "SPX" });
  await runSpx;
  assert.deepEqual(
    applied,
    { ticker: "QQQ" },
    "a stale SPX response resolving after the QQQ click must not overwrite the already-applied QQQ data"
  );
});

test("runGuardedTickerLoad: a response for the still-current ticker is applied normally", async () => {
  const wanted = "SPY";
  let applied: string | null = null;
  await runGuardedTickerLoad(
    "SPY",
    () => wanted,
    async () => "SPY_DATA",
    (d) => { applied = d; }
  );
  assert.equal(applied, "SPY_DATA");
});
