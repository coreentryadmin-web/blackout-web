import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSrc = readFileSync("src/app/api/vector/alerts/rules/route.ts", "utf8");

test("alert rules require premium tier and vector tool access", () => {
  assert.match(routeSrc, /requireTierApi\("premium"\)/);
  assert.match(routeSrc, /requireToolApi\("vector"\)/);
  assert.match(routeSrc, /requireVectorAlertAuth/);
});

test("alert rules apply auth on GET, PUT, and DELETE", () => {
  const hits = routeSrc.match(/requireVectorAlertAuth/g) ?? [];
  assert.ok(hits.length >= 3, "each HTTP method must call requireVectorAlertAuth");
});
