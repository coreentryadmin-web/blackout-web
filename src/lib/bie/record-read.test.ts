import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRecordAnswer } from "@/lib/bie/record-read";
import { emptyTrackRecord } from "@/lib/track-record-public";

describe("record-read", () => {
  it("formats empty record honestly", () => {
    const text = formatRecordAnswer(emptyTrackRecord());
    assert.match(text, /No closed plays/i);
  });

  it("formats aggregate stats", () => {
    const text = formatRecordAnswer({
      ...emptyTrackRecord(),
      available: true,
      total_closed: 42,
      days_of_data: 10,
      win_rate_pct: 62,
      wins: 26,
      losses: 14,
      breakeven: 2,
      paths: {
        cold_buy: { count: 30, win_rate_pct: 60, avg_mfe_pts: 4.2 },
        watch_promote: { count: 12, win_rate_pct: 67, avg_mfe_pts: 5.1 },
      },
      adaptive_active: true,
      summary: "Gates tightened after cold streak.",
    });
    assert.match(text, /42/);
    assert.match(text, /62%/);
    assert.match(text, /Cold buy/);
  });

  // ── The member-facing Night Hawk sentence (live defect, 2026-08-06) ───────────────────
  // It read "Night Hawk: 0% win rate · 22 graded pick(s)" in the premium Largo terminal.
  // The 0% came from a DECIDED denominator (0 wins / 2 losses) while the 22 was the
  // scoreable row count — two different populations quoted as one, implying 0-for-22 when
  // 20 of those 22 plays never touched their target OR their stop.
  const liveComparison = {
    days: 30,
    spx_win_rate: 0.565,
    spx_signal_count: 46,
    nighthawk_win_rate: 0,
    nighthawk_signal_count: 22,
    nighthawk_pending_count: 5,
    nighthawk_decided: 2,
    nighthawk_wins: 0,
    nighthawk_losses: 2,
    nighthawk_opens: 20,
    nighthawk_low_n: true,
    win_rate_delta: 0.565,
  };

  it("never quotes a Night Hawk win rate against a sample size that did not produce it", () => {
    const text = formatRecordAnswer(emptyTrackRecord(), liveComparison);
    assert.doesNotMatch(
      text,
      /0% win rate · 22 graded pick/,
      "the exact live string — a decided-denominator rate paired with the scoreable count"
    );
    assert.match(text, /insufficient decided sample/, "a thin sample must say so, not quote a rate");
    assert.match(text, /0 win\(s\) \/ 2 loss\(es\)/, "raw counts are honest at any sample size");
    assert.match(text, /20 closed without touching target or stop/);
    assert.match(text, /5 still pending/);
  });

  it("suppresses the win-rate delta when Night Hawk has no readable decided sample", () => {
    const text = formatRecordAnswer(emptyTrackRecord(), liveComparison);
    assert.doesNotMatch(text, /Win-rate delta \(SPX − NH\): \*\*/, "no bold delta off a 2-outcome sample");
    assert.match(text, /not computable/);
  });

  it("still quotes the rate — against the DECIDED n — once the sample is readable", () => {
    const text = formatRecordAnswer(emptyTrackRecord(), {
      ...liveComparison,
      nighthawk_win_rate: 0.6,
      nighthawk_decided: 10,
      nighthawk_wins: 6,
      nighthawk_losses: 4,
      nighthawk_opens: 12,
      nighthawk_low_n: false,
    });
    assert.match(text, /60% win rate · 10 decided pick\(s\) of 22 scoreable/);
    assert.match(text, /Win-rate delta \(SPX − NH\)/);
  });
});
