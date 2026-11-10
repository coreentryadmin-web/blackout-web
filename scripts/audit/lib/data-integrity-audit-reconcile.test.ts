import assert from "node:assert/strict";
import test from "node:test";

import { filterReconciledGexColdIssues } from "./data-integrity-audit-reconcile.mjs";

test("filterReconciledGexColdIssues drops cold issue when heatmap is live", async () => {
  const { kept, reconciled } = await filterReconciledGexColdIssues(
    [
      {
        title: "GEX SPX cold during RTH",
        detail: 'getGexPositioning("SPX") returned no matrix while market is open',
      },
    ],
    async () => ({ status: 200, json: { spot: 7526 } })
  );
  assert.equal(kept.length, 0);
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].ticker, "SPX");
});

test("filterReconciledGexColdIssues keeps issue when heatmap empty", async () => {
  const issue = {
    title: "GEX SPY cold during RTH",
    detail: 'getGexPositioning("SPY") returned no matrix while market is open',
  };
  const { kept, reconciled } = await filterReconciledGexColdIssues([issue], async () => ({
    status: 200,
    json: { spot: 0 },
  }));
  assert.equal(reconciled.length, 0);
  assert.deepEqual(kept, [issue]);
});
