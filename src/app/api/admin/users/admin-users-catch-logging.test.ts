import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROUTES = [
  { path: "create/route.ts", label: "create", logPrefix: "create failed" },
  { path: "sync/route.ts", label: "sync", logPrefix: "sync failed" },
] as const;

// Regression (2026-10-20, DISCOVERY-lane error-handling sweep): the outer catch block in
// both admin/users/create and admin/users/sync wrapped a real Clerk/Whop call and swallowed
// its failure with zero server-side log before returning an error response. create/route.ts
// is the stronger signal — a sibling catch 24 lines earlier in the SAME function (the Whop
// sync after create) already does `console.warn(...)`, and the success path logs via
// `console.log(...)` too, so this one branch was clearly missed, not deliberately silent.
// sync/route.ts wraps the identical `syncWhopMembershipForEmail` call that IS logged on
// failure in create/route.ts's inner catch — the convention exists in this module, just
// wasn't applied here. A failed admin user-creation or billing-tier sync is exactly the kind
// of thing an admin audit trail needs a server-side trace of.
for (const { path, label, logPrefix } of ROUTES) {
  test(`admin/users/${label}'s outer catch logs before returning its error response`, () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), "utf8");
    const catchAt = src.lastIndexOf("} catch (err) {");
    assert.ok(catchAt > 0, `expected ${path} to still have an outer catch block`);
    const catchBody = src.slice(catchAt, src.indexOf("}", src.indexOf("return", catchAt)) + 1);
    assert.match(
      catchBody,
      /console\.error\(/,
      `${path}'s outer catch must log before returning its error response`
    );
    assert.match(
      catchBody,
      new RegExp(logPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${path}'s log message should identify which operation failed`
    );
  });
}
