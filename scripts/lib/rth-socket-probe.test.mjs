import test from "node:test";
import assert from "node:assert/strict";
import { socketProbeAttemptVerdict, socketProbeFinalFailure } from "./rth-socket-probe.mjs";

test("socketProbeAttemptVerdict: warming response retries during RTH", () => {
  const warming = { ok: false, detail: "ingest leader lock held — marks warming" };
  assert.equal(socketProbeAttemptVerdict(warming, true), "retry");
});

test("socketProbeAttemptVerdict: green response passes immediately", () => {
  const fresh = { ok: true, detail: "cluster marks fresh (age 1200ms)" };
  assert.equal(socketProbeAttemptVerdict(fresh, true), "pass");
});

test("socketProbeFinalFailure: no failure when a later retry succeeded", () => {
  const warming = "no fresh cluster option marks and no ingest leader";
  assert.equal(socketProbeFinalFailure(true, warming, true), null);
});

test("socketProbeFinalFailure: fails only after all retries exhausted", () => {
  const detail = "no fresh cluster option marks and no ingest leader";
  assert.equal(
    socketProbeFinalFailure(false, detail, true),
    "options-socket: no fresh cluster option marks and no ingest leader"
  );
});

test("socketProbeFinalFailure: pre-09:30 does not hard-fail", () => {
  assert.equal(socketProbeFinalFailure(false, "warming", false), null);
});
