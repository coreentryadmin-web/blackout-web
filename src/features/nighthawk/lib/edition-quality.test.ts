import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveSynthesisPool,
  filterPlaysByMerit,
  legacyGlobalStrongest,
} from "./edition-quality";
import { MAX_DOSSIER_STOCKS } from "./constants";
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

test("legacyGlobalStrongest defaults ON and uses full dossier pool", () => {
  const keys = ["NH_LEGACY_GLOBAL_STRONGEST"] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  delete process.env.NH_LEGACY_GLOBAL_STRONGEST;
  try {
    assert.equal(legacyGlobalStrongest(), true);
    assert.equal(effectiveSynthesisPool(), MAX_DOSSIER_STOCKS);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});

test("filterPlaysByMerit keeps highest merit and drops sub-floor names", () => {
  const keys = ["NH_LEGACY_GLOBAL_STRONGEST", "NH_MIN_PUBLISH_SCORE", "NH_LEGACY_MIN_TIER", "NH_LEGACY_MAX_PLAYS"] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  process.env.NH_LEGACY_GLOBAL_STRONGEST = "1";
  process.env.NH_MIN_PUBLISH_SCORE = "50";
  process.env.NH_LEGACY_MIN_TIER = "B";
  process.env.NH_LEGACY_MAX_PLAYS = "2";
  try {
    const { plays, dropped } = filterPlaysByMerit(
      [play("WEAK", 44), play("MID", 58), play("STRONG", 72)],
      {}
    );
    assert.equal(plays.length, 2);
    assert.equal(plays[0]!.ticker, "STRONG");
    assert.equal(plays[1]!.ticker, "MID");
    assert.equal(dropped.length, 1);
    assert.match(dropped[0]!.reason, /merit 44/);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});
