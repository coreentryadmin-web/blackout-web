import { test } from "node:test";
import assert from "node:assert/strict";
import {
  healthOf,
  marketPhaseFromEt,
  buildIntelligenceStatus,
  formatDataAge,
  dataAgeHealth,
  onlineHealth,
} from "./system-status";

test("degraded is its own state — answered but empty is neither live nor down", () => {
  // This is the whole point of the module. Collapsing it either way is a lie in one direction:
  // called live it hides an outage, called down it screams every morning before the open.
  assert.equal(healthOf({ ok: true, hasData: true }), "live");
  assert.equal(healthOf({ ok: true, hasData: false }), "degraded");
  assert.equal(healthOf({ ok: false, hasData: false }), "down");
});

test("an unreadable system reports DOWN, never a default of fine", () => {
  assert.equal(healthOf(null), "down");
  assert.equal(healthOf(undefined), "down");
});

test("systemsOnline counts LIVE only — degraded is not online", () => {
  const s = buildIntelligenceStatus({
    reads: {
      HELIX: { ok: true, hasData: true },
      THERMAL: { ok: true, hasData: false },
      VECTOR: { ok: false, hasData: false },
    },
    etDay: 3,
    etMinutes: 600,
  });
  assert.equal(s.systemsOnline, 1, "only HELIX is live");
  assert.equal(s.systemsTotal, 6);
  assert.equal(s.systems.find((x) => x.id === "THERMAL")?.health, "degraded");
  assert.equal(s.systems.find((x) => x.id === "NIGHT HAWK")?.health, "down", "unsupplied => down");
});

test("activeSignals is the defined sum, and a failed lane is UNKNOWN not zero", () => {
  const s = buildIntelligenceStatus({
    reads: {},
    zerodteOpen: 4,
    swingCommitted: 7,
    bangerOpen: 3,
    etDay: 3,
    etMinutes: 600,
  });
  assert.equal(s.activeSignals, 14);

  // A null lane must not silently subtract and make the desk look quieter than it is.
  const partial = buildIntelligenceStatus({
    reads: {},
    zerodteOpen: 4,
    swingCommitted: null,
    bangerOpen: undefined,
    etDay: 3,
    etMinutes: 600,
  });
  assert.equal(partial.activeSignals, 4);

  // Negative/NaN never leak into a member-facing count.
  const junk = buildIntelligenceStatus({
    reads: {},
    zerodteOpen: -5,
    swingCommitted: Number.NaN,
    etDay: 3,
    etMinutes: 600,
  });
  assert.equal(junk.activeSignals, 0);
});

test("market phase covers every boundary of the session", () => {
  assert.equal(marketPhaseFromEt(3, 9 * 60 + 29), "PRE-MARKET");
  assert.equal(marketPhaseFromEt(3, 9 * 60 + 30), "OPEN", "the open is inclusive");
  assert.equal(marketPhaseFromEt(3, 15 * 60 + 59), "OPEN");
  assert.equal(marketPhaseFromEt(3, 16 * 60), "AFTER-HOURS", "16:00 is no longer open");
  assert.equal(marketPhaseFromEt(3, 20 * 60), "CLOSED");
  assert.equal(marketPhaseFromEt(3, 3 * 60), "CLOSED", "before 04:00 is closed, not pre-market");
  // Weekends are closed at every hour, including ones that would otherwise be RTH.
  for (const day of [0, 6]) {
    assert.equal(marketPhaseFromEt(day, 11 * 60), "CLOSED", `day ${day}`);
  }
});

test("data age is compact and never fabricated", () => {
  assert.equal(formatDataAge(2), "2s");
  assert.equal(formatDataAge(59), "59s");
  assert.equal(formatDataAge(90), "2m");
  assert.equal(formatDataAge(7200), "2h");
  // Unknown stays unknown — a dash, not a reassuring "0s".
  assert.equal(formatDataAge(null), "—");
});

test("data age is classified, because a stale desk that looks live is the failure to prevent", () => {
  assert.equal(dataAgeHealth(2), "live");
  assert.equal(dataAgeHealth(60), "live");
  assert.equal(dataAgeHealth(61), "degraded");
  assert.equal(dataAgeHealth(300), "degraded");
  assert.equal(dataAgeHealth(301), "down");
  // An unknown age must NEVER render as fresh.
  assert.equal(dataAgeHealth(null), "unknown");
  assert.equal(dataAgeHealth(undefined), "unknown");
  assert.equal(dataAgeHealth(Number.NaN), "unknown");
  assert.equal(dataAgeHealth(-5), "unknown");
});

test("online tally: all-up is a different state from most-up", () => {
  assert.equal(onlineHealth(6, 6), "live");
  assert.equal(onlineHealth(5, 6), "degraded"); // one hole
  assert.equal(onlineHealth(4, 6), "down"); // real holes
  assert.equal(onlineHealth(0, 6), "down");
  assert.equal(onlineHealth(1, 0), "unknown");
});
