import { describe, test } from "node:test";
import assert from "node:assert/strict";

// Under src/ because scripts/run-tests.mjs walks src/ only — same reason as
// meridian-audit-poll-count.test.ts and meridian-audit-proxy-saturation.test.ts.
import {
  entityViolations,
  eventViolations,
  expectedMoveScopeViolations,
  expectedVsRealizedViolations,
  levelScopeViolations,
  summarize,
  wallInversionViolations,
} from "../scripts/audit/lib/meridian-invariants.mjs";

/**
 * Each fixture below is the SHAPE PRODUCTION ACTUALLY SERVED on 2026-08-21, reduced to the fields
 * the rule reads. These are regression guards for a live checker, so every "fires" case is a real
 * measured payload and every "does not fire" case is the corrected shape.
 */

describe("no raw HTML entities in member-facing text (#2608)", () => {
  test("fires on the exact strings the desk printed", () => {
    const v = entityViolations({
      enrichment: {
        catalysts: [{ title: "…From Wall Street&#39;s Most Accurate Analysts" }],
        earnings_headlines: [{ title: "Stock Market: Will S&amp;P 500 Open Up or Down Today?" }],
      },
    });
    assert.equal(v.length, 2);
    assert.deepEqual([...new Set(v.map((x) => x.rule))], ["no_raw_entities"]);
    assert.match(v[0]!.path, /enrichment\.catalysts\[0\]\.title/);
  });

  test("a literal ampersand is not an entity — the decoded form must pass", () => {
    // "Fear & Greed Index" arrives from the feed with a bare &. Flagging it would make the
    // checker cry wolf on correct data, which is how a checker gets ignored.
    assert.deepEqual(entityViolations({ enrichment: { h: [{ title: "Fear & Greed Index" }] } }), []);
    assert.deepEqual(entityViolations({ enrichment: { h: [{ title: "AT&T and 3 stocks" }] } }), []);
  });
});

describe("a quote may not describe a print its expiry cannot reach (#2613)", () => {
  test("fires on the measured PDD case — a dead expiry quoted for a print three days out", () => {
    const v = expectedMoveScopeViolations({
      date: "2026-08-24",
      intel: { vector: { move_pct: 0.1, expiry: "2026-08-21" } },
    });
    assert.equal(v.length, 1);
    assert.equal(v[0]!.rule, "vector_quote_predates_print");
    assert.match(v[0]!.sample, /0\.1 from 2026-08-21, print 2026-08-24/);
  });

  test("an expiry that spans the print is fine, same day included", () => {
    assert.deepEqual(
      expectedMoveScopeViolations({ date: "2026-08-24", intel: { vector: { move_pct: 9.2, expiry: "2026-08-28" } } }),
      []
    );
    assert.deepEqual(
      expectedMoveScopeViolations({ date: "2026-08-24", intel: { vector: { move_pct: 9.2, expiry: "2026-08-24" } } }),
      []
    );
  });
});

describe("no ratio or verdict across two different events (#2614)", () => {
  test("fires on the measured SMTC case", () => {
    const v = expectedVsRealizedViolations({
      enrichment: {
        print_history: [{ report_date: "2026-05-26", expected_move_pct: null }],
        expected_vs_realized: { ratio: 0.17, verdict: "under" },
      },
    });
    assert.equal(v.length, 1);
    assert.equal(v[0]!.rule, "evr_compares_across_events");
  });

  test("the corrected shape passes — reaction published, no ratio, no verdict", () => {
    assert.deepEqual(
      expectedVsRealizedViolations({
        enrichment: {
          print_history: [{ expected_move_pct: null }],
          expected_vs_realized: { ratio: null, verdict: "unknown", realized_move_pct: -4.41 },
        },
      }),
      []
    );
  });

  test("a ratio IS allowed once the print carries its own captured implied", () => {
    // The checker must not outlaw the card — only the cross-event comparison.
    assert.deepEqual(
      expectedVsRealizedViolations({
        enrichment: {
          print_history: [{ expected_move_pct: 5.0 }],
          expected_vs_realized: { ratio: 0.9, verdict: "under" },
        },
      }),
      []
    );
  });
});

describe("inverted walls must carry the raw strikes (#2611)", () => {
  test("fires when the coercion is reported without what was measured", () => {
    const v = wallInversionViolations({ intel: { thermal: { walls_inverted: true, gamma_call_wall: null, gamma_put_wall: 87.5 } } });
    assert.equal(v.length, 1);
    assert.match(v[0]!.sample, /missing gamma_call_wall/);
  });

  test("the live BNS shape passes, and a non-inverted ladder is not checked at all", () => {
    assert.deepEqual(
      wallInversionViolations({ intel: { thermal: { walls_inverted: true, gamma_call_wall: 85, gamma_put_wall: 87.5 } } }),
      []
    );
    assert.deepEqual(wallInversionViolations({ intel: { thermal: { walls_inverted: false } } }), []);
  });
});

describe("a claimed expiry scope must say which levels it covers (#2585)", () => {
  test("fires on the pre-fix shape — a badge with nothing underneath it", () => {
    const v = levelScopeViolations({ intel: { thermal: { expiry_scope: "event_expiry", expiry_used: "2026-09-18" } } });
    assert.equal(v.length, 1);
    assert.equal(v[0]!.rule, "expiry_scope_without_level_scopes");
  });

  test("the shipped shape passes; an unavailable chain is not a violation", () => {
    assert.deepEqual(
      levelScopeViolations({ intel: { thermal: { expiry_scope: "aggregate", level_scopes: { call_wall: "aggregate" } } } }),
      []
    );
    assert.deepEqual(levelScopeViolations({ intel: { thermal: { available: false, expiry_scope: "aggregate" } } }), []);
  });
});

describe("the checker is total — it never invents a defect from a payload it cannot read", () => {
  test("absent, empty and malformed payloads yield nothing", () => {
    for (const bad of [null, undefined, {}, { intel: null }, { enrichment: null }, [], "nope", 42]) {
      assert.deepEqual(eventViolations(bad as never, "X"), [], `payload ${JSON.stringify(bad)}`);
    }
  });

  test("a violation names its ticker, so a sweep report is actionable", () => {
    const v = eventViolations({ enrichment: { c: [{ title: "S&amp;P" }] } }, "BEKE");
    assert.equal(v.length, 1);
    assert.equal(v[0]!.ticker, "BEKE");
  });

  test("summarize counts by rule, most frequent first", () => {
    const s = summarize([{ rule: "a" }, { rule: "b" }, { rule: "a" }] as never);
    assert.deepEqual(s, [["a", 2], ["b", 1]]);
  });
});
