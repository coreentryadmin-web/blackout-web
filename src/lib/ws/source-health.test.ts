import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeSourceHealth,
  requireHealthySourceEnabled,
  commitAuthorizedBySourceHealth,
} from "./source-health";

test("state machine walks OFFLINE → RECOVERING → CATCHING_UP → WARM → HEALTHY", () => {
  let t = 1_000;
  const h = makeSourceHealth({ warmMs: 100 });
  assert.equal(h.snapshot().state, "OFFLINE");

  h.onReconnecting(t);
  assert.equal(h.snapshot().state, "RECOVERING");
  assert.equal(h.snapshot().reconnect_count, 1);

  h.onConnected((t += 10));
  assert.equal(h.snapshot().state, "CATCHING_UP");

  // Live frames during CATCHING_UP do NOT warm until catch-up completes.
  h.recordLiveFrame((t += 10));
  assert.equal(h.snapshot().state, "CATCHING_UP");

  h.completeCatchUp((t += 10), { at: t, backfilled: 3, duplicates: 2, window_start_ms: 500 });
  assert.equal(h.snapshot().state, "WARM");
  assert.equal(h.snapshot().last_reconcile?.backfilled, 3);

  // Still WARM until the warm window elapses.
  h.recordLiveFrame((t += 10));
  assert.equal(h.snapshot().state, "WARM");

  // Past warmMs → HEALTHY.
  h.recordLiveFrame((t += 200));
  assert.equal(h.snapshot().state, "HEALTHY");
  assert.equal(h.snapshot().healthy, true);
});

test("a disconnect resets to OFFLINE and clears warm progress", () => {
  let t = 0;
  const h = makeSourceHealth({ warmMs: 0 });
  h.onConnected((t += 10));
  h.completeCatchUp((t += 10), null);
  h.recordLiveFrame((t += 10));
  assert.equal(h.snapshot().state, "HEALTHY");

  h.onDisconnect((t += 10));
  assert.equal(h.snapshot().state, "OFFLINE");
  assert.equal(h.snapshot().healthy, false);
});

test("recordConfirmedProviderTs keeps the monotonic max", () => {
  const h = makeSourceHealth();
  h.recordConfirmedProviderTs(100);
  h.recordConfirmedProviderTs(50); // older — ignored
  h.recordConfirmedProviderTs(NaN); // invalid — ignored
  h.recordConfirmedProviderTs(200);
  assert.equal(h.snapshot().last_confirmed_provider_ts, 200);
});

test("requireHealthySourceEnabled is DEFAULT-OFF (only exact \"1\" enables)", () => {
  assert.equal(requireHealthySourceEnabled({} as NodeJS.ProcessEnv), false);
  assert.equal(requireHealthySourceEnabled({ ZERODTE_REQUIRE_HEALTHY_SOURCE: "0" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(requireHealthySourceEnabled({ ZERODTE_REQUIRE_HEALTHY_SOURCE: "true" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(requireHealthySourceEnabled({ ZERODTE_REQUIRE_HEALTHY_SOURCE: "1" } as unknown as NodeJS.ProcessEnv), true);
});

test("commit gate: flag OFF authorizes in EVERY state (behavior unchanged)", () => {
  for (const state of ["OFFLINE", "RECOVERING", "CATCHING_UP", "WARM", "HEALTHY"] as const) {
    const r = commitAuthorizedBySourceHealth({ state, requireHealthy: false });
    assert.equal(r.authorized, true, `flag OFF must authorize in ${state}`);
    assert.equal(r.reason, null);
  }
});

test("commit gate: flag ON withholds until HEALTHY", () => {
  for (const state of ["OFFLINE", "RECOVERING", "CATCHING_UP", "WARM"] as const) {
    const r = commitAuthorizedBySourceHealth({ state, requireHealthy: true });
    assert.equal(r.authorized, false, `flag ON must withhold in ${state}`);
    assert.ok(r.reason && r.reason.length > 0);
  }
  const healthy = commitAuthorizedBySourceHealth({ state: "HEALTHY", requireHealthy: true });
  assert.equal(healthy.authorized, true);
  assert.equal(healthy.reason, null);
});
