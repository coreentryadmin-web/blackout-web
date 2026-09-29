import assert from "node:assert/strict";
import { test } from "node:test";
import { LEGACY_BOARD_DEV_PLAYS } from "./legacy-board-dev-fixture.ts";

/**
 * BUG (found 2026-09-16): the TSLA dev-fixture row (rendered live on the real
 * /nighthawk-boards-preview route via NightHawkBoardsPreviewClient.tsx) is a SHORT (put-thesis)
 * play whose own narrative ("Opened above stop — setup broken") and pnlPct (-45%) both describe
 * an adverse upward stock gap, but stockMovePct was +2.1 — positive. Per overlayLegacyQuotes.ts's
 * own SHORT formula (`(entryMid - price) / entryMid * 100`), a positive stockMovePct means the
 * stock FELL (favorable for a short thesis) — the exact opposite of what this row's own narrative
 * and losing P&L describe. A developer previewing this fixture would see a green "+2.1%" stock
 * chip next to a play flagged INVALIDATED with a losing P&L, the identical sign-confusion class
 * this whole audit lane's mission statement (marks correctness — "no sign errors") exists to catch.
 */
test("legacy dev fixture: a SHORT play's narrative/pnlPct/stockMovePct sign agree with each other", () => {
  const tsla = LEGACY_BOARD_DEV_PLAYS.find((p) => p.id === "LEGACY:TSLA");
  assert.ok(tsla, "TSLA fixture row must exist");
  assert.equal(tsla!.direction, "SHORT");
  // A losing, INVALIDATED SHORT play describing an adverse ("above stop") gap must not show a
  // positive (favorable-reading) stockMovePct.
  assert.ok(
    (tsla!.pnlPct ?? 0) < 0 && (tsla!.stockMovePct ?? 0) <= 0,
    `losing SHORT play must have a non-positive stockMovePct, got pnlPct=${tsla!.pnlPct} stockMovePct=${tsla!.stockMovePct}`
  );
});
