import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFlowDedup } from "@/lib/flow-dedup";
import {
  computeBackfillWindowStartMs,
  reconcileGap,
  DEFAULT_OVERLAP_BUFFER_MS,
  type ReconcileRow,
} from "./flow-reconciliation";

test("backfill window subtracts the overlap buffer from the last confirmed ts", () => {
  assert.equal(computeBackfillWindowStartMs(1_000_000, 5_000), 995_000);
});

test("backfill window bounds to now − buffer when cold (no confirmed ts)", () => {
  const now = 10_000_000;
  assert.equal(computeBackfillWindowStartMs(null, 60_000, now), now - 60_000);
  assert.equal(computeBackfillWindowStartMs(null, undefined, now), now - DEFAULT_OVERLAP_BUFFER_MS);
});

test("a simulated reconnect gap is REST-backfilled and deduped by alert_id", async () => {
  // The live socket confirmed up to alert a2 (provider_ts 200) before dropping. On reconnect the
  // REST backfill re-returns the overlap (a1, a2) PLUS the two frames missed during the outage
  // (a3, a4). Dedup must drop a1/a2 and process only a3/a4 exactly once.
  const dedup = makeFlowDedup();
  const alreadySeen = ["uw:a1", "uw:a2"];
  const now = 1_000;
  for (const id of alreadySeen) dedup.seen(id, now); // live path already saw these

  type Row = ReconcileRow & { premium: number };
  const rest: Row[] = [
    { alert_id: "uw:a1", provider_ts: 100, premium: 250_000 },
    { alert_id: "uw:a2", provider_ts: 200, premium: 300_000 },
    { alert_id: "uw:a3", provider_ts: 300, premium: 400_000 }, // missed during outage
    { alert_id: "uw:a4", provider_ts: 400, premium: 500_000 }, // missed during outage
  ];

  const processed: string[] = [];
  const result = await reconcileGap<Row>({
    windowStartMs: computeBackfillWindowStartMs(200, 5_000),
    fetchSince: async () => rest,
    dedup,
    process: (row) => {
      processed.push(row.alert_id);
    },
    now,
  });

  assert.deepEqual(processed, ["uw:a3", "uw:a4"], "only the gap frames are processed");
  assert.equal(result.fetched, 4);
  assert.equal(result.backfilled, 2);
  assert.equal(result.duplicates, 2);
  assert.equal(result.errored, 0);
  assert.equal(result.newestProviderTs, 400);
});

test("reconcileGap is idempotent — a second pass reports all rows as duplicates", async () => {
  const dedup = makeFlowDedup();
  type Row = ReconcileRow;
  const rest: Row[] = [
    { alert_id: "uw:x1", provider_ts: 10 },
    { alert_id: "uw:x2", provider_ts: 20 },
  ];
  const opts = { windowStartMs: 0, fetchSince: async () => rest, dedup, process: () => {}, now: 5 };

  const first = await reconcileGap<Row>(opts);
  assert.equal(first.backfilled, 2);
  assert.equal(first.duplicates, 0);

  const second = await reconcileGap<Row>({ ...opts, now: 6 });
  assert.equal(second.backfilled, 0);
  assert.equal(second.duplicates, 2);
});

test("a poison row is isolated and counted, never aborting the backfill", async () => {
  const dedup = makeFlowDedup();
  type Row = ReconcileRow;
  const rest: Row[] = [
    { alert_id: "uw:g1", provider_ts: 1 },
    { alert_id: "uw:poison", provider_ts: 2 },
    { alert_id: "uw:g2", provider_ts: 3 },
  ];
  const processed: string[] = [];
  const result = await reconcileGap<Row>({
    windowStartMs: 0,
    fetchSince: async () => rest,
    dedup,
    process: (row) => {
      if (row.alert_id === "uw:poison") throw new Error("boom");
      processed.push(row.alert_id);
    },
    now: 0,
  });
  assert.deepEqual(processed, ["uw:g1", "uw:g2"], "good rows still processed around the poison one");
  assert.equal(result.backfilled, 2);
  assert.equal(result.errored, 1);
});
