import assert from "node:assert/strict";
import test from "node:test";
import {
  rollupVerdict,
  verdictForEdition,
  verdictForMarkRow,
  verdictForMarks,
  verdictForRecord,
} from "./legacy-healthcheck-eval.mjs";

test("rollupVerdict: worst-of, RED beats everything", () => {
  assert.equal(rollupVerdict(["GREEN", "AMBER", "RED"]), "RED");
  assert.equal(rollupVerdict(["GREEN", "AMBER"]), "AMBER");
  assert.equal(rollupVerdict(["GREEN", "SKIPPED"]), "GREEN");
  assert.equal(rollupVerdict(["GREEN"]), "GREEN");
});

test("rollupVerdict: SKIPPED never masks a real RED/AMBER among the judged stages", () => {
  assert.equal(rollupVerdict(["SKIPPED", "RED", "GREEN"]), "RED");
  assert.equal(rollupVerdict(["SKIPPED", "AMBER", "GREEN"]), "AMBER");
});

test("rollupVerdict: all-SKIPPED rolls up to SKIPPED, not a fabricated GREEN", () => {
  assert.equal(rollupVerdict(["SKIPPED", "SKIPPED"]), "SKIPPED");
});

test("verdictForEdition: fetch failure is RED, never silently empty", () => {
  assert.equal(verdictForEdition({ fetchOk: false }).verdict, "RED");
});

test("verdictForEdition: no edition published yet is an honest AMBER, not RED", () => {
  assert.equal(verdictForEdition({ fetchOk: true, available: false }).verdict, "AMBER");
});

test("verdictForEdition: degraded and stale are both AMBER", () => {
  assert.equal(verdictForEdition({ fetchOk: true, available: true, degraded: true, playsCount: 3 }).verdict, "AMBER");
  assert.equal(verdictForEdition({ fetchOk: true, available: true, stale: true, playsCount: 3 }).verdict, "AMBER");
});

test("verdictForEdition: honest no_plays is GREEN, not a defect", () => {
  assert.equal(
    verdictForEdition({ fetchOk: true, available: true, playsCount: 0, noPlays: true }).verdict,
    "GREEN"
  );
});

test("verdictForEdition: available with zero plays and no_plays unset is RED (contract violation)", () => {
  assert.equal(
    verdictForEdition({ fetchOk: true, available: true, playsCount: 0, noPlays: false }).verdict,
    "RED"
  );
});

test("verdictForEdition: healthy edition is GREEN", () => {
  assert.equal(verdictForEdition({ fetchOk: true, available: true, playsCount: 3 }).verdict, "GREEN");
});

test("verdictForMarkRow: missing row is RED", () => {
  assert.equal(verdictForMarkRow(null).verdict, "RED");
});

test("verdictForMarkRow: null mark (no live quote yet) is AMBER, not RED", () => {
  assert.equal(verdictForMarkRow({ mark: null, bid: null, ask: null }).verdict, "AMBER");
});

test("verdictForMarkRow: negative or zero mark is RED", () => {
  assert.equal(verdictForMarkRow({ mark: -1, bid: 1, ask: 2 }).verdict, "RED");
  assert.equal(verdictForMarkRow({ mark: 0, bid: 0, ask: 1 }).verdict, "RED");
});

test("verdictForMarkRow: NaN mark is RED", () => {
  assert.equal(verdictForMarkRow({ mark: NaN, bid: 1, ask: 2 }).verdict, "RED");
});

test("verdictForMarkRow: crossed book (bid > ask) is RED", () => {
  assert.equal(verdictForMarkRow({ mark: 1.5, bid: 2, ask: 1 }).verdict, "RED");
});

test("verdictForMarkRow: mark outside [bid,ask] is RED", () => {
  assert.equal(verdictForMarkRow({ mark: 5, bid: 1, ask: 2 }).verdict, "RED");
  assert.equal(verdictForMarkRow({ mark: 0.5, bid: 1, ask: 2 }).verdict, "RED");
});

test("verdictForMarkRow: mark exactly at the bid/ask edge is GREEN, not falsely RED", () => {
  assert.equal(verdictForMarkRow({ mark: 1, bid: 1, ask: 2 }).verdict, "GREEN");
  assert.equal(verdictForMarkRow({ mark: 2, bid: 1, ask: 2 }).verdict, "GREEN");
});

test("verdictForMarkRow: stale flag is AMBER, not RED", () => {
  assert.equal(verdictForMarkRow({ mark: 1.5, bid: 1, ask: 2, stale: true }).verdict, "AMBER");
});

test("verdictForMarkRow: clean mark within bid/ask is GREEN", () => {
  assert.equal(verdictForMarkRow({ mark: 1.5, bid: 1, ask: 2, stale: false }).verdict, "GREEN");
});

test("verdictForMarks: fetch failure is RED", () => {
  assert.equal(verdictForMarks({ fetchOk: false, requestedOccs: ["A"], rows: [] }).verdict, "RED");
});

test("verdictForMarks: no open plays with an OCC is GREEN (nothing to check)", () => {
  assert.equal(verdictForMarks({ fetchOk: true, requestedOccs: [], rows: [] }).verdict, "GREEN");
});

test("verdictForMarks: one bad row drags the whole stage to RED", () => {
  const res = verdictForMarks({
    fetchOk: true,
    requestedOccs: ["GOOD1", "BAD1"],
    rows: [
      { occ: "GOOD1", mark: 1.5, bid: 1, ask: 2 },
      { occ: "BAD1", mark: -1, bid: 1, ask: 2 },
    ],
  });
  assert.equal(res.verdict, "RED");
});

test("verdictForMarks: all clean rows is GREEN", () => {
  const res = verdictForMarks({
    fetchOk: true,
    requestedOccs: ["A", "B"],
    rows: [
      { occ: "A", mark: 1.5, bid: 1, ask: 2 },
      { occ: "B", mark: 0.5, bid: 0.3, ask: 0.6 },
    ],
  });
  assert.equal(res.verdict, "GREEN");
});

test("verdictForMarks: OCC casing is normalized before lookup", () => {
  const res = verdictForMarks({
    fetchOk: true,
    requestedOccs: ["abc123"],
    rows: [{ occ: "ABC123", mark: 1, bid: 1, ask: 1 }],
  });
  assert.equal(res.verdict, "GREEN");
});

test("verdictForRecord: fetch failure is RED", () => {
  assert.equal(verdictForRecord({ fetchOk: false }).verdict, "RED");
});

test("verdictForRecord: missing segment is AMBER, not RED", () => {
  assert.equal(verdictForRecord({ fetchOk: true, segment: null }).verdict, "AMBER");
});

test("verdictForRecord: buckets summing to resolved is GREEN", () => {
  const res = verdictForRecord({
    fetchOk: true,
    segment: { resolved: 10, wins: 2, losses: 3, opens: 4, ambiguous: 0, unfilled: 1, pulled: 0, stop_data_unavailable: 0 },
  });
  assert.equal(res.verdict, "GREEN");
});

test("verdictForRecord: buckets NOT summing to resolved is RED (a real payload defect)", () => {
  const res = verdictForRecord({
    fetchOk: true,
    segment: { resolved: 10, wins: 2, losses: 3, opens: 4, ambiguous: 0, unfilled: 0, pulled: 0, stop_data_unavailable: 0 },
  });
  assert.equal(res.verdict, "RED");
});
