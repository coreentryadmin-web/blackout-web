import assert from "node:assert/strict";
import { describe, it, test, mock } from "node:test";
import { buildPostAngles, detectSocialArchetype } from "./social-content-core";
import { etSessionDate } from "./temporal/bar-session-date";

// Specifiers are RELATIVE, mirroring social-content-pack.ts's own directory (src/lib/largo/) —
// not the "@/..." alias the production file uses for its static top-level imports. tsx rewrites
// path aliases for a statically-parsed top-level import but NOT for mock.module()'s own
// specifier string (same note as pre-earnings-pack.test.ts / ecosystem-context.test.ts).
mock.module("./helix-thermal-compare", {
  namedExports: {
    helixThermalCompareForLargo: async () => null,
  },
});

mock.module("./product-reads", {
  namedExports: {
    zerodteRecordForLargo: async () => null,
  },
});

mock.module("../platform/zerodte-service", {
  namedExports: {
    zeroDtePlaysForLargo: async () => ({ plays: [] }),
  },
});

const mod = () => import("./social-content-pack");

describe("detectSocialArchetype", () => {
  it("detects win recap asks", () => {
    assert.equal(
      detectSocialArchetype("Draft X post about today's winning 0DTE plays"),
      "win_recap",
    );
  });

  it("detects platform showcase", () => {
    assert.equal(
      detectSocialArchetype("Showcase the full BlackOut desk for X"),
      "platform_showcase",
    );
  });
});

describe("buildPostAngles", () => {
  it("suggests honest angle when no winners", () => {
    const angles = buildPostAngles("win_recap", {
      winners: [],
      board: { open_count: 0, closed_today: 0, best_winner_pct: null, worst_loser_pct: null },
      spx: null,
      record_7d: null,
    });
    assert.ok(angles.some((a) => /do not invent/i.test(a)));
  });
});

// Largo C1 session anchor (contract/session-anchor.test.ts): a Largo-facing payload that stamps
// a UTC instant via as_of must also carry an ET session_date beside it, derived from the SAME
// instant — never two independent Date.now() calls that could straddle a calendar-day flip.
test("buildSocialContentPack: carries an ET session_date anchor beside as_of", async () => {
  const { buildSocialContentPack } = await mod();
  const pack = await buildSocialContentPack("Draft a win recap post for X");
  assert.equal(typeof pack.as_of, "string");
  assert.match(pack.session_date ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(pack.session_date, etSessionDate(Date.parse(pack.as_of)));
});
