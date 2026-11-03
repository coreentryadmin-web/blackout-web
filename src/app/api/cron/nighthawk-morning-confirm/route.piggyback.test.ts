import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("morning-confirm piggybacks nighthawk-backfill-repair before reading the edition row", () => {
  const dispatchAt = routeSrc.indexOf('dispatchCronWarm("nighthawk-backfill-repair")');
  const fetchAt = routeSrc.indexOf("fetchNighthawkEditionByDate(editionDateParam)");
  assert.ok(dispatchAt >= 0, "must dispatch backfill-repair");
  assert.ok(fetchAt >= 0, "must fetch edition");
  assert.ok(
    dispatchAt < fetchAt,
    "backfill repair must run before the edition row is read so morning-confirm sees repaired plays"
  );
});
