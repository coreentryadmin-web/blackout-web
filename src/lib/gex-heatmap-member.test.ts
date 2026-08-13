import assert from "node:assert/strict";
import test from "node:test";
import {
  compactHeatmapMemberPayload,
  heatmapMemberUsable,
} from "./gex-heatmap-member.ts";

test("heatmapMemberUsable rejects empty spot or missing strikes", () => {
  assert.equal(heatmapMemberUsable(null), false);
  assert.equal(heatmapMemberUsable({ available: true, spot: 0, strikes: [100], expiries: ["2026-07-28"] }), false);
  assert.equal(
    heatmapMemberUsable({ available: true, spot: 100, strikes: [], expiries: ["2026-07-28"] }),
    false
  );
  assert.equal(
    heatmapMemberUsable({ available: true, spot: 100, strikes: [100], expiries: ["2026-07-28"] }),
    true
  );
});

test("compactHeatmapMemberPayload keeps 0DTE band only", () => {
  const strikes = Array.from({ length: 80 }, (_, i) => 100 + i);
  const payload = {
    available: true,
    spot: 140,
    expiries: ["2026-07-28", "2026-08-15"],
    near_term_expiries: ["2026-07-28", "2026-08-15"],
    strikes,
    gex: {
      cells: Object.fromEntries(
        strikes.map((s) => [String(s), { "2026-07-28": s, "2026-08-15": -s }])
      ),
    },
  };
  const compact = compactHeatmapMemberPayload(payload, 2);
  assert.equal(compact.expiries?.length, 1);
  assert.equal(compact.expiries?.[0], "2026-07-28");
  assert.ok((compact.strikes?.length ?? 0) <= 5);
  assert.ok(compact.gex?.cells?.["140"]);
  assert.equal(compact.gex?.cells?.["100"]?.["2026-08-15"], undefined);
});
