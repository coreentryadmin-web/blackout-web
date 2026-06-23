import { test } from "node:test";
import assert from "node:assert/strict";
import { tapeDedupKey } from "./tape-dedup-key";

test("key shape is kind|time|label (premium excluded)", () => {
  assert.equal(tapeDedupKey({ kind: "flow", time: "09:31", label: "CALL 5500" }), "flow|09:31|CALL 5500");
});

test("differing kind/time/label produce distinct keys", () => {
  const base = { kind: "flow", time: "T", label: "L" };
  assert.notEqual(tapeDedupKey(base), tapeDedupKey({ ...base, kind: "darkpool" }));
  assert.notEqual(tapeDedupKey(base), tapeDedupKey({ ...base, time: "T2" }));
  assert.notEqual(tapeDedupKey(base), tapeDedupKey({ ...base, label: "L2" }));
});

test("behavioral: first-seen [...incoming,...prev] keeps the latest premium", () => {
  type Item = { kind: string; time: string; label: string; premium: number };
  const prev: Item[] = [{ kind: "flow", time: "T", label: "PUT 5400", premium: 100 }];
  const incoming: Item[] = [{ kind: "flow", time: "T", label: "PUT 5400", premium: 250 }];
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const t of [...incoming, ...prev]) {
    const key = tapeDedupKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  assert.equal(out.length, 1);
  assert.equal(out[0].premium, 250);
});
