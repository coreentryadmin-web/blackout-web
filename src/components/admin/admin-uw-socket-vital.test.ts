import assert from "node:assert/strict";
import { test } from "node:test";
import { uwSocketVitalDisplay } from "./admin-uw-socket-vital";

// Regression (DISCOVERY sweep round 178) — see admin-uw-socket-vital.ts's header comment for the
// full root cause. Short version: `AdminOperationsDashboard`'s "System Vitals" UW Socket row used
// to show "Live" for any initialized socket, even one stuck in `auth_failed`, while its status
// dot correctly turned red for that same state — a contradictory, misleading tile. The sibling
// `DataPipelineHealthTile`'s own UW Socket row already distinguished "Auth Failed" from "Live";
// this fixes the System Vitals row to agree.

test("uwSocketVitalDisplay: REGRESSION — initialized+auth_failed must read 'Auth Failed', not 'Live'", () => {
  const d = uwSocketVitalDisplay({ initialized: true, auth_failed: true });
  assert.deepEqual(d, { value: "Auth Failed", ok: false });
});

test("uwSocketVitalDisplay: initialized+clean reads 'Live' / ok", () => {
  const d = uwSocketVitalDisplay({ initialized: true, auth_failed: false });
  assert.deepEqual(d, { value: "Live", ok: true });
});

test("uwSocketVitalDisplay: not initialized reads 'Offline' / not ok, regardless of auth_failed", () => {
  assert.deepEqual(uwSocketVitalDisplay({ initialized: false, auth_failed: false }), {
    value: "Offline",
    ok: false,
  });
  assert.deepEqual(uwSocketVitalDisplay({ initialized: false, auth_failed: true }), {
    value: "Offline",
    ok: false,
  });
});

test("uwSocketVitalDisplay: null/undefined health reads the neutral '—' / unknown state", () => {
  assert.deepEqual(uwSocketVitalDisplay(null), { value: "—", ok: null });
  assert.deepEqual(uwSocketVitalDisplay(undefined), { value: "—", ok: null });
});
