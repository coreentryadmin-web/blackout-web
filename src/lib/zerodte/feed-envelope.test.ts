import { strict as assert } from "node:assert";
import test from "node:test";
import { zeroDteFeedEmptyEnvelope, zeroDtePlaysToolEnvelope } from "./feed-envelope";

// The defect, stated once: `plays: []` served both "the scanner ran and nothing cleared the gates"
// and "we could not see the board". Only the first is reportable to a member.

test("an unreadable board omits `plays` entirely — an empty array is what let it read as quiet", () => {
  const e = zeroDtePlaysToolEnvelope({ upstreamOk: false, session_date: "2026-08-21", playCount: 0 });
  assert.equal(e.available, false);
  assert.equal(e.degraded, true);
  assert.equal(e.reason, "board_upstream_unavailable");
  assert.equal("plays" in e, false, "nothing downstream may count zero and call it a measurement");
  assert.match(String(e.note), /NOT 'no plays today'/);
});

test("a measured quiet session says so, and is reportable", () => {
  const e = zeroDtePlaysToolEnvelope({ upstreamOk: true, session_date: "2026-08-21", playCount: 0 });
  assert.equal(e.available, true);
  assert.equal(e.state, "no_plays_committed");
  assert.equal(e.degraded, undefined);
  assert.match(String(e.note), /MEASURED empty result/);
});

test("the two empty states never serialize alike", () => {
  const quiet = zeroDtePlaysToolEnvelope({ upstreamOk: true, session_date: "2026-08-21", playCount: 0 });
  const blind = zeroDtePlaysToolEnvelope({ upstreamOk: false, session_date: "2026-08-21", playCount: 0 });
  assert.notEqual(JSON.stringify(quiet), JSON.stringify(blind));
  assert.notEqual(quiet.available, blind.available);
});

test("known plays on a degraded board are reportable, but say the marks may be stale", () => {
  const e = zeroDtePlaysToolEnvelope({ upstreamOk: false, session_date: "2026-08-21", playCount: 3 });
  assert.equal(e.available, true, "the rows are real — withholding them would be its own lie");
  assert.equal(e.degraded, true);
  assert.equal(e.upstream_ok, false);
  assert.equal(e.state, "plays_committed");
  assert.match(String(e.note), /may be stale/);
});

test("a healthy board with plays carries its provenance and no needless caveat", () => {
  const e = zeroDtePlaysToolEnvelope({ upstreamOk: true, session_date: "2026-08-21", playCount: 3 });
  assert.equal(e.available, true);
  assert.equal(e.upstream_ok, true);
  assert.equal(e.state, "plays_committed");
  assert.equal(e.degraded, undefined);
  assert.equal(e.note, undefined);
});

test("every branch states the ET session it is talking about", () => {
  for (const [upstreamOk, playCount] of [[true, 0], [false, 0], [true, 2], [false, 2]] as const) {
    const e = zeroDtePlaysToolEnvelope({ upstreamOk, session_date: "2026-08-21", playCount });
    assert.equal(e.session_date, "2026-08-21", `missing session anchor for ${upstreamOk}/${playCount}`);
  }
});

// The live-feed half, moved here from scan.ts with the tool half so the two cannot drift.
test("the live feed's unreadable ledger is an UNKNOWN, not a quiet session", () => {
  const blind = zeroDteFeedEmptyEnvelope(false, "2026-08-21");
  assert.equal(blind.available, false);
  assert.equal(blind.reason, "ledger_unreadable");
  assert.equal("plays" in blind, false);
});

test("both Largo surfaces refuse to publish an unknown as an empty list", () => {
  // The actual guarantee of putting them in one module: the same silence cannot mean two things.
  const feed = zeroDteFeedEmptyEnvelope(false, "2026-08-21");
  const tool = zeroDtePlaysToolEnvelope({ upstreamOk: false, session_date: "2026-08-21", playCount: 0 });
  for (const e of [feed, tool]) {
    assert.equal(e.available, false);
    assert.equal(e.degraded, true);
    assert.equal("plays" in e, false);
    assert.match(String(e.note), /NOT/);
  }
});
