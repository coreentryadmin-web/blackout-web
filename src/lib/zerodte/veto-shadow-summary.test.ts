import test from "node:test";
import assert from "node:assert/strict";
import { buildVetoShadowSummary } from "./veto-shadow-summary";

test("buildVetoShadowSummary: highlights Vector winner near-misses", () => {
  const s = buildVetoShadowSummary(
    [
      {
        ticker: "NVDA",
        block_code: "cortex_gex_walls_oppose_unresolved",
        block_label: "cortex gex walls",
        block_reason: "x",
        vector_premium_pct: 80,
        vector_peak_pct: 90,
        vector_band: "winner",
      },
    ],
    {
      detected_tickers: 40,
      gate_blocked_events: 100,
      commit_events: 2,
      top_gate: "cortex_gex_walls_oppose_unresolved",
      top_gate_label: "Cortex gex walls",
      top_gate_n: 20,
      summary: null,
    },
    {
      scanned: 10,
      commit_ready: 2,
      gate_blocked: 5,
      committed_open: 1,
      committed_closed: 0,
      top_block_code: null,
      top_block_label: null,
    }
  );
  assert.equal(s?.vector_winner_misses, 1);
  assert.match(s?.summary ?? "", /1 Vector winner/);
});
