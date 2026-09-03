import assert from "node:assert/strict";
import { test } from "node:test";
import { fitHelixDerivedForModel } from "@/lib/largo/helix-derived-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

test("fitHelixDerivedForModel caps panels and stays under budget", () => {
  const row = (i: number) => ({
    ticker: "SPX",
    premium: 2_000_000,
    detail: "x".repeat(400),
    position_intent: { verdict: "opening", note: "y".repeat(200) },
    id: i,
  });
  const raw = {
    available: true,
    prints_analyzed: 400,
    stacked_hits: Array.from({ length: 20 }, (_, i) => row(i)),
    stacked_hits_total: 20,
    stacked_hits_truncated: true,
    top_prints: Array.from({ length: 12 }, (_, i) => row(i)),
    top_prints_total: 12,
    top_prints_truncated: true,
    velocity_spikes: Array.from({ length: 10 }, (_, i) => row(i)),
    velocity_spikes_total: 10,
    velocity_spikes_truncated: true,
    split_flow: Array.from({ length: 10 }, (_, i) => row(i)),
    split_flow_total: 10,
    split_flow_truncated: true,
  };
  const { fitted } = fitHelixDerivedForModel(raw);
  assert.ok((fitted.stacked_hits as unknown[]).length <= 10);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});
