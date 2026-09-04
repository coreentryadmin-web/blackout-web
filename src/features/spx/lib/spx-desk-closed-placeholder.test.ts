import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const deskSrc = readFileSync("src/features/spx/lib/spx-desk.ts", "utf8");
const mergeSrc = readFileSync("src/features/spx/lib/spx-desk-merge.ts", "utf8");
const stateSrc = readFileSync("src/features/spx/lib/spx-desk-state.ts", "utf8");

test("closed-market / unavailable desk shells use spx_change_pct null, not fabricated 0%", () => {
  assert.match(deskSrc, /function emptyPayload\(asOf: string\)[\s\S]*spx_change_pct: null/);
  assert.match(deskSrc, /const empty: SpxDeskPulse = \{[\s\S]*spx_change_pct: null/);
  assert.match(mergeSrc, /spx_change_pct: null/);
  assert.match(stateSrc, /spx_change_pct: null/);
  assert.doesNotMatch(
    deskSrc,
    /function emptyPayload[\s\S]{0,400}spx_change_pct: 0/
  );
});
