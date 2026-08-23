import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { openSessionYmd } from "./meridian-open-session";
import {
  indexBarsByYmd,
  reactionForPrint,
  reactionsForPrints,
  type DailyBarLike,
} from "./meridian-reaction-core";

/** UTC instant for an ET wall-clock time on 2026-08-21 (EDT, UTC-4). */
const et = (hhmm: string, ymd = "2026-08-21") => new Date(`${ymd}T${hhmm}:00-04:00`);

describe("openSessionYmd: is there a session running right now", () => {
  test("bounded by the bell at both ends", () => {
    assert.equal(openSessionYmd(et("09:29")), null, "pre-open");
    assert.equal(openSessionYmd(et("09:30")), "2026-08-21", "the open itself counts");
    assert.equal(openSessionYmd(et("09:46")), "2026-08-21", "the live case this fixes");
    assert.equal(openSessionYmd(et("15:59")), "2026-08-21");
    assert.equal(openSessionYmd(et("16:00")), null, "at the close the bar is FINAL, not moving");
    assert.equal(openSessionYmd(et("18:30")), null, "after hours");
    assert.equal(openSessionYmd(et("04:00")), null, "premarket is not the session");
  });

  test("a non-trading day has no open session, whatever the clock says", () => {
    // Juneteenth 2026 is a Friday — a weekday test would call this open. isTradingDayEt does not.
    assert.equal(openSessionYmd(et("11:00", "2026-06-19")), null, "Juneteenth");
    assert.equal(openSessionYmd(et("11:00", "2026-08-22")), null, "Saturday");
    assert.equal(openSessionYmd(et("11:00", "2026-08-18")), "2026-08-18", "an ordinary Tuesday");
  });
});

/**
 * 08-20 closed at 100. 08-21 (today) opened at 102 and has traded to 97 — a PARTIAL bar whose
 * `c` is just the last print. The shape of the live BEKE case.
 */
const BARS: DailyBarLike[] = [
  { t: Date.parse("2026-08-19T04:00:00Z"), o: 98, h: 101, l: 97, c: 99 },
  { t: Date.parse("2026-08-20T04:00:00Z"), o: 99, h: 102, l: 98, c: 100 },
  { t: Date.parse("2026-08-21T04:00:00Z"), o: 102, h: 103, l: 96, c: 97 },
];

describe("a reaction from a session that has not closed says so", () => {
  const byYmd = indexBarsByYmd(BARS);
  const ordered = [...byYmd.keys()].sort();

  test("the live defect: a BMO print mid-session is NOT presented as measured", () => {
    // Production returned a settled-looking measure at 09:46 ET on a session closing at 16:00,
    // with no provisional marker anywhere in the payload.
    const live = reactionForPrint(byYmd, ordered, "2026-08-21", "bmo", "2026-08-21");
    assert.equal(live.reaction_measure, "prior_close_to_last");
    assert.equal(live.reaction_settled, false);
    // 100 -> 97. Was -4.9 (102 -> 97) while BMO was read open→close; that read started AFTER the
    // premarket gap and is the defect fixed alongside this one.
    assert.equal(live.reaction_pct, -3, "the value is still reported — it is real, just not final");
    assert.equal(live.reaction_basis, "bmo_session", "the basis is unchanged; only the far end moved");
  });

  test("the SAME print after the close is settled", () => {
    const done = reactionForPrint(byYmd, ordered, "2026-08-21", "bmo", null);
    assert.equal(done.reaction_measure, "prior_close_to_close");
    assert.equal(done.reaction_settled, true);
    assert.equal(done.reaction_pct, -3, "same number — the label changes, not the arithmetic");
  });

  test("an AMC print anchored on the open session is prior_close_to_last", () => {
    // Yesterday's post-close print is being priced in TODAY's still-running session.
    const amc = reactionForPrint(byYmd, ordered, "2026-08-20", "amc", "2026-08-21");
    assert.equal(amc.reaction_measure, "prior_close_to_last");
    assert.equal(amc.reaction_settled, false);
    assert.equal(amc.reaction_pct, -3, "100 -> 97, gap included");
  });

  test("history is untouched — only the anchor session in progress is provisional", () => {
    // The whole risk of this change is mislabelling settled history as unsettled.
    // 08-20, not 08-19: a BMO reaction is measured from the session BEFORE the print, and 08-19
    // is the oldest bar in this fixture, so it has none. That case is covered in
    // meridian-reaction-core.test.ts ("no session before it yields no reaction, not a fallback").
    const old = reactionForPrint(byYmd, ordered, "2026-08-20", "bmo", "2026-08-21");
    assert.equal(old.reaction_measure, "prior_close_to_close");
    assert.equal(old.reaction_settled, true);
    assert.equal(old.reaction_pct, 1.01, "99 -> 100, both sessions long closed");

    const oldAmc = reactionForPrint(byYmd, ordered, "2026-08-19", "amc", "2026-08-21");
    assert.equal(oldAmc.reaction_measure, "prior_close_to_close", "anchors on 08-20, which closed");
    assert.equal(oldAmc.reaction_settled, true);
  });

  test("nothing measured means no settled claim either", () => {
    const none = reactionForPrint(byYmd, ordered, "2026-08-21", "amc", "2026-08-21");
    assert.equal(none.reaction_pct, null, "no session after today in this series");
    assert.equal(none.reaction_settled, null, "null, not false — we did not measure anything");
    assert.equal(none.reaction_measure, null);
  });

  test("the batch threads the open session to every print", () => {
    const out = reactionsForPrints(
      BARS,
      [{ ymd: "2026-08-21", timing: "bmo" }, { ymd: "2026-08-20", timing: "bmo" }],
      "2026-08-21"
    );
    assert.equal(out.get("2026-08-21")?.reaction_settled, false);
    assert.equal(out.get("2026-08-20")?.reaction_settled, true);
  });

  test("defaulting to no open session keeps every existing caller settled", () => {
    // The parameter defaults to null so an un-updated caller cannot start emitting `false`.
    const out = reactionsForPrints(BARS, [{ ymd: "2026-08-21", timing: "bmo" }]);
    assert.equal(out.get("2026-08-21")?.reaction_settled, true);
  });
});
