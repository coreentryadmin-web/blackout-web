import { test } from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import { mergeFlowTapeHead, appendFlowTapePage } from "./helix-flow-tape-merge";

/**
 * `flow-persist.ts` publishes the live SSE row with `alerted_at = realCreatedAt ?? ""`. Its comment
 * claimed the empty value made the UI exclude the row from sort. Nothing excluded it —
 * `flowTimeSortKey` returned 0, and on a newest-first tape 0 is 1970.
 */

const row = (alert_id: string, alerted_at: string): FlowAlert =>
  ({ alert_id, ticker: "SPX", strike: 6000, option_type: "CALL", premium: 1_000_000, alerted_at }) as FlowAlert;

const DATED = [row("a", "2026-08-21T14:00:00Z"), row("b", "2026-08-21T13:00:00Z")];

test("a brand-new undated print lands FIRST on the head, not last — the defect", () => {
  // Before: index 2 of 3, i.e. the oldest position on the tape, for a print that just arrived.
  const merged = mergeFlowTapeHead(DATED, [row("NEW", "")]);
  assert.equal(merged[0]!.alert_id, "NEW");
  assert.equal(merged.length, 3);
});

test("an unparseable timestamp is treated the same as an absent one", () => {
  // `new Date("not-a-time")` is NaN, which the old code also collapsed to 0.
  const merged = mergeFlowTapeHead(DATED, [row("JUNK", "not-a-time")]);
  assert.equal(merged[0]!.alert_id, "JUNK");
});

test("dated rows still sort strictly newest-first", () => {
  const merged = mergeFlowTapeHead(
    [row("old", "2026-08-21T10:00:00Z")],
    [row("new", "2026-08-21T16:00:00Z"), row("mid", "2026-08-21T12:00:00Z")]
  );
  assert.deepEqual(merged.map((r) => r.alert_id), ["new", "mid", "old"]);
});

test("an undated row in an OLDER page goes to the bottom — the opposite placement", () => {
  // appendFlowTapePage is documented as "rows strictly older than what we already hold", so the
  // same row belongs at the other end. One sentinel number could not have served both callers,
  // which is why the sort key reports null instead of picking one.
  const merged = appendFlowTapePage(DATED, [row("OLDER", "")]);
  assert.equal(merged[merged.length - 1]!.alert_id, "OLDER");
});

test("multiple undated rows keep their relative order — the merge stays deterministic", () => {
  const merged = mergeFlowTapeHead(DATED, [row("n1", ""), row("n2", "")]);
  assert.deepEqual(merged.slice(0, 2).map((r) => r.alert_id), ["n1", "n2"]);
});

test("an all-undated tape does not throw and preserves insertion order", () => {
  const merged = mergeFlowTapeHead([row("x", "")], [row("y", "")]);
  assert.deepEqual(merged.map((r) => r.alert_id), ["x", "y"]);
});

test("dedupe still merges the same print arriving twice", () => {
  // The undated row must not become a way to duplicate a print already on the tape.
  const merged = mergeFlowTapeHead([row("a", "2026-08-21T14:00:00Z")], [row("a", "")]);
  assert.equal(merged.length, 1);
  // ...and the merge keeps the real time rather than adopting the empty one.
  assert.equal(merged[0]!.alerted_at, "2026-08-21T14:00:00Z");
});
