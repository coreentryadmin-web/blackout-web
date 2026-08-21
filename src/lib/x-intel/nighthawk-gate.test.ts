import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  headlineWinners,
  nightHawkPostGate,
  NIGHT_HAWK_WINNER_THRESHOLD_PCT,
  type NightHawkClosedPlay,
} from "@/lib/x-intel/nighthawk-gate";

const play = (ticker: string, pnl_pct: number): NightHawkClosedPlay => ({
  ticker, contract: "0DTE", pnl_pct, window_et: "10:33→10:45", grade: "A",
});

// The operator's own exemplar session: +97% at the top, -23% at the bottom.
const REAL_SESSION = [
  play("AMZN", 97), play("LUNR", 90), play("SOUN", 89), play("TTD", 68),
  play("LITE", 62), play("IONQ", 40), play("MU", 34), play("SPXW", 29),
  play("NBIS", 0), play("UBER", -2), play("TSLA", -23),
];

describe("nightHawkPostGate", () => {
  it("publishes a green session with a >50% winner", () => {
    const v = nightHawkPostGate({ closed: REAL_SESSION, session_pnl_r: 3.3 });
    assert.equal(v.publishable, true);
    assert.equal(v.publishable && v.headline_play.ticker, "AMZN");
  });

  it("names the other winners in the basis so the post is not one cherry-picked play", () => {
    const v = nightHawkPostGate({ closed: REAL_SESSION, session_pnl_r: 3.3 });
    assert.ok(v.publishable && /other play/.test(v.basis));
    assert.ok(v.publishable && /session \+3\.3R/.test(v.basis));
  });

  it("REFUSES a red session even with a big winner — that is a cherry-pick", () => {
    const v = nightHawkPostGate({ closed: REAL_SESSION, session_pnl_r: -2.8 });
    assert.equal(v.publishable, false);
    assert.match(v.publishable ? "" : v.reason, /red|cherry-pick/i);
  });

  it("REFUSES a green session whose best play did not clear the threshold", () => {
    const v = nightHawkPostGate({
      closed: [play("A", 12), play("B", 40), play("C", 49)],
      session_pnl_r: 1.1,
    });
    assert.equal(v.publishable, false);
    assert.match(v.publishable ? "" : v.reason, /above \+50%/);
    assert.match(v.publishable ? "" : v.reason, /best was C \+49%/);
  });

  it("treats exactly 50% as NOT clearing — the rule is above 50", () => {
    const v = nightHawkPostGate({ closed: [play("X", NIGHT_HAWK_WINNER_THRESHOLD_PCT)], session_pnl_r: 1 });
    assert.equal(v.publishable, false);
  });

  it("REFUSES when the session P&L is unknown — absence is not a green day", () => {
    const v = nightHawkPostGate({ closed: REAL_SESSION, session_pnl_r: null });
    assert.equal(v.publishable, false);
    assert.match(v.publishable ? "" : v.reason, /could not be read/);
  });

  it("REFUSES a session with no closed plays", () => {
    const v = nightHawkPostGate({ closed: [], session_pnl_r: 2 });
    assert.equal(v.publishable, false);
    assert.match(v.publishable ? "" : v.reason, /no closed/);
  });

  it("ignores plays with a non-finite P&L rather than ranking them", () => {
    const v = nightHawkPostGate({
      closed: [{ ...play("BAD", Number.NaN) }, play("GOOD", 80)],
      session_pnl_r: 1,
    });
    assert.equal(v.publishable && v.headline_play.ticker, "GOOD");
  });

  it("a flat session (0R) is not red, so it may publish", () => {
    const v = nightHawkPostGate({ closed: [play("X", 90)], session_pnl_r: 0 });
    assert.equal(v.publishable, true);
  });
});

describe("headlineWinners", () => {
  it("returns only plays above the threshold, best first", () => {
    const w = headlineWinners(REAL_SESSION);
    assert.deepEqual(w.map((p) => p.ticker), ["AMZN", "LUNR", "SOUN", "TTD", "LITE"]);
  });

  it("never includes a loser — the frame is the winning stack, not the whole tab", () => {
    for (const p of headlineWinners(REAL_SESSION)) assert.ok(p.pnl_pct > 50);
  });

  it("caps the stack", () => {
    assert.equal(headlineWinners(REAL_SESSION, 3).length, 3);
  });
});
