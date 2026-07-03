import { test } from "node:test";
import assert from "node:assert/strict";
import { probePgStatStatements } from "./pg-stat-statements-health";

test("probePgStatStatements: reports not-configured when no DATABASE_URL is set, never attempts a query", async () => {
  const priorUrl = process.env.DATABASE_URL;
  const priorPublicUrl = process.env.DATABASE_PUBLIC_URL;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_PUBLIC_URL;
  try {
    assert.deepEqual(await probePgStatStatements(), { configured: false });
  } finally {
    if (priorUrl != null) process.env.DATABASE_URL = priorUrl;
    if (priorPublicUrl != null) process.env.DATABASE_PUBLIC_URL = priorPublicUrl;
  }
});
