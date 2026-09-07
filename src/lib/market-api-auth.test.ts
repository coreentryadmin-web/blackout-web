import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

// DRIFT GUARD: isCronAuthorized's own doc comment used to hardcode "23 cron writers" — the
// count had already drifted to 53 by the time this was caught (2026-09-07). Rather than pin a
// second number that will just go stale again, assert the claim the comment actually makes:
// every route under api/cron/* calls this gate. A route.ts that doesn't import/call
// isCronAuthorized would otherwise ship an unauthenticated cron endpoint silently.
test("DRIFT GUARD: every src/app/api/cron/*/route.ts calls isCronAuthorized", () => {
  const cronDir = join(process.cwd(), "src/app/api/cron");
  const slugs = readdirSync(cronDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  assert.ok(slugs.length > 0, "expected to find cron route directories under src/app/api/cron");
  for (const slug of slugs) {
    const routePath = join(cronDir, slug, "route.ts");
    const src = readFileSync(routePath, "utf8");
    assert.match(
      src,
      /isCronAuthorized/,
      `src/app/api/cron/${slug}/route.ts does not call isCronAuthorized — unauthenticated cron endpoint?`
    );
  }
});
