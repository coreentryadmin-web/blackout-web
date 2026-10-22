import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// Regression (2026-10-20, DISCOVERY-lane N+1 sweep): the per-(user, ticker) loop re-queried
// `vector_alert_rules` for every pair even though the single bulk SELECT above it already read
// every enabled rule row — N pairs fired N sequential DB round-trips instead of 1. Fixed by
// grouping the bulk query's rows into a Map and looking them up in the loop instead of re-querying.
test("the per-(user, ticker) evaluation loop does not re-query the DB per pair", () => {
  const loopStart = routeSrc.indexOf("for (const { user_id: userId, ticker } of pairs)");
  assert.ok(loopStart > 0, "expected the per-pair evaluation loop to still exist");
  const loopBody = routeSrc.slice(loopStart, routeSrc.indexOf("\n  }\n\n  //", loopStart));
  assert.doesNotMatch(
    loopBody,
    /dbQuery/,
    "the per-pair loop must not call dbQuery — rule rows must come from the single bulk SELECT above it"
  );
  assert.match(
    routeSrc,
    /SELECT user_id, id, ticker, kind, tolerance_pct, enabled FROM vector_alert_rules WHERE enabled = true/,
    "the bulk query must select every column the loop needs, including user_id"
  );
});

test("vector-alerts gates on isEtCashRth before rule-table reads / evaluation", () => {
  assert.match(
    routeSrc,
    /import \{ isEtCashRth \} from "@\/lib\/et-market-hours"/,
    "must import the holiday-aware RTH gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isEtCashRth()");
  const workAt = routeSrc.indexOf("ensureVectorAlertRulesTable()");
  assert.ok(authAt >= 0 && gateAt >= 0 && workAt >= 0);
  assert.ok(gateAt > authAt, "RTH gate must run after auth");
  assert.ok(gateAt < workAt, "RTH gate must run before DB rule reads");
});
