import { before, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Engine B (Banger) open positions live in a completely separate table (banger_positions) from
// the swing_positions rows this route reads via fetchSwingPositionsRange/fetchSwingPositionChain
// — so summary.opens (computed purely from swing_positions chains by buildSwingRecordSummary)
// structurally could never count a banger-origin open position, even after the earlier fix that
// made it count native swing OPEN/HOLD/TRIM rows at all (docs/audit/FINDINGS.md, "summary.opens
// was structurally guaranteed to always read 0"). This is the exact same banger/swing split
// already fixed for bookContextSection's live-book read (docs/audit/FINDINGS.md, "Ask Largo swing
// Book context... blind to 94% of the live open book") — live-verified 2026-09-23: 3 native
// swing_positions opens vs 82 real committed positions on the board (81 banger-origin).
//
// mock.module() resolves relative to THIS file (horizons/route.test.ts pattern). buildSwingRecord/
// buildSwingRecordSummary/selectSwingRecordRootIds/closedDeckSourcesFromChains are deliberately
// REAL here (pure, already unit-tested in record.test.ts) — only the DB/auth/banger boundary is
// faked so the banger fold-in can be observed in isolation.

mock.module("server-only", { namedExports: {} });

mock.module("../../../../../lib/db", {
  namedExports: {
    requireDatabaseInProduction: () => null,
    fetchSwingPositionsRange: async () => [],
    fetchSwingPositionChain: async () => [],
  },
});
mock.module("../../../../../lib/market-api-auth", {
  namedExports: { authorizeCronOrTierApi: async () => ({ via: "cron" as const }) },
});
mock.module("../../../../../lib/tool-access-server", {
  namedExports: { requireToolApi: async () => null },
});

let bangerOpenCountCalls = 0;
mock.module("../../../../../lib/banger/positions-db", {
  namedExports: {
    fetchBangerOpenCount: async () => {
      bangerOpenCountCalls++;
      return 81;
    },
  },
});
let bangerEnabled = true;
mock.module("../../../../../lib/banger/flag", {
  namedExports: { isBangerEngineEnabled: () => bangerEnabled },
});

describe("/api/market/swing/record folds Engine B (Banger) opens into summary.opens", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  before(async () => {
    ({ GET } = await import("./route"));
  });

  test("summary.opens is native swing opens PLUS banger opens, both disclosed separately", async () => {
    bangerOpenCountCalls = 0;
    const res = await GET(new NextRequest("http://localhost/api/market/swing/record"));
    const body = await res.json();
    assert.equal(bangerOpenCountCalls, 1);
    assert.equal(body.summary.nativeOpens, 0, "no swing_positions rows in this fixture");
    assert.equal(body.summary.bangerOpens, 81);
    assert.equal(body.summary.opens, 81, "0 native + 81 banger — must not silently read 0");
  });

  test("banger fetch is skipped and contributes 0 when the Engine B kill-switch is off", async () => {
    bangerEnabled = false;
    bangerOpenCountCalls = 0;
    try {
      const res = await GET(new NextRequest("http://localhost/api/market/swing/record"));
      const body = await res.json();
      assert.equal(bangerOpenCountCalls, 0, "fetchBangerOpenCount must not be called when disabled");
      assert.equal(body.summary.bangerOpens, 0);
      assert.equal(body.summary.opens, 0);
    } finally {
      bangerEnabled = true;
    }
  });
});
