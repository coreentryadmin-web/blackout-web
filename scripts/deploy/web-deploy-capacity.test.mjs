import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  minDesiredForRollHeadroom,
  targetDesiredBeforeWebRoll,
  WEB_AUTOSCALE_MIN_TASKS,
  assertDeploymentConfigSane,
} from "./lib/taskdef-rewrite.mjs";

const CB_OK = { enable: true, rollback: true };
function svc(overrides = {}) {
  return {
    serviceName: "blackout-production-web",
    desiredCount: 8,
    deploymentConfiguration: { deploymentCircuitBreaker: CB_OK, minimumHealthyPercent: 100, maximumPercent: 120 },
    ...overrides,
  };
}

test("minDesiredForRollHeadroom: 100/120 needs at least 5 tasks", () => {
  assert.equal(minDesiredForRollHeadroom(100, 120), 5);
  assert.equal(minDesiredForRollHeadroom(100, 112), 9);
});

test("targetDesiredBeforeWebRoll: scales up sub-floor fleets only", () => {
  assert.equal(targetDesiredBeforeWebRoll(svc({ desiredCount: 2 })), WEB_AUTOSCALE_MIN_TASKS);
  assert.equal(targetDesiredBeforeWebRoll(svc({ desiredCount: 8 })), 8);
});

test("desired=2 fails assertDeploymentConfigSane at 100/120", () => {
  const r = assertDeploymentConfigSane(svc({ desiredCount: 2 }));
  assert.equal(r.ok, false);
});

test("ecr-push workflow calls ensure-web-deploy-capacity before web roll", () => {
  const workflow = readFileSync(".github/workflows/ecr-push-production.yml", "utf8");
  assert.match(workflow, /ensure-web-deploy-capacity\.mjs/);
});
