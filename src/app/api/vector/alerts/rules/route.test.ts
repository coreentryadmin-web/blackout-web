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

test("alert rules reject a malformed ticker with isVectorTickerAllowed on every handler, not just a bare trim/uppercase", () => {
  // Regression: this route used to roll its own `normalizeTicker` with no format/length check —
  // every other Vector route (walls, flow, gex-heatmap, etc.) gates on `isVectorTickerAllowed`
  // before a caller-supplied symbol reaches a query or the DB; this one didn't, letting an
  // arbitrary-length, arbitrary-character string reach `vector_alert_rules.ticker`.
  assert.match(routeSrc, /import \{ normalizeVectorTicker, isVectorTickerAllowed \} from "@\/features\/vector\/lib\/vector-ticker"/);
  const hits = routeSrc.match(/isVectorTickerAllowed\(/g) ?? [];
  assert.ok(hits.length >= 3, "GET, PUT, and DELETE must each validate the ticker before using it");
});
