import test from "node:test";
import assert from "node:assert/strict";
import { liveMarkBriefSig } from "./play-brief-live-sig";

test("liveMarkBriefSig: empty when stale", () => {
  assert.equal(liveMarkBriefSig({ mark: 9.7, live_pnl_pct: 98, live_pnl_pct_exec: 80, status: "HOLD", stale: true }), "");
});

test("liveMarkBriefSig: stable JSON for mark/pnl/status", () => {
  const sig = liveMarkBriefSig({ mark: 9.7, live_pnl_pct: 98, live_pnl_pct_exec: 80, status: "HOLD", stale: false });
  assert.match(sig, /9\.7/);
  assert.match(sig, /98/);
  assert.match(sig, /HOLD/);
});
