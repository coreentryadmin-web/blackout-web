import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { shouldFallBackToEscalationModel } from "@/lib/providers/anthropic";

/**
 * ROUND-0 ESCALATION-MODEL FALLBACK (#2582). When the primary Largo model degrades (529 overloaded /
 * 429 / timeout), round 0's create/stream throws and the loop returns null → the "couldn't pull
 * enough live data" empty-answer fallback. Retrying round 0 once on LARGO_ESCALATION_MODEL rides out
 * a single-model outage. The decision is a pure predicate; the wiring is source-asserted (the loop's
 * client is not injectable — same convention as anthropic-cache/stream-guard tests).
 */

test("fires on a round-0 failure when the escalation model differs", () => {
  assert.equal(
    shouldFallBackToEscalationModel({
      round: 0,
      alreadyTried: false,
      activeModel: "claude-sonnet-5",
      escalationModel: "claude-sonnet-4-6",
    }),
    true
  );
});

test("does NOT fire past round 0 — a mid-loop swap would hand the escalation model a partial transcript", () => {
  assert.equal(
    shouldFallBackToEscalationModel({
      round: 1,
      alreadyTried: false,
      activeModel: "claude-sonnet-5",
      escalationModel: "claude-sonnet-4-6",
    }),
    false
  );
});

test("fires at most once per turn (no retry storm on a persistent outage)", () => {
  assert.equal(
    shouldFallBackToEscalationModel({
      round: 0,
      alreadyTried: true,
      activeModel: "claude-sonnet-4-6",
      escalationModel: "claude-sonnet-4-6",
    }),
    false
  );
});

test("does NOT fire when the escalation model is the same as the one that just failed (would re-hit the outage)", () => {
  assert.equal(
    shouldFallBackToEscalationModel({
      round: 0,
      alreadyTried: false,
      activeModel: "claude-sonnet-4-6",
      escalationModel: "claude-sonnet-4-6",
    }),
    false
  );
});

test("does NOT fire when no escalation model is configured", () => {
  for (const escalationModel of [null, undefined, ""]) {
    assert.equal(
      shouldFallBackToEscalationModel({ round: 0, alreadyTried: false, activeModel: "claude-sonnet-5", escalationModel }),
      false
    );
  }
});

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "anthropic.ts"), "utf8");

test("BOTH round-call branches wire the fallback (the member path streams — it must be on the stream branch too)", () => {
  // The browser terminal always uses the streaming branch (route.ts), so a fallback only on the
  // non-stream branch would never help a member. Both catch blocks must swap the model and retry.
  const wired = SRC.match(/shouldFallBackToEscalationModel\(\{[\s\S]*?\}\)/g) ?? [];
  assert.ok(wired.length >= 2, `expected the fallback wired in both stream + non-stream catches, found ${wired.length}`);
  // And the retry re-runs round 0 (round--) on the escalation model, not advance past it.
  assert.match(SRC, /activeModel = LARGO_ESCALATION_MODEL;\s*\n\s*round--;/);
});
