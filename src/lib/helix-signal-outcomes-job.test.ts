import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { windowStartIso, gradeOutcome, buildSignalPopulation } from "./helix-signal-outcomes-job";

test("windowStartIso: buckets a timestamp to the start of its window (idempotent dedup key)", () => {
  const t1 = Date.parse("2026-08-02T14:07:00.000Z");
  const t2 = Date.parse("2026-08-02T14:12:00.000Z"); // same 15-min bucket as t1
  const t3 = Date.parse("2026-08-02T14:16:00.000Z"); // next 15-min bucket

  const bucket1 = windowStartIso(t1, 15 * 60_000);
  const bucket2 = windowStartIso(t2, 15 * 60_000);
  const bucket3 = windowStartIso(t3, 15 * 60_000);

  assert.equal(bucket1, bucket2, "same 15-min bucket must produce the same window_start");
  assert.notEqual(bucket1, bucket3, "the next bucket must produce a different window_start");
});

test("gradeOutcome: bullish signal graded 'continued' only when price actually rose", () => {
  assert.equal(gradeOutcome("bullish", 100, 102), "continued");
  assert.equal(gradeOutcome("bullish", 100, 98), "reversed");
});

test("gradeOutcome: bearish signal graded 'continued' only when price actually fell", () => {
  assert.equal(gradeOutcome("bearish", 100, 98), "continued");
  assert.equal(gradeOutcome("bearish", 100, 102), "reversed");
});

test("gradeOutcome: a move smaller than the flat threshold reads as 'flat', regardless of direction", () => {
  assert.equal(gradeOutcome("bullish", 100, 100.05), "flat");
  assert.equal(gradeOutcome("bearish", 100, 99.98), "flat");
});

test("gradeOutcome: a directionless signal (velocity spike) grades any real move as 'continued'", () => {
  assert.equal(gradeOutcome(null, 100, 103), "continued");
  assert.equal(gradeOutcome(null, 100, 97), "continued");
  assert.equal(gradeOutcome(null, 100, 100.01), "flat");
});

// ── §9.6 — every firing records what it was computed over ──────────────────────────────────────

test("buildSignalPopulation records the denominator both detectors could actually see", () => {
  const iso = "2026-08-23T18:00:00.000Z";
  const flows = [
    // Group A: datable, so both detectors can see them.
    { ticker: "NVDA", premium: 1, event_at: iso },
    { ticker: "TSLA", premium: 1, event_at: iso },
    // Group B: the index feed's shape — an ESTIMATED time is an ingest time, not a print time,
    // so neither detector can place these in a window. Live, this is 70% of the tape.
    { ticker: "SPX", premium: 1, alerted_at: iso, tape_time_estimated: true },
    { ticker: "SPX", premium: 1, alerted_at: iso, tape_time_estimated: true },
    { ticker: "SPX", premium: 1, alerted_at: iso, tape_time_estimated: true },
    { ticker: "SPY", premium: 1, alerted_at: iso, tape_time_estimated: true },
  ];
  const p = buildSignalPopulation(flows, { since_hours: 1, limit: 5000 });

  assert.equal(p.scanned, 6);
  assert.equal(p.signal_eligible, 2, "only the datable prints could fire anything");
  assert.equal(p.signal_ineligible, 4);
  // Named, commonest first — SPX before SPY, matching the live ordering.
  assert.deepEqual(p.signal_ineligible_tickers, ["SPX", "SPY"]);
  assert.equal(p.source, "cron_unfiltered");
  assert.equal(p.since_hours, 1);
  assert.equal(p.limit, 5000);
});

test("buildSignalPopulation says outright that it is NOT the client's population", () => {
  // The whole point of §9.6: the browser detects over the member's FILTERED buffer and this job
  // over an unfiltered read, so a badge and a row can legitimately differ. A row that does not
  // say which one it is cannot be used to describe what a member saw.
  const p = buildSignalPopulation([{ ticker: "NVDA", premium: 1, event_at: "2026-08-23T18:00:00.000Z" }], {
    since_hours: 1,
    limit: 5000,
  });
  assert.equal(p.client_equivalent, false);
});

test("buildSignalPopulation is honest on an empty and a fully-eligible scan", () => {
  const empty = buildSignalPopulation([], { since_hours: 1, limit: 5000 });
  assert.equal(empty.scanned, 0);
  assert.equal(empty.signal_eligible, 0);
  assert.equal(empty.signal_ineligible, 0);
  assert.deepEqual(empty.signal_ineligible_tickers, [], "an empty scan skipped nobody");

  const clean = buildSignalPopulation(
    [
      { ticker: "NVDA", premium: 1, event_at: "2026-08-23T18:00:00.000Z" },
      { ticker: "AMD", premium: 1, event_at: "2026-08-23T18:01:00.000Z" },
    ],
    { since_hours: 1, limit: 5000 }
  );
  assert.equal(clean.signal_ineligible, 0);
  assert.deepEqual(clean.signal_ineligible_tickers, [], "nothing was skipped, so nothing is named");
});

test("the named-ticker list is capped so a ledger row cannot become a ticker dump", () => {
  const flows = Array.from({ length: 60 }, (_, i) => ({ ticker: `T${String(i).padStart(2, "0")}`, premium: 1 }));
  const p = buildSignalPopulation(flows, { since_hours: 1, limit: 5000 });
  assert.equal(p.signal_ineligible, 60, "the COUNT stays complete");
  assert.equal(p.signal_ineligible_tickers.length, 20, "only the sample is capped");
});

test("both signal types carry the population — a stamp on one row type would be worse than none", () => {
  // Velocity and split rows are written in the same array literal, and stamping only one would
  // make the ledger's coverage silently partial. Source-asserted because the writer needs a DB.
  const src = readFileSync("src/lib/helix-signal-outcomes-job.ts", "utf8");
  // Slice each row builder from its signal_type marker to the price_at_fire that closes it, and
  // require the stamp inside BOTH. Counting bare occurrences was the first attempt and was brittle
  // for the wrong reason: one stamp ends `population }` and the other `population,`, so a
  // comma-anchored count found 1 of 2 and would have "passed" the day someone deleted the other.
  for (const type of ['"velocity_spike"', '"split_flow"']) {
    const start = src.indexOf(`signal_type: ${type}`);
    assert.ok(start > 0, `${type} row builder not found`);
    const end = src.indexOf("price_at_fire", start);
    assert.ok(end > start, `${type} row builder has no price_at_fire terminator`);
    assert.match(
      src.slice(start, end),
      /\bpopulation\b/,
      `${type} rows must carry the population — stamping only one row type makes the ledger's coverage silently partial`
    );
  }
  // And the header must carry the correction. Asserted as PRESENCE of the right statement rather
  // than absence of the wrong one: the header deliberately QUOTES the old claim in order to record
  // what it used to say, and an absence-assertion fired on that quotation — brittle for the wrong
  // reason, and it would have pushed the fix toward deleting the useful history.
  assert.match(
    src,
    /DIFFERENT POPULATION/,
    "the header must state that a shared detector over different inputs can legitimately disagree"
  );
});
