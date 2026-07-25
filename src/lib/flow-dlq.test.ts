import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deadLetter,
  getDeadLetters,
  deadLetterStats,
  drainDeadLetters,
  withDeadLetter,
} from "./flow-dlq";

test("deadLetter records a bounded, stringified entry", () => {
  drainDeadLetters();
  deadLetter("flow_alerts", { alert_id: "uw:x", premium: 250000 }, "unparseable", 1_234);
  const entries = getDeadLetters();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].channel, "flow_alerts");
  assert.equal(entries[0].reason, "unparseable");
  assert.equal(entries[0].at, 1_234);
  assert.ok(entries[0].raw.includes("uw:x"));
});

test("a poison message is captured WITHOUT breaking ingest of surrounding good messages", () => {
  drainDeadLetters();
  const messages = [
    { id: "good1", bad: false },
    { id: "poison", bad: true },
    { id: "good2", bad: false },
  ];
  const ingested: string[] = [];
  for (const msg of messages) {
    // Simulate an ingest loop: a poison message throws inside processing.
    withDeadLetter("flow_alerts", msg, () => {
      if (msg.bad) throw new Error("poison row");
      ingested.push(msg.id);
    });
  }
  // The good messages both ingested; the poison one was dead-lettered, not thrown.
  assert.deepEqual(ingested, ["good1", "good2"]);
  const dl = getDeadLetters();
  assert.equal(dl.length, 1);
  assert.equal(dl[0].reason, "poison row");
  assert.ok(dl[0].raw.includes("poison"));
});

test("deadLetter never throws, even on a circular / unstringifiable payload", () => {
  drainDeadLetters();
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.doesNotThrow(() => deadLetter("flow_alerts", circular, "circular"));
  assert.equal(getDeadLetters().length, 1);
});

test("deadLetterStats tracks lifetime total and buffered count", () => {
  drainDeadLetters();
  const before = deadLetterStats().total;
  deadLetter("a", {}, "r1", 10);
  deadLetter("b", {}, "r2", 20);
  const stats = deadLetterStats();
  assert.equal(stats.buffered, 2);
  assert.equal(stats.total, before + 2);
  assert.equal(stats.newest_at, 20);
});
