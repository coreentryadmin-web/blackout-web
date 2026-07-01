import { test } from "node:test";
import assert from "node:assert/strict";
import { isCronAuthorized } from "./market-api-auth";

test("isCronAuthorized rejects missing secret", () => {
  const prev = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    const req = new Request("http://localhost/api/cron/test", {
      headers: { authorization: "Bearer anything" },
    });
    assert.equal(isCronAuthorized(req as import("next/server").NextRequest), false);
  } finally {
    if (prev !== undefined) process.env.CRON_SECRET = prev;
  }
});

test("isCronAuthorized accepts valid bearer", () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-cron-secret-value";
  try {
    const req = new Request("http://localhost/api/cron/test", {
      headers: { authorization: "Bearer test-cron-secret-value" },
    });
    assert.equal(isCronAuthorized(req as import("next/server").NextRequest), true);
  } finally {
    if (prev !== undefined) process.env.CRON_SECRET = prev;
    else delete process.env.CRON_SECRET;
  }
});
