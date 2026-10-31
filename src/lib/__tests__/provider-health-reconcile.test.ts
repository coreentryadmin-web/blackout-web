import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PROVIDER_HEALTH_THRESHOLDS,
  buildProviderHealthIssues,
  clampProviderHealthWindowMinutes,
} from "@/lib/provider-health-issues";

describe("buildProviderHealthIssues", () => {
  it("opens critical when failures exceed crit threshold", () => {
    const issues = buildProviderHealthIssues([
      { provider: "uw", calls: 20, failures: 16, rate_limits: 0, top_endpoints: ["/flow"] },
    ]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "critical");
    assert.match(issues[0].title, /uw upstream failures/i);
  });

  it("opens warning on elevated fail rate", () => {
    const issues = buildProviderHealthIssues(
      [{ provider: "polygon", calls: 10, failures: 2, rate_limits: 0, top_endpoints: ["/v2/aggs"] }],
      { ...DEFAULT_PROVIDER_HEALTH_THRESHOLDS, failWarn: 5, failCrit: 20, rateWarnPct: 0.15, minCallsForRate: 10 }
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "warning");
  });

  it("returns empty when telemetry is clean", () => {
    const issues = buildProviderHealthIssues([
      { provider: "uw", calls: 50, failures: 0, rate_limits: 0, top_endpoints: [] },
    ]);
    assert.equal(issues.length, 0);
  });

  it("flags sustained rate limits separately", () => {
    const issues = buildProviderHealthIssues([
      { provider: "uw", calls: 30, failures: 0, rate_limits: 4, top_endpoints: [] },
    ]);
    assert.equal(issues.length, 1);
    assert.match(issues[0].title, /rate limits/i);
  });

  // Regression: the rate-limit detail text used to hardcode "in the last hour"
  // regardless of the actual reconcile window (PROVIDER_HEALTH_WINDOW_MIN,
  // default 10 minutes, clamped to [1,60]). An admin reading "4 rate-limited
  // calls in the last hour" would badly misjudge severity vs. the true
  // "4 in the last 10 minutes" — the detail must reflect the REAL window it
  // was computed over, not a fixed, unrelated unit.
  it("reflects the ACTUAL reconcile window in the rate-limit detail text, not a hardcoded hour", () => {
    const issues = buildProviderHealthIssues(
      [{ provider: "uw", calls: 30, failures: 0, rate_limits: 4, top_endpoints: [] }],
      DEFAULT_PROVIDER_HEALTH_THRESHOLDS,
      10
    );
    assert.equal(issues.length, 1);
    assert.doesNotMatch(issues[0].detail, /last hour/i);
    assert.match(issues[0].detail, /10m window/);
  });

  it("reflects a non-default window (e.g. PROVIDER_HEALTH_WINDOW_MIN=45) exactly, not the old 10-minute default", () => {
    const issues = buildProviderHealthIssues(
      [{ provider: "polygon", calls: 40, failures: 20, rate_limits: 0, top_endpoints: ["/v2/aggs"] }],
      DEFAULT_PROVIDER_HEALTH_THRESHOLDS,
      45
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0].detail, /45m window/);
    assert.doesNotMatch(issues[0].detail, /10m window/);
  });

  it("defaults to a 10-minute window label when no windowMinutes is passed (back-compat)", () => {
    const issues = buildProviderHealthIssues([
      { provider: "uw", calls: 30, failures: 0, rate_limits: 4, top_endpoints: [] },
    ]);
    assert.match(issues[0].detail, /10m window/);
  });
});

describe("clampProviderHealthWindowMinutes", () => {
  it("clamps to [1, 60] and rounds, matching the SQL query's own clamp", () => {
    assert.equal(clampProviderHealthWindowMinutes(10), 10);
    assert.equal(clampProviderHealthWindowMinutes(0), 1);
    assert.equal(clampProviderHealthWindowMinutes(-5), 1);
    assert.equal(clampProviderHealthWindowMinutes(120), 60);
    assert.equal(clampProviderHealthWindowMinutes(10.6), 11);
  });
});
