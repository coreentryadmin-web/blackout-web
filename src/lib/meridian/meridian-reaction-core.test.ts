import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reactionForYmd,
  indexBarsByYmd,
  classifyPrintTiming,
  reactionForPrint,
  reactionsForPrints,
  barLimitForWindow,
  type DailyBarLike,
} from "./meridian-reaction-core";

test("reactionForYmd: session and next-day pct from daily bars", () => {
  const bars = [
    { t: Date.parse("2026-07-10T13:30:00Z"), o: 100, h: 101, l: 99, c: 102 },
    { t: Date.parse("2026-07-11T13:30:00Z"), o: 102, h: 104, l: 101, c: 103 },
  ];
  const byYmd = indexBarsByYmd(bars);
  const ordered = [...byYmd.keys()].sort();
  const target = ordered[0]!;
  const rx = reactionForYmd(byYmd, ordered, target);
  assert.equal(rx.session_change_pct, 2);
  assert.equal(rx.next_day_change_pct, 0.98);
});

// ── Earnings print timing (BMO/AMC anchoring) ───────────────────────────────────────
// Live 2026-08-17: print_history session_change_pct was null on every recent print across
// HTHT/FN/BIDU while the two OLDEST filled — a fixed limit=120 under a ~380-day window
// returned only the oldest 120 sessions (Polygon sorts asc). Fixed in meridian-reaction.ts;
// these cover the second defect found alongside it — which SESSION a print's reaction is.

test("classifyPrintTiming: bell-relative buckets", () => {
  assert.equal(classifyPrintTiming("06:30:00"), "bmo");
  assert.equal(classifyPrintTiming("09:30:00"), "bmo", "09:30 sharp is still pre-open");
  assert.equal(classifyPrintTiming("16:00:00"), "amc", "16:00 sharp is post-close");
  assert.equal(classifyPrintTiming("16:05:00"), "amc");
  // Mid-session is genuinely ambiguous — bucketing it would invent a basis we cannot support.
  assert.equal(classifyPrintTiming("12:00:00"), "unknown");
  assert.equal(classifyPrintTiming(null), "unknown");
  assert.equal(classifyPrintTiming(""), "unknown");
  assert.equal(classifyPrintTiming("garbage"), "unknown");
});

const BARS: DailyBarLike[] = [
  // t = 04:00Z, which is how Polygon stamps a daily bar and maps to the same ET date.
  { t: Date.parse("2026-05-14T04:00:00Z"), o: 100, h: 101, l: 99, c: 102 }, // +2%
  { t: Date.parse("2026-05-15T04:00:00Z"), o: 102, h: 120, l: 101, c: 112 }, // +9.8%
  { t: Date.parse("2026-05-18T04:00:00Z"), o: 112, h: 115, l: 110, c: 114 },
];

test("AMC print reads the NEXT session — not the pre-print drift", () => {
  const byYmd = indexBarsByYmd(BARS);
  const ordered = [...byYmd.keys()].sort();
  const rx = reactionForPrint(byYmd, ordered, "2026-05-14", "amc");
  // Reported AFTER 05-14's close, so the market traded it on 05-15: open 102 → close 112.
  assert.equal(rx.session_change_pct, 9.8);
  assert.equal(rx.reaction_basis, "amc_next_session");
  // This fixture opens exactly where it closed (102 → 102), so it has NO overnight gap and
  // both reads agree. That is precisely why it could not see the gap bug; GAP_BARS can.
  assert.equal(rx.reaction_pct, 9.8);
  assert.equal(rx.reaction_measure, "prior_close_to_close");
});

// A post-close print that GAPS and then fades — the shape that makes an open→close read lie.
// Modelled on MSFT 2025-04-30 (gapped +9.07%, drifted -1.32%, net +7.63%).
const GAP_BARS: DailyBarLike[] = [
  { t: Date.parse("2026-05-14T04:00:00Z"), o: 98, h: 101, l: 97, c: 100 },   // print lands after this close
  { t: Date.parse("2026-05-15T04:00:00Z"), o: 109, h: 110, l: 106, c: 107 }, // gap +9%, then -1.83% intraday
  { t: Date.parse("2026-05-18T04:00:00Z"), o: 107, h: 108, l: 105, c: 106 },
];

test("an AMC reaction contains the overnight gap — an open→close read INVERTS its sign", () => {
  const byYmd = indexBarsByYmd(GAP_BARS);
  const ordered = [...byYmd.keys()].sort();
  const rx = reactionForPrint(byYmd, ordered, "2026-05-14", "amc");

  // What the market did to the print: 100 → 107, up 7%.
  assert.equal(rx.reaction_pct, 7);
  assert.equal(rx.reaction_measure, "prior_close_to_close");
  assert.equal(rx.reaction_basis, "amc_next_session");

  // What the anchor session's own open→close says: DOWN 1.83%. Right session, wrong measure,
  // opposite sign. Measured live, this happens on 31.6% of post-close prints.
  assert.equal(rx.session_change_pct, -1.83);
  assert.notEqual(Math.sign(rx.reaction_pct!), Math.sign(rx.session_change_pct!));
});

test("a BMO print's reaction IS its session — the two reads must not drift apart", () => {
  const byYmd = indexBarsByYmd(GAP_BARS);
  const ordered = [...byYmd.keys()].sort();
  const rx = reactionForPrint(byYmd, ordered, "2026-05-15", "bmo");
  // Pre-open print: the market has the whole session to price it, so open→close is the reaction
  // and the prior close belongs to news nobody had yet.
  assert.equal(rx.reaction_pct, rx.session_change_pct);
  assert.equal(rx.reaction_pct, -1.83);
  assert.equal(rx.reaction_measure, "session_open_to_close");
});

test("an unknown-timing print is read as its own session, and says so", () => {
  // 1.8% of live Benzinga prints (176/9694 over 2026-04-01..2026-08-20) carry a mid-session
  // timestamp — none are null or empty. A release at 14:00 IS priced in that session, so the
  // open→close read is the right assumption; `assumed_report_session` marks that it is one.
  const byYmd = indexBarsByYmd(GAP_BARS);
  const ordered = [...byYmd.keys()].sort();
  const rx = reactionForPrint(byYmd, ordered, "2026-05-15", "unknown");
  assert.equal(rx.reaction_measure, "session_open_to_close");
  assert.equal(rx.reaction_pct, rx.session_change_pct);
  assert.equal(rx.reaction_basis, "assumed_report_session");
});

test("an AMC print whose own report-date bar is missing yields no reaction, not a guess", () => {
  // Without the close BEFORE the print there is no anchor for the gap. Reporting the anchor
  // session's open→close here would quietly substitute a different quantity.
  const byYmd = indexBarsByYmd(GAP_BARS);
  byYmd.delete("2026-05-14");
  const ordered = [...byYmd.keys()].sort();
  const rx = reactionForPrint(byYmd, ordered, "2026-05-14", "amc");
  assert.equal(rx.reaction_pct, null);
  assert.equal(rx.reaction_measure, null, "no measure is claimed without a value to describe");
  assert.equal(rx.session_change_pct, -1.83, "the anchor session itself is still reported as such");
});

test("BMO print reads its own session", () => {
  const byYmd = indexBarsByYmd(BARS);
  const ordered = [...byYmd.keys()].sort();
  const rx = reactionForPrint(byYmd, ordered, "2026-05-15", "bmo");
  assert.equal(rx.session_change_pct, 9.8);
  assert.equal(rx.reaction_basis, "bmo_session");
});

test("the two anchorings genuinely disagree — this is the bug, not a nuance", () => {
  const byYmd = indexBarsByYmd(BARS);
  const ordered = [...byYmd.keys()].sort();
  const amc = reactionForPrint(byYmd, ordered, "2026-05-14", "amc");
  const naive = reactionForPrint(byYmd, ordered, "2026-05-14", "unknown");
  assert.equal(naive.session_change_pct, 2, "the report date's own session — pre-print drift");
  assert.notEqual(amc.session_change_pct, naive.session_change_pct);
  assert.equal(naive.reaction_basis, "assumed_report_session", "and it is labelled as assumed");
});

test("an AMC print with no following session yields nulls, never a fabricated move", () => {
  const byYmd = indexBarsByYmd(BARS);
  const ordered = [...byYmd.keys()].sort();
  const rx = reactionForPrint(byYmd, ordered, "2026-05-18", "amc"); // newest bar, nothing after
  assert.equal(rx.session_change_pct, null);
  assert.equal(rx.next_day_change_pct, null);
  assert.equal(rx.reaction_basis, null, "no basis is claimed when nothing was measured");
  assert.equal(rx.reaction_pct, null);
  assert.equal(rx.reaction_measure, null);
});

test("reactionsForPrints batches per-print timing", () => {
  const out = reactionsForPrints(BARS, [
    { ymd: "2026-05-14", timing: "amc" },
    { ymd: "2026-05-15", timing: "bmo" },
  ]);
  assert.equal(out.get("2026-05-14")?.reaction_basis, "amc_next_session");
  assert.equal(out.get("2026-05-15")?.reaction_basis, "bmo_session");
});

test("barLimitForWindow: the limit tracks the window — the root cause of the null reactions", () => {
  // The real failing case: oldest print ~1yr back, window runs to today. 120 could not
  // reach the recent prints; the derived limit does.
  const yearLimit = barLimitForWindow("2025-08-06", "2026-08-18");
  assert.ok(yearLimit > 250, `a ~377-day window needs >250 sessions, got ${yearLimit}`);
  assert.ok(yearLimit < 400, `and should not over-fetch wildly, got ${yearLimit}`);
  // 8 quarters (the loadMeridianEarningsPrintHistory default limit) must also fit.
  assert.ok(barLimitForWindow("2024-08-01", "2026-08-18") > 500);
  // Short windows stay cheap.
  assert.equal(barLimitForWindow("2026-08-01", "2026-08-18"), 120);
  // Malformed / inverted ranges fall back rather than throwing or requesting the world.
  assert.equal(barLimitForWindow("2026-08-18", "2026-08-01"), 120);
  assert.equal(barLimitForWindow("nonsense", "2026-08-18"), 120);
  assert.ok(barLimitForWindow("1900-01-01", "2026-08-18") <= 5000, "capped");
});
