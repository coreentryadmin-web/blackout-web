import assert from "node:assert/strict";
import test from "node:test";
import { filterPlaysByMerit } from "./edition-quality";
import type { PlaybookPlay } from "./types";

const play = (ticker: string, score: number): PlaybookPlay => ({
  rank: 1,
  ticker,
  direction: "LONG",
  conviction: "B",
  play_type: "stock",
  thesis: "",
  key_signal: "",
  entry_range: "-",
  target: "-",
  stop: "-",
  options_play: "-",
  score,
  confirming_signals: 3,
  earnings_risk: false,
});

test("filterPlaysByMerit drops plays below configured score floor", () => {
  const keys = ["NH_LEGACY_QUALITY_STRICT", "NH_MIN_PUBLISH_SCORE", "NH_LEGACY_MIN_TIER"] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  process.env.NH_LEGACY_QUALITY_STRICT = "1";
  process.env.NH_MIN_PUBLISH_SCORE = "50";
  process.env.NH_LEGACY_MIN_TIER = "B";
  try {
    const { plays, dropped } = filterPlaysByMerit(
      [play("WEAK", 44), play("STRONG", 67)],
      {}
    );
    assert.equal(plays.length, 1);
    assert.equal(plays[0]!.ticker, "STRONG");
    assert.equal(dropped.length, 1);
    assert.match(dropped[0]!.reason, /score 44/);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});
