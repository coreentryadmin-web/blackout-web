import assert from "node:assert/strict";
import test from "node:test";
import { todayEtYmd } from "@/lib/providers/spx-session";
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
  const today = todayEtYmd();
  const later = "2099-12-31";
  const strikes = Array.from({ length: 80 }, (_, i) => 100 + i);
  const payload = {
    available: true,
    spot: 140,
    expiries: [today, later],
    near_term_expiries: [today, later],
    strikes,
    gex: {
      cells: Object.fromEntries(
        strikes.map((s) => [String(s), { [today]: s, [later]: -s }])
      ),
    },
  };
  const compact = compactHeatmapMemberPayload(payload, 2);
  assert.equal(compact.expiries?.length, 1);
  assert.equal(compact.expiries?.[0], today);
  assert.ok((compact.strikes?.length ?? 0) <= 5);
  assert.ok(compact.gex?.cells?.["140"]);
  assert.equal(compact.gex?.cells?.["100"]?.[later], undefined);
});
