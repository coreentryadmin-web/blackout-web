import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cronWatchdogVerdict,
  shouldRunFullSiteDeepAudit,
} from "./gha-rth-audit-offhours-eval.mjs";

describe("shouldRunFullSiteDeepAudit", () => {
  it("skips when smoke-only", () => {
    assert.equal(shouldRunFullSiteDeepAudit({ rthOpen: true, force: false, smokeOnly: true }), false);
  });

  it("runs during RTH", () => {
    assert.equal(shouldRunFullSiteDeepAudit({ rthOpen: true, force: false, smokeOnly: false }), true);
  });

  it("runs off-hours with --force", () => {
    assert.equal(shouldRunFullSiteDeepAudit({ rthOpen: false, force: true, smokeOnly: false }), true);
  });

  it("skips off-hours without force", () => {
    assert.equal(shouldRunFullSiteDeepAudit({ rthOpen: false, force: false, smokeOnly: false }), false);
  });
});

describe("cronWatchdogVerdict", () => {
  it("on RTH, all problem_keys fail", () => {
    const v = cronWatchdogVerdict({
      rthOpen: true,
      force: false,
      problemKeys: ["swing-discovery", "spx-evaluate"],
      rthStaleKeys: ["spx-evaluate"],
    });
    assert.deepEqual(v.failKeys, ["swing-discovery", "spx-evaluate"]);
    assert.deepEqual(v.warnKeys, []);
  });

  it("off-hours, only rth_stale_keys fail", () => {
    const v = cronWatchdogVerdict({
      rthOpen: false,
      force: false,
      problemKeys: ["swing-discovery", "spx-evaluate"],
      rthStaleKeys: ["spx-evaluate"],
    });
    assert.deepEqual(v.failKeys, ["spx-evaluate"]);
    assert.deepEqual(v.warnKeys, ["swing-discovery"]);
  });

  it("off-hours with no rth stale, problems are warnings only", () => {
    const v = cronWatchdogVerdict({
      rthOpen: false,
      force: false,
      problemKeys: ["swing-discovery"],
      rthStaleKeys: [],
    });
    assert.deepEqual(v.failKeys, []);
    assert.deepEqual(v.warnKeys, ["swing-discovery"]);
  });
});
