import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { flowCompositeKey, findMatchingFlow, mergeFlowAlerts } from "@/features/helix/lib/helix-flow-merge";
import type { FlowAlert } from "@/lib/api";

// This module had NO tests before 2026-08-23, while owning the rule that decides whether two rows
// are the same print — read by the HELIX tape, the SSE↔REST merge, and the Vector desk's flow hook.

const flow = (over: Partial<FlowAlert> = {}): FlowAlert =>
  ({
    ticker: "NVDA", strike: 180, option_type: "CALL", premium: 1_000_000,
    expiry: "2026-08-28", direction: "bullish", score: 60, route: "sweep",
    alerted_at: "2026-08-21T18:00:00.000Z",
    ...over,
  }) as FlowAlert;

test("the composite key ignores sub-second precision, which is the whole point", () => {
  // SSE and REST stamp the same print with different milliseconds. Matching on the full ISO string
  // would miss exactly the pair this key exists to find.
  const a = flow({ alerted_at: "2026-08-21T18:00:00.000Z" });
  const b = flow({ alerted_at: "2026-08-21T18:00:00.847Z" });
  assert.equal(flowCompositeKey(a), flowCompositeKey(b));
});

test("the composite key separates prints that differ in any identity field", () => {
  const base = flow();
  for (const over of [
    { ticker: "AMD" },
    { strike: 185 },
    { option_type: "PUT" },
    { alerted_at: "2026-08-21T18:00:01.000Z" },
  ]) {
    assert.notEqual(flowCompositeKey(flow(over)), flowCompositeKey(base), JSON.stringify(over));
  }
});

test("a missing time yields a stable key rather than throwing", () => {
  assert.equal(flowCompositeKey(flow({ alerted_at: null })), flowCompositeKey(flow({ alerted_at: undefined })));
});

test("findMatchingFlow prefers alert_id, then falls back to the composite", () => {
  const rows = [flow({ alert_id: "a1", ticker: "AMD" }), flow({ alert_id: "b2" })];
  // alert_id wins even when the composite would point elsewhere.
  assert.equal(findMatchingFlow(rows, flow({ alert_id: "a1", ticker: "NVDA" })), 0);
  // No id on the incoming row: DB-served REST rows carry none, so the composite is the only match.
  assert.equal(findMatchingFlow(rows, flow({ alerted_at: "2026-08-21T18:00:00.500Z" })), 1);
  assert.equal(findMatchingFlow(rows, flow({ ticker: "TSLA" })), -1);
});

test("an alert_id that matches nothing falls through to the composite, not to -1", () => {
  // A reconnect can deliver an id the current buffer has never seen while the print itself is
  // already there. Returning -1 would insert a duplicate.
  const rows = [flow({ alert_id: "b2" })];
  assert.equal(findMatchingFlow(rows, flow({ alert_id: "unseen" })), 0);
});

test("mergeFlowAlerts fills sparse SSE fields from the richer REST row", () => {
  const sse = flow({ fill_price: undefined, ask_pct: undefined, score: 0 });
  const rest = flow({ fill_price: 5.2, ask_pct: 71, score: 88 });
  const merged = mergeFlowAlerts(sse, rest);
  assert.equal(merged.fill_price, 5.2);
  assert.equal(merged.ask_pct, 71);
  // `score` uses `> 0` rather than `??` because the SSE row sends 0, not undefined.
  assert.equal(merged.score, 88);
});

test("mergeFlowAlerts keeps a present primary value, including a legitimate zero", () => {
  const merged = mergeFlowAlerts(flow({ ask_pct: 0 }), flow({ ask_pct: 71 }));
  // 0% at-ask is a real measurement (fully bid-side), not an absence — `??` must keep it.
  assert.equal(merged.ask_pct, 0);
});

test("mergeFlowAlerts with no fallback returns the primary untouched", () => {
  const sse = flow();
  assert.deepEqual(mergeFlowAlerts(sse, null), sse);
  assert.deepEqual(mergeFlowAlerts(sse, undefined), sse);
});

// ── RATCHET ───────────────────────────────────────────────────────────────────────────────────
//
// The composite existed FOUR times in three files, all byte-identical — so no value test could
// have caught it, and none did. Same situation #2720 was written for: when every copy agrees, the
// defect is the SHAPE of the lane. This asserts the shape.
test("no HELIX file re-implements the composite key inline", () => {
  const roots = ["src/features/helix/lib", "src/features/helix/components"];
  const OWNER = "helix-flow-merge.ts";
  const INLINE = /option_type\}\|\$\{String\(/;
  const offenders: string[] = [];
  let scanned = 0;

  for (const dir of roots) {
    for (const name of readdirSync(dir)) {
      if (!/\.tsx?$/.test(name) || name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
      scanned++;
      if (name === OWNER) continue;
      if (INLINE.test(readFileSync(join(dir, name), "utf8"))) offenders.push(name);
    }
  }

  // A ratchet that silently scans nothing passes forever — the exact way #2720's first version
  // broke (globSync is Node 22+ and returned undefined under Node 20).
  assert.ok(scanned > 20, `expected to scan the HELIX lane, only saw ${scanned} files`);
  assert.deepEqual(
    offenders,
    [],
    `these re-implement flowCompositeKey inline — import it from ${OWNER} instead: ${offenders.join(", ")}`
  );
});
