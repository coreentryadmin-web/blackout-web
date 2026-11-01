import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import {
  DEFAULT_PROVIDER_HEALTH_THRESHOLDS,
  buildProviderHealthIssues,
  clampProviderHealthWindowMinutes,
} from "@/lib/provider-health-issues";
import type { runProviderHealthReconcile as RunProviderHealthReconcile } from "@/lib/provider-health-reconcile";

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

  // Regression: the route builds its argument via
  // `Number(process.env.PROVIDER_HEALTH_WINDOW_MIN ?? "10")` — a non-numeric override (e.g.
  // PROVIDER_HEALTH_WINDOW_MIN=abc) makes that `NaN`, the exact "non-numeric env override" shape
  // alert-outcome-sync/nighthawk-outcomes/largo-cleanup already guard explicitly. Without a
  // Number.isFinite guard, Math.max/Math.min propagate the NaN operand instead of clamping it,
  // so this returned NaN (not a value in [1, 60]) — which makes the SQL interval cast
  // (`($1 || ' minutes')::interval` with $1="NaN") throw, silently zeroing out every rollup, and
  // would print "the last NaNm window" in admin-facing issue text if ever rendered unclamped.
  it("falls back to the 10-minute default on a non-finite input (NaN/Infinity), never propagating it", () => {
    assert.equal(clampProviderHealthWindowMinutes(NaN), 10);
    assert.equal(clampProviderHealthWindowMinutes(Infinity), 10);
    assert.equal(clampProviderHealthWindowMinutes(-Infinity), 10);
  });
});

describe("runProviderHealthReconcile", () => {
  // provider-health-reconcile.ts has `import "server-only"` at its top, which throws under plain
  // Node outside a Next.js server bundle — same "MUST be intercepted before the real file's
  // static imports ever touch it" pattern already used throughout this repo's route tests (e.g.
  // src/app/api/market/gex-heatmap/route.test.ts). dbConfigured() returns false with no
  // DATABASE_URL set in this test env, so runProviderHealthReconcile never touches `pg` either.
  let runProviderHealthReconcile: typeof RunProviderHealthReconcile;
  before(async () => {
    mock.module("server-only", { namedExports: {} });
    // Forces dbConfigured() to false so fetchProviderTelemetryRollups short-circuits to `[]`
    // instead of attempting a real connection (and eating a ~30s timeout against whatever
    // DATABASE_URL happens to be set to in this sandbox) — same pattern already used by
    // spx-play-engine.test.ts/discovery-quality.test.ts for the identical reason.
    process.env.DATABASE_URL = "";
    delete process.env.DATABASE_PUBLIC_URL;
    // Relative path, not the "@/" tsconfig alias — mock.module() resolves bare/aliased
    // specifiers relative to THIS file once active, breaking the alias for any import() that
    // comes after it in the same run (see src/app/api/market/quote/route.test.ts for the same
    // documented gotcha).
    ({ runProviderHealthReconcile } = await import("../provider-health-reconcile"));
  });

  // Regression: the cron route (`app/api/cron/provider-health-reconcile/route.ts`) builds its
  // argument via `Number(process.env.PROVIDER_HEALTH_WINDOW_MIN ?? "10")` and used to report
  // THAT raw value back as `window_min` in its own cron_job_runs log / HTTP response — even
  // though the query and issue text both already used the CLAMPED value internally. A
  // misconfigured env var (non-numeric, e.g. "") makes the raw value NaN, so the route's own
  // payload would show "window_min": NaN while every real window usage silently fell back to
  // 10 minutes — the exact "member/admin sees a raw NaN" shape clampProviderHealthWindowMinutes's
  // own NaN guard exists to prevent, just at a third exposure point that guard didn't reach.
  // `effectiveWindowMinutes` closes that gap by handing the caller the SAME clamped number it
  // already computes internally, instead of forcing the caller to re-derive or re-clamp it.
  it("returns the clamped window it actually used, not the raw possibly non-finite input", async () => {
    const nanResult = await runProviderHealthReconcile(Number("not-a-number"));
    assert.equal(nanResult.effectiveWindowMinutes, 10, "NaN input must clamp to the 10-minute default");
    assert.ok(Number.isFinite(nanResult.effectiveWindowMinutes), "must never surface a raw NaN to the caller");

    const outOfRangeResult = await runProviderHealthReconcile(120);
    assert.equal(outOfRangeResult.effectiveWindowMinutes, 60, "an out-of-range input must clamp to the [1,60] ceiling");

    const normalResult = await runProviderHealthReconcile(45);
    assert.equal(normalResult.effectiveWindowMinutes, 45, "an in-range input must pass through unchanged");
  });
});
