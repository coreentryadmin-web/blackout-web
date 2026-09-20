import { before, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";

// candidate-snapshot-alert.ts's only dependency is notifyOpsDiscord (spx-play-notify.ts) — mock
// it so this suite never touches a real Discord webhook and can assert exactly what was sent.
const state = {
  calls: [] as Array<{ severity?: string; title: string; body: string }>,
  shouldReject: false,
};

function resetState() {
  state.calls = [];
  state.shouldReject = false;
}

before(() => {
  mock.module("../../spx/lib/spx-play-notify", {
    namedExports: {
      notifyOpsDiscord: async (input: { severity?: string; title: string; body: string }) => {
        state.calls.push(input);
        if (state.shouldReject) throw new Error("Discord webhook unreachable");
        return true;
      },
    },
  });
});

beforeEach(resetState);

// Lazy import so the mock above is in place before candidate-snapshot-alert.ts's own top-level
// import of notifyOpsDiscord resolves (ESM caches the module under test after the first call).
async function loadAlert() {
  return import("./candidate-snapshot-alert");
}

test("alertCandidateSnapshotWriteFailure: sends a warning-severity ops alert naming the stage and edition", async () => {
  const { alertCandidateSnapshotWriteFailure } = await loadAlert();
  alertCandidateSnapshotWriteFailure("discovery", "2026-09-22", new Error("connection reset"));
  // The call is fire-and-forget (void + internal .catch()); give its microtask a tick to run.
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(state.calls.length, 1);
  const call = state.calls[0]!;
  assert.equal(call.severity, "warning");
  assert.match(call.title, /discovery/);
  assert.match(call.title, /2026-09-22/);
  assert.match(call.body, /stage=discovery/);
  assert.match(call.body, /edition_for=2026-09-22/);
  assert.match(call.body, /connection reset/);
});

test("alertCandidateSnapshotWriteFailure: a non-Error rejection reason is stringified, never fabricated", async () => {
  const { alertCandidateSnapshotWriteFailure } = await loadAlert();
  alertCandidateSnapshotWriteFailure("rank_final", "2026-09-23", "plain string rejection");
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(state.calls.length, 1);
  assert.match(state.calls[0]!.body, /plain string rejection/);
});

test("alertCandidateSnapshotWriteFailure: never throws, even when notifyOpsDiscord itself rejects", async () => {
  state.shouldReject = true;
  const { alertCandidateSnapshotWriteFailure } = await loadAlert();
  // Must not throw synchronously, and the unhandled-rejection path must be caught internally
  // (the function's own .catch(() => undefined)) rather than escaping to the caller.
  assert.doesNotThrow(() => {
    alertCandidateSnapshotWriteFailure("rejected", "2026-09-24", new Error("boom"));
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(state.calls.length, 1, "notifyOpsDiscord was still attempted despite rejecting");
});

test("alertCandidateSnapshotWriteFailure: is fire-and-forget -- returns void, not a Promise the caller must handle", async () => {
  const { alertCandidateSnapshotWriteFailure } = await loadAlert();
  const result = alertCandidateSnapshotWriteFailure("rejected:cross_edition_governor", "2026-09-25", new Error("x"));
  assert.equal(result, undefined);
  await new Promise((r) => setTimeout(r, 0));
});
