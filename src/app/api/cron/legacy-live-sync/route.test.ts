import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("legacy-live-sync gates on isEtCashRth before Polygon option-snapshot fetches", () => {
  assert.match(
    routeSrc,
    /import \{ isEtCashRth \} from "@\/lib\/et-market-hours"/,
    "must import the holiday-aware RTH gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isEtCashRth()");
  const workAt = routeSrc.indexOf("runLegacyLiveSync(");
  assert.ok(authAt >= 0 && gateAt >= 0 && workAt >= 0);
  assert.ok(gateAt > authAt, "RTH gate must run after auth");
  assert.ok(gateAt < workAt, "RTH gate must run before live-sync work starts");
});
