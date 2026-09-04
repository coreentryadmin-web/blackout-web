import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardMatrixReady } from "./audit/lib/site-latency-ready.mjs";

test("dashboardMatrixReady uses minRows arg (no OFF_HOURS closure)", () => {
  const doc = {
    querySelectorAll: () => ({ length: 6 }),
    body: { innerText: "short" },
  };
  const g = globalThis as typeof globalThis & { document?: typeof doc };
  const prev = g.document;
  g.document = doc as unknown as Document;

  try {
    assert.equal(dashboardMatrixReady(5), true);
    assert.equal(dashboardMatrixReady(20), false);
    doc.querySelectorAll = () => ({ length: 0 });
    doc.body.innerText = "x".repeat(900);
    assert.equal(dashboardMatrixReady(20), true);
  } finally {
    g.document = prev;
  }
});
