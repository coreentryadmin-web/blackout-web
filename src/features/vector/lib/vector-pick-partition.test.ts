import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergeArchivedClosedPicks,
  partitionVectorPicksByLiveStatus,
  renumberPickRanks,
} from "./vector-pick-partition";
import type { VectorContractPick } from "./vector-contract-picks";

function pick(
  rank: number,
  status?: VectorContractPick["actionStatus"],
  occ?: string
): VectorContractPick {
  return {
    side: "call",
    strike: 100 + rank,
    expiry: "2026-09-05",
    label: `${100 + rank}C 09/05`,
    premium: 4,
    confidence: 70,
    rank,
    occ: occ ?? `OCC${rank}`,
    actionStatus: status,
  };
}

test("partition: dont_buy picks go to closed; next ranks backfill active", () => {
  const pool = [
    pick(1, "dont_buy", "A"),
    pick(2, "still_buy", "B"),
    pick(3, "still_buy", "C"),
    pick(4, "still_buy", "D"),
  ];
  const { active, closed } = partitionVectorPicksByLiveStatus(pool);
  assert.equal(closed.length, 1);
  assert.equal(closed[0]!.occ, "A");
  assert.deepEqual(
    active.map((p) => p.occ),
    ["B", "C", "D"]
  );
  assert.deepEqual(
    active.map((p) => p.rank),
    [1, 2, 3]
  );
});

test("partition: pending status (no live read yet) stays in active slots", () => {
  const pool = [pick(1), pick(2, "caution"), pick(3, "still_buy")];
  const { active, closed } = partitionVectorPicksByLiveStatus(pool);
  assert.equal(closed.length, 0);
  assert.equal(active.length, 3);
});

test("mergeArchivedClosed: keeps invalidated pick visible after pool refresh drops it", () => {
  const archived = [pick(1, "dont_buy", "DEAD")];
  const fresh = partitionVectorPicksByLiveStatus([
    pick(1, "still_buy", "NEW1"),
    pick(2, "still_buy", "NEW2"),
  ]);
  const merged = mergeArchivedClosedPicks(fresh, archived);
  assert.ok(merged.closed.some((p) => p.occ === "DEAD"));
  assert.deepEqual(
    merged.active.map((p) => p.occ),
    ["NEW1", "NEW2"]
  );
});

test("renumberPickRanks assigns 1..n", () => {
  const out = renumberPickRanks([pick(4), pick(9)]);
  assert.deepEqual(
    out.map((p) => p.rank),
    [1, 2]
  );
});
