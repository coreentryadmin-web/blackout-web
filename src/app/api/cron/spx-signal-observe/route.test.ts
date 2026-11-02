import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

// BUG FIX: this cron used to re-derive `direction` from the raw sign of `score`
// (`score > 0 ? "long" : score < 0 ? "short" : null`), which has no neutral zone — so a
// genuinely no-edge WAIT tick (|score| < 10, where computeSpxConfluence's own `confluence.direction`
// is correctly null) still got persisted with a fabricated "long"/"short" call. That fabricated
// direction then gets graded right/wrong by spx-signal-db.ts's direction_correct, corrupting every
// downstream accuracy metric on the admin Signal Analytics dashboard. Live evidence: 22/100 of the
// most recent real persisted rows had engine_action:"WAIT" with a non-null direction that should
// have been null.
test("spx-signal-observe persists the engine's own confluence.direction, not a raw score-sign re-derivation", () => {
  assert.match(
    routeSrc,
    /const direction: "long" \| "short" \| null = confluence\.direction;/,
    "direction must come from confluence.direction (null in the WAIT/neutral zone), not be re-derived from score's raw sign"
  );
  assert.doesNotMatch(
    routeSrc,
    /score > 0 \? "long" : score < 0 \? "short" : null/,
    "must not re-derive direction from the raw sign of score — that has no neutral zone and fabricates a call for every WAIT-zone tick"
  );
});
