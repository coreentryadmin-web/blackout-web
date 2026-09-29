import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildCandidateCoverageReport } from "./candidate-coverage";
import type { NighthawkCandidateCoverageRow } from "@/lib/db";

function row(overrides: Partial<NighthawkCandidateCoverageRow>): NighthawkCandidateCoverageRow {
  return {
    stage: "discovery",
    rejection_reason: null,
    n: 10,
    n_graded: 0,
    n_editions: 1,
    first_edition: "2026-09-21",
    last_edition: "2026-09-21",
    ...overrides,
  };
}

describe("buildCandidateCoverageReport", () => {
  test("rolls up total_rows/total_graded/overall_grading_pct across every bucket", () => {
    const report = buildCandidateCoverageReport(
      [
        row({ stage: "discovery", n: 40, n_graded: 0 }),
        row({ stage: "rank_final", n: 5, n_graded: 5 }),
        row({ stage: "rejected", rejection_reason: "geometry", n: 5, n_graded: 3 }),
      ],
      90
    );
    assert.equal(report.total_rows, 50);
    assert.equal(report.total_graded, 8);
    assert.equal(report.overall_grading_pct, 16);
  });

  test("per-stage grading_pct is computed per bucket, not from the overall total", () => {
    const report = buildCandidateCoverageReport(
      [row({ stage: "rank_final", n: 8, n_graded: 4 }), row({ stage: "discovery", n: 20, n_graded: 0 })],
      90
    );
    const rankFinal = report.by_stage.find((s) => s.stage === "rank_final");
    assert.equal(rankFinal!.grading_pct, 50);
    const discovery = report.by_stage.find((s) => s.stage === "discovery");
    assert.equal(discovery!.grading_pct, 0);
  });

  test("a zero-row bucket reports grading_pct null, never divide-by-zero NaN", () => {
    const report = buildCandidateCoverageReport([row({ n: 0, n_graded: 0 })], 90);
    assert.equal(report.by_stage[0]!.grading_pct, null);
    assert.equal(report.overall_grading_pct, null);
  });

  test("first_edition/last_edition span the widest range across every bucket", () => {
    const report = buildCandidateCoverageReport(
      [
        row({ stage: "discovery", first_edition: "2026-09-15", last_edition: "2026-09-18" }),
        row({ stage: "rank_final", first_edition: "2026-09-20", last_edition: "2026-09-22" }),
      ],
      90
    );
    assert.equal(report.first_edition, "2026-09-15");
    assert.equal(report.last_edition, "2026-09-22");
  });

  test("min_distinct_editions is a lower bound (max across buckets), never summed", () => {
    const report = buildCandidateCoverageReport(
      [row({ stage: "discovery", n_editions: 8 }), row({ stage: "rank_final", n_editions: 3 })],
      90
    );
    assert.equal(report.min_distinct_editions, 8);
  });

  test("thin_history true when the widest span is under the day floor", () => {
    const thin = buildCandidateCoverageReport(
      [row({ first_edition: "2026-09-21", last_edition: "2026-09-22" })],
      90
    );
    assert.equal(thin.thin_history, true);

    const wide = buildCandidateCoverageReport(
      [row({ first_edition: "2026-08-01", last_edition: "2026-09-22" })],
      90
    );
    assert.equal(wide.thin_history, false);
  });

  test("rejection_reason is carried through per bucket verbatim, distinguishing rejected sub-reasons", () => {
    const report = buildCandidateCoverageReport(
      [
        row({ stage: "geometry", rejection_reason: "geometry", n: 3 }),
        row({ stage: "premium_cap", rejection_reason: "premium_cap", n: 2 }),
      ],
      90
    );
    const reasons = report.by_stage.map((s) => s.rejection_reason);
    assert.deepEqual(reasons.sort(), ["geometry", "premium_cap"]);
  });

  test("by_stage is sorted by row count descending", () => {
    const report = buildCandidateCoverageReport(
      [row({ stage: "small", n: 2 }), row({ stage: "big", n: 100 }), row({ stage: "mid", n: 10 })],
      90
    );
    assert.deepEqual(report.by_stage.map((s) => s.stage), ["big", "mid", "small"]);
  });

  test("empty input -> zeroed report, never throws", () => {
    const report = buildCandidateCoverageReport([], 90);
    assert.equal(report.total_rows, 0);
    assert.equal(report.total_graded, 0);
    assert.equal(report.overall_grading_pct, null);
    assert.equal(report.first_edition, null);
    assert.equal(report.last_edition, null);
    assert.equal(report.min_distinct_editions, 0);
    assert.equal(report.thin_history, true);
    assert.deepEqual(report.by_stage, []);
  });
});
