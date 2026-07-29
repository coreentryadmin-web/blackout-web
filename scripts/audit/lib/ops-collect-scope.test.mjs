import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseOpsCollectPayload, gridOpsItems, spxOpsItems } from "./ops-collect-scope.mjs";

describe("parseOpsCollectPayload", () => {
  it("parses JSON line from stdout with stderr postgres skip", () => {
    const payload = parseOpsCollectPayload(
      '{"count":0,"items":[]}\n',
      "[ops-collect] Postgres audit skipped (private VPC URL)\n"
    );
    assert.equal(payload?.count, 0);
  });
});

describe("spxOpsItems", () => {
  const items = [
    { id: "correctness:flags", priority: "P0", title: "SPX gex mismatch", detail: "desk layer" },
    { id: "watchdog:problem:flow-ingest", priority: "P1", title: "Cron health", detail: "stale" },
    { id: "correctness:flags", priority: "P0", title: "SPY net_premium", detail: "grid layer" },
  ];

  it("keeps SPX-layer correctness flags", () => {
    const scoped = spxOpsItems(items);
    assert.equal(scoped.length, 1);
    assert.match(scoped[0].title, /SPX gex/);
  });
});

describe("gridOpsItems", () => {
  const items = [
    { id: "correctness:flags", priority: "P0", title: "zerodte board", detail: "grid layer" },
    { id: "watchdog:problem:spx-evaluate", priority: "P1", title: "SPX cron", detail: "stale" },
  ];

  it("keeps grid/zerodte items only", () => {
    const scoped = gridOpsItems(items);
    assert.equal(scoped.length, 1);
    assert.match(scoped[0].title, /zerodte/);
  });
});
