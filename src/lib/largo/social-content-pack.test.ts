import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPostAngles, detectSocialArchetype } from "./social-content-core";

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
