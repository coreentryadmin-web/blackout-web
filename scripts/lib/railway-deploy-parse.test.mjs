import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseRailwayDeploymentRows,
  partitionRailwayDeployments,
  assessStaleBuildingDeploy,
} from "./railway-deploy-parse.mjs";

const SAMPLE = `Recent Deployments
  aecb3c44-f73d-4689-9cba-3278b51accce | BUILDING | 2026-07-03 17:44:24 +00:00
  3a04be2c-ce41-4653-ae28-bd0584cded39 | SKIPPED | 2026-07-03 17:29:21 +00:00
  928d265f-0eaf-4e43-a694-e691cd6d3b64 | SUCCESS | 2026-07-03 17:26:25 +00:00`;

describe("railway-deploy-parse", () => {
  it("parses deployment rows", () => {
    const rows = parseRailwayDeploymentRows(SAMPLE);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].status, "BUILDING");
    assert.equal(rows[2].id, "928d265f-0eaf-4e43-a694-e691cd6d3b64");
  });

  it("partitions actionable vs ignored", () => {
    const { latest, lastSuccess, ignored } = partitionRailwayDeployments(
      parseRailwayDeploymentRows(SAMPLE),
    );
    assert.equal(latest?.status, "BUILDING");
    assert.equal(lastSuccess?.status, "SUCCESS");
    assert.equal(ignored.length, 1);
  });

  it("detects stale BUILDING with prior SUCCESS still serving", () => {
    const rows = parseRailwayDeploymentRows(SAMPLE);
    const { latest, lastSuccess } = partitionRailwayDeployments(rows);
    const now = new Date("2026-07-03T18:10:00Z").getTime();
    const result = assessStaleBuildingDeploy({
      latest,
      lastSuccess,
      serviceStatus: "blackout-web: ● Online · Building (26m) · 5/5 running",
      now,
      staleBuildingMin: 15,
    });
    assert.equal(result.stale, true);
    assert.equal(result.lastSuccessId, "928d265f-0eaf-4e43-a694-e691cd6d3b64");
  });

  it("does not treat fresh BUILDING as stale", () => {
    const rows = parseRailwayDeploymentRows(SAMPLE);
    const { latest, lastSuccess } = partitionRailwayDeployments(rows);
    const now = new Date("2026-07-03T17:50:00Z").getTime();
    const result = assessStaleBuildingDeploy({
      latest,
      lastSuccess,
      serviceStatus: "blackout-web: ● Online · Building (6m) · 5/5 running",
      now,
      staleBuildingMin: 15,
    });
    assert.equal(result.stale, false);
  });
});
