import test from "node:test";
import assert from "node:assert/strict";
import {
  isSocketHealthSkipped,
  isCronRunHealthyStatus,
  socketProbeAttemptVerdict,
  socketProbeFinalFailure,
  probeOptionsSocketWithRetries,
} from "./rth-socket-probe.mjs";

test("isSocketHealthSkipped: NYSE holiday skip payload passes", () => {
  assert.equal(
    isSocketHealthSkipped({ ok: true, skipped: true, reason: "non-trading day (2026-09-07)" }),
    true
  );
  assert.equal(isSocketHealthSkipped({ ok: true, websockets: {} }), false);
});

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

test("probeOptionsSocketWithRetries: warming then green passes", async () => {
  let calls = 0;
  const result = await probeOptionsSocketWithRetries({
    afterOpen930: true,
    fetchSocketHealth: async () => {
      calls++;
      if (calls === 1) {
        return {
          status: 503,
          body: { websockets: { options: { ok: false, detail: "marks warming" } } },
        };
      }
      return {
        status: 200,
        body: { websockets: { options: { ok: true, detail: "cluster marks fresh" } } },
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.failure, null);
  assert.equal(result.successDetail, "cluster marks fresh");
});

test("probeOptionsSocketWithRetries: NYSE holiday skip passes without websockets", async () => {
  const result = await probeOptionsSocketWithRetries({
    afterOpen930: true,
    fetchSocketHealth: async () => ({
      status: 200,
      body: { ok: true, skipped: true, reason: "non-trading day (2026-09-07)" },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.failure, null);
  assert.match(result.successDetail ?? "", /non-trading day/);
});

test("probeOptionsSocketWithRetries: exhausted retries fail during RTH", async () => {
  const result = await probeOptionsSocketWithRetries({
    afterOpen930: true,
    maxAttempts: 2,
    fetchSocketHealth: async () => ({
      status: 503,
      body: { websockets: { options: { ok: false, detail: "still warming" } } },
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.failure ?? "", /still warming/);
});

test("isCronRunHealthyStatus: accepts ok and skipped, rejects everything else", () => {
  assert.equal(isCronRunHealthyStatus("ok"), true);
  assert.equal(isCronRunHealthyStatus("skipped"), true);
  assert.equal(isCronRunHealthyStatus("error"), false);
  assert.equal(isCronRunHealthyStatus(undefined), false);
  assert.equal(isCronRunHealthyStatus(null), false);
});
