import assert from "node:assert/strict";
import { test } from "node:test";
import { isPooledDbHost } from "./ops-config-status.ts";

// Regression guard for a real live bug (2026-08-28): the admin health panel's
// database_via_pooler flag only recognized Railway-era PgBouncer hostname patterns, which
// predate the 2026-07 migration to Amazon RDS + RDS Proxy. It reported "no pooler, enable
// PgBouncer" even with RDS Proxy correctly wired up — confirmed live against
// `blackout-production-proxy.proxy-c89mwake2by8.us-east-1.rds.amazonaws.com` via
// `aws rds describe-db-proxies`.

test("recognizes a live RDS Proxy endpoint", () => {
  assert.ok(isPooledDbHost("blackout-production-proxy.proxy-c89mwake2by8.us-east-1.rds.amazonaws.com"));
});

test("still recognizes the Railway-era PgBouncer patterns", () => {
  assert.ok(isPooledDbHost("pgbouncer.internal"));
  assert.ok(isPooledDbHost("some-pooler-host.example.com"));
  assert.ok(isPooledDbHost("containers-us-west-123.proxy.rlwy.net"));
  assert.ok(isPooledDbHost("db-pool.internal"));
});

test("does NOT flag a direct (unpooled) RDS instance endpoint", () => {
  assert.ok(
    !isPooledDbHost("blackout-production-postgres.c89mwake2by8.us-east-1.rds.amazonaws.com"),
    "a plain RDS instance host has no .proxy- segment and must not read as pooled"
  );
});

test("is case-insensitive", () => {
  assert.ok(isPooledDbHost("BLACKOUT-PRODUCTION-PROXY.PROXY-C89MWAKE2BY8.US-EAST-1.RDS.AMAZONAWS.COM"));
});
