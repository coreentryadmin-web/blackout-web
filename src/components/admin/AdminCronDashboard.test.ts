import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTelemetryCoveragePct } from "./AdminCronDashboard";

function job(ok: number, failed: number, skipped: number) {
  return { runs_24h: { ok, failed, skipped } };
}

test("computeTelemetryCoveragePct: no jobs reads 0, not NaN or saturated", () => {
  assert.equal(computeTelemetryCoveragePct([]), 0);
});

test("computeTelemetryCoveragePct: all jobs silent in 24h reads 0 — a real telemetry outage must be visible", () => {
  const jobs = [job(0, 0, 0), job(0, 0, 0), job(0, 0, 0)];
  assert.equal(computeTelemetryCoveragePct(jobs), 0);
});

test("computeTelemetryCoveragePct: all jobs active in 24h reads 1", () => {
  const jobs = [job(5, 0, 0), job(0, 1, 0), job(0, 0, 2)];
  assert.equal(computeTelemetryCoveragePct(jobs), 1);
});

test("computeTelemetryCoveragePct: mixed active/silent jobs is the real fraction, not a saturated 1", () => {
  const jobs = [job(5, 0, 0), job(0, 0, 0), job(0, 0, 0), job(0, 0, 0)];
  assert.equal(computeTelemetryCoveragePct(jobs), 0.25);
});

test("computeTelemetryCoveragePct: a huge all-time cumulative total does NOT saturate this ratio — it ignores raw run count and only asks whether a job logged anything in the 24h window", () => {
  // Reproduces the live shape: logged_runs_total (76494 all-time) is irrelevant here — only
  // the per-job 24h activity matters, and most jobs are silent even though the cumulative
  // total is huge.
  const jobs = [
    job(120, 0, 0), // one chatty job accounts for nearly all historical volume
    job(0, 0, 0),
    job(0, 0, 0),
    job(0, 0, 0),
    job(0, 0, 0),
  ];
  assert.equal(computeTelemetryCoveragePct(jobs), 0.2);
});
