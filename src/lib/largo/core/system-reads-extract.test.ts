import test from "node:test";
import assert from "node:assert/strict";
import { extractSystemReads } from "./system-reads-extract";

const FLOW_TAPE = {
  recent: [
    { premium: 30_000_000, option_type: "CALL" },
    { premium: 5_000_000, option_type: "PUT" },
    ...Array.from({ length: 20 }, () => ({ premium: 1_000_000, option_type: "CALL" })),
  ],
};
const POSITIONING = { gamma_posture: "short", spot: 7757.58, flip: 7764.93, call_wall: 7775 };
const VECTOR = { play: { bias: "bullish", grade: "B", conviction: 73 }, spot: 7757 };
const SWING = {
  sample_plays: [{ ticker: "SPX", direction: "long", status: "OPEN" }],
  committed_count: 1,
  horizon: "swing",
};

test("reads are built from tool results already in the turn", () => {
  const b = extractSystemReads([FLOW_TAPE, POSITIONING, VECTOR, SWING], "SPX")!;
  assert.deepEqual(b.reads.map((r) => r.system), ["HELIX", "VECTOR", "NIGHT HAWK", "GAMMA"]);
  assert.equal(b.reads.find((r) => r.system === "HELIX")!.stance, "bullish");
  assert.equal(b.reads.find((r) => r.system === "VECTOR")!.strength, 73);
});

test("matched by SHAPE — an unrelated payload contributes nothing", () => {
  const b = extractSystemReads([{ some: "news payload" }, FLOW_TAPE, POSITIONING], "SPX")!;
  assert.deepEqual(b.reads.map((r) => r.system), ["HELIX", "GAMMA"]);
});

test("a system that was NOT consulted gets no row at all", () => {
  // Not the same as `no-read`: "we did not ask" vs "we asked and it had nothing".
  const b = extractSystemReads([FLOW_TAPE, POSITIONING], "SPX")!;
  assert.equal(b.reads.some((r) => r.system === "VECTOR"), false);
  assert.equal(b.reads.some((r) => r.system === "NIGHT HAWK"), false);
});

test("swing lane alone still produces Night Hawk row when ticker matches", () => {
  const b = extractSystemReads([FLOW_TAPE, POSITIONING, SWING], "SPX")!;
  assert.ok(b.reads.some((r) => r.system === "NIGHT HAWK"));
});

test("an empty zerodte lane for this ticker IS a finding when no edition exists", () => {
  const emptyLane = {
    sample_plays: [{ ticker: "NVDA", direction: "long" }],
    committed_count: 0,
    horizon: "swing",
  };
  const b = extractSystemReads([FLOW_TAPE, POSITIONING, emptyLane], "SPX")!;
  const nh = b.reads.find((r) => r.system === "NIGHT HAWK")!;
  assert.equal(nh.stance, "no-read");
  assert.equal(nh.reason, "no plays on this name");
});

test("evening edition pick for NVDA shows bullish even when zerodte board is empty", () => {
  const edition = {
    available: true,
    edition_for: "2026-08-11",
    plays: [{ ticker: "NVDA", direction: "long", conviction: "B", options_play: "Aug 12 $217.5 call" }],
  };
  const zerodte = { plays: [], fresh_finds: [] };
  const b = extractSystemReads([FLOW_TAPE, POSITIONING, edition, zerodte], "NVDA")!;
  const nh = b.reads.find((r) => r.system === "NIGHT HAWK")!;
  assert.equal(nh.stance, "bullish");
  assert.match(nh.basis, /evening edition/);
});

test("gamma is a REGIME row and never votes in the tally", () => {
  const b = extractSystemReads([FLOW_TAPE, POSITIONING], "SPX")!;
  assert.equal(b.reads.find((r) => r.system === "GAMMA")!.kind, "regime");
  assert.equal(b.agreement.voting, 1); // HELIX only
  assert.equal(b.agreement.verdict, "insufficient");
});

test("agreement is computed across the directional reads", () => {
  const bearVector = { play: { bias: "bearish", grade: "C", conviction: 40 } };
  const b = extractSystemReads([FLOW_TAPE, bearVector, POSITIONING], "SPX")!;
  assert.equal(b.agreement.voting, 2);
  assert.equal(b.agreement.verdict, "split");
  assert.equal(b.agreement.direction, null); // never a coin flip toward a majority
});

test("fewer than two systems yields NO block — one row is not a consensus", () => {
  assert.equal(extractSystemReads([FLOW_TAPE], "SPX"), null);
  assert.equal(extractSystemReads([{ unrelated: 1 }], "SPX"), null);
  assert.equal(extractSystemReads([], "SPX"), null);
  assert.equal(extractSystemReads(null, "SPX"), null);
});

test("no ticker means no Night Hawk row, but the rest still build", () => {
  const b = extractSystemReads([FLOW_TAPE, POSITIONING, SWING], null)!;
  assert.equal(b.reads.some((r) => r.system === "NIGHT HAWK"), false);
  assert.equal(b.reads.length, 2);
});

test("a flow tape with no usable prints is not treated as a tape", () => {
  const empty = { recent: [{ premium: 0 }, { premium: null }] };
  assert.equal(extractSystemReads([empty, POSITIONING], "SPX"), null);
});

test("positioning is discriminated by gamma_posture, not by spot alone", () => {
  // Several payloads carry `spot`; only the positioning read carries the posture.
  const spotOnly = { spot: 7757, flip: 7764 };
  assert.equal(extractSystemReads([FLOW_TAPE, spotOnly], "SPX"), null);
});
