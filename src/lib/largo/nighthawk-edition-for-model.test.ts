import assert from "node:assert/strict";
import test from "node:test";

import { MAX_TOOL_RESULT_CHARS } from "@/lib/providers/anthropic";
import {
  DELEGATED_RECAP_BLOBS,
  compactNightHawkEditionForModel,
} from "@/lib/largo/nighthawk-edition-for-model";

/** A prod-weight edition. The sizes mirror the live 2026-08-21 measurement:
 *  market_recap 41,471B (spx_desk 21,914 + flow_tape 14,170 + ~5,362 edition-specific),
 *  plays 5,239B — the exact ratio that pushed every play past the tail cut. */
function fatEdition() {
  return {
    available: true,
    edition_for: "2026-08-21",
    published_at: "2026-08-20T21:30:00.000Z",
    recap_headline: "Tape held the flip",
    recap_summary: "s".repeat(360),
    market_recap: {
      spx_desk: { unified_tape: "u".repeat(21_000), gex_walls: "w".repeat(800) },
      flow_tape: { recent: "f".repeat(14_000) },
      catalysts: ["CPI 08:30"],
      sector_strength: ["semis"],
      sector_weakness: ["staples"],
      vix_term: { m1: 14.9, m2: 15.6 },
      vix_iv_rank: 22,
      tide: "up",
      index_flows: { SPY: 1_200_000 },
      hot_chains: [{ ticker: "NVDA", strike: 180 }],
      top_net_impact: [{ ticker: "TSLA", net: 900_000 }],
      sector_tides: { tech: 0.4 },
      index_dossiers: { SPY: "ok" },
      after_hours_catalysts: ["ANET earnings"],
      spx_vix: 14.9,
    },
    plays: Array.from({ length: 5 }, (_, i) => ({
      rank: i + 1,
      ticker: `TK${i}`,
      direction: "long",
      conviction: "A",
      score: 70 - i,
      thesis: "t".repeat(300),
      entry_range: [10, 10.5],
      target: 12,
      stop: 9.4,
      iv_rank: 30,
      rr_ratio: 2.1,
    })),
    recap_only: false,
    recap_only_reason: null,
    funnel: null,
  };
}

test("the whole result fits inside the transport cap", () => {
  const chars = JSON.stringify(compactNightHawkEditionForModel(fatEdition())).length;
  assert.ok(chars < MAX_TOOL_RESULT_CHARS, `edition is ${chars} chars, cap is ${MAX_TOOL_RESULT_CHARS}`);
});

test("every play survives — the defect was that none of them did", () => {
  const out = compactNightHawkEditionForModel(fatEdition());
  assert.equal((out.plays as unknown[]).length, 5);
  assert.equal(out.play_count, 5);
  const raw = JSON.stringify(out);
  assert.ok(
    raw.indexOf('"plays":') < MAX_TOOL_RESULT_CHARS,
    "plays must begin inside the cap — on the raw edition it began at char 42,001"
  );
});

test("plays are serialized BEFORE the recap, so a tail cut eats the recap", () => {
  const raw = JSON.stringify(compactNightHawkEditionForModel(fatEdition()));
  assert.ok(
    raw.indexOf('"plays":') < raw.indexOf('"market_recap":'),
    "key order is what decides survival under a tail cut"
  );
});

test("the delegated heavyweights are dropped", () => {
  const out = compactNightHawkEditionForModel(fatEdition());
  const recap = out.market_recap as Record<string, unknown>;
  for (const key of Object.keys(DELEGATED_RECAP_BLOBS)) {
    assert.ok(!(key in recap), `${key} must not ride the model's copy`);
  }
});

test("edition-specific recap content is KEPT — this is a diet, not an amputation", () => {
  const recap = compactNightHawkEditionForModel(fatEdition()).market_recap as Record<string, unknown>;
  for (const key of [
    "catalysts", "after_hours_catalysts", "sector_strength", "sector_weakness",
    "vix_term", "vix_iv_rank", "tide", "index_flows", "hot_chains",
    "top_net_impact", "sector_tides", "index_dossiers", "spx_vix",
  ]) {
    assert.ok(key in recap, `dropped edition-specific field: ${key}`);
  }
});

// A silently missing field reads as missing DATA. The model would tell a member
// "tonight's edition carries no SPX context" when the truth is "call the SPX tool".
test("the omission is named, and names the tool to call instead", () => {
  const out = compactNightHawkEditionForModel(fatEdition());
  assert.deepEqual(out.market_recap_omitted, ["spx_desk", "flow_tape"]);
  const note = String(out.market_recap_omitted_note);
  assert.match(note, /get_spx_structure/);
  assert.match(note, /get_flow_tape/);
  assert.match(note, /does NOT mean the data is unavailable/);
});

test("an edition with nothing omitted says so with null, not an empty sentence", () => {
  const out = compactNightHawkEditionForModel({ ...fatEdition(), market_recap: { catalysts: [] } });
  assert.deepEqual(out.market_recap_omitted, []);
  assert.equal(out.market_recap_omitted_note, null);
});

test("a missing edition degrades to the same shape the tool always returned", () => {
  const out = compactNightHawkEditionForModel(null);
  assert.equal(out.available, false);
  assert.deepEqual(out.plays, []);
  assert.equal(out.play_count, 0);
});

test("a recap-only edition keeps its recap_only flags", () => {
  const out = compactNightHawkEditionForModel({
    available: true, plays: [], recap_only: true, recap_only_reason: "no_plays_survived_funnel",
    market_recap: { catalysts: ["CPI"] }, edition_for: "2026-08-21",
  });
  assert.equal(out.recap_only, true);
  assert.equal(out.recap_only_reason, "no_plays_survived_funnel");
  assert.equal(out.play_count, 0);
});
