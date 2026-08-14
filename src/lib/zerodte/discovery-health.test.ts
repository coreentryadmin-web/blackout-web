import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_HEALTH_LANES,
  anyLaneDegraded,
  initialDiscoveryHealth,
  laneStatusFromBreakoutOutcome,
  type DiscoveryHealth,
} from "./discovery-health.ts";

function health(over: Partial<DiscoveryHealth> = {}): DiscoveryHealth {
  return { ...initialDiscoveryHealth(), ...over };
}

test("initialDiscoveryHealth starts every lane disabled with zero setups", () => {
  const h = initialDiscoveryHealth();
  for (const lane of DISCOVERY_HEALTH_LANES) {
    assert.equal(h[lane].status, "disabled", `${lane} must not start as ok`);
    assert.equal(h[lane].setups, 0);
  }
});

test("initialDiscoveryHealth returns a FRESH object each call (no shared mutable default)", () => {
  // scan.ts mutates this per scan pass. A shared singleton would leak one pass's lane status into
  // the next board build — a provenance field that lies is worse than no provenance field.
  const a = initialDiscoveryHealth();
  const b = initialDiscoveryHealth();
  a.PIN = { status: "failed", setups: 0 };
  assert.equal(b.PIN.status, "disabled");
});

test("laneStatusFromBreakoutOutcome maps every known outcome status", () => {
  assert.equal(laneStatusFromBreakoutOutcome("ok"), "ok");
  assert.equal(laneStatusFromBreakoutOutcome("skip_off_hours"), "off_hours");
  assert.equal(laneStatusFromBreakoutOutcome("skip_empty_market"), "empty_market");
  assert.equal(laneStatusFromBreakoutOutcome("data_unavailable"), "data_unavailable");
});

test("laneStatusFromBreakoutOutcome sends an UNKNOWN status to failed, not through", () => {
  // The whole point of the explicit table: a status added upstream must surface as an absence a
  // reader notices, never as a string that silently means nothing downstream.
  assert.equal(laneStatusFromBreakoutOutcome("some_future_status"), "failed");
  assert.equal(laneStatusFromBreakoutOutcome(""), "failed");
});

test("anyLaneDegraded is false when both lanes ran, including a genuine zero", () => {
  // A lane that ran and found nothing is a real market read — it must NOT raise degradation.
  assert.equal(
    anyLaneDegraded(health({ BREAKOUT: { status: "ok", setups: 0 }, PIN: { status: "ok", setups: 0 } })),
    false
  );
});

test("anyLaneDegraded is false for CONFIGURED absences (disabled / off_hours)", () => {
  assert.equal(anyLaneDegraded(initialDiscoveryHealth()), false, "all-disabled is configuration, not failure");
  assert.equal(
    anyLaneDegraded(health({ BREAKOUT: { status: "off_hours", setups: 0 }, PIN: { status: "off_hours", setups: 0 } })),
    false
  );
});

test("anyLaneDegraded is true when a lane could not see", () => {
  for (const status of ["data_unavailable", "failed", "empty_market"] as const) {
    assert.equal(
      anyLaneDegraded(health({ BREAKOUT: { status, setups: 0 } })),
      true,
      `${status} must count as degraded`
    );
  }
});

test("anyLaneDegraded fires even when the OTHER lane is healthy", () => {
  // The failure this field exists for: a roster that shrank ~75% because ONE lane went dark while
  // the rest of the board kept serving normally.
  const h = health({ BREAKOUT: { status: "failed", setups: 0 }, PIN: { status: "ok", setups: 12 } });
  assert.equal(anyLaneDegraded(h), true);
});

test("a lane's reason is preserved for the fail-closed case", () => {
  const h = health({ BREAKOUT: { status: "data_unavailable", setups: 0, reason: "stale_snapshot" } });
  assert.equal(h.BREAKOUT.reason, "stale_snapshot");
  assert.equal(anyLaneDegraded(h), true);
});
