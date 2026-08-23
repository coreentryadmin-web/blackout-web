import { test } from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import {
  daysToExpiry,
  flowSignals,
  flowTimeMs,
  fmtExpiryShort,
  fmtFullTimestamp,
  ruleLabel,
  ruleBadge,
  executionRouteKey,
  fmtIv,
  ALERT_RULE_WORD_KEYS,
  sortFlows,
} from "./helix-flow-format";

function flow(partial: Partial<FlowAlert> & Pick<FlowAlert, "ticker">): FlowAlert {
  return {
    option_type: "CALL",
    strike: 100,
    expiry: "2026-07-11",
    premium: 500_000,
    alerted_at: "2026-07-11T14:30:00.000Z",
    score: 0,
    ...partial,
  } as FlowAlert;
}

test("flowTimeMs returns null for missing alerted_at", () => {
  assert.equal(flowTimeMs(flow({ ticker: "SPY", alerted_at: "" })), null);
});

test("fmtExpiryShort formats YYYY-MM-DD", () => {
  assert.equal(fmtExpiryShort("2026-07-11"), "07/11/26");
});

test("fmtFullTimestamp renders MM/DD/YYYY - HH:MM in US Eastern (24h)", () => {
  // 2026-07-15T15:45:00Z is 11:45 EDT (UTC-4, mid-July) — well inside one ET calendar day, so
  // there's no midnight/DST-boundary ambiguity in the assertion.
  assert.equal(fmtFullTimestamp("2026-07-15T15:45:00.000Z"), "07/15/2026 - 11:45");
});

test("fmtFullTimestamp zero-pads month, day, hour, and minute", () => {
  // 2026-03-05T13:07:00Z → 08:07 EST (UTC-5; US DST 2026 begins Mar 8, so Mar 5 is still standard).
  assert.equal(fmtFullTimestamp("2026-03-05T13:07:00.000Z"), "03/05/2026 - 08:07");
});

test("fmtFullTimestamp uses 24-hour clock for afternoon prints", () => {
  // 2026-07-15T20:30:00Z → 16:30 EDT (not 4:30 PM).
  assert.equal(fmtFullTimestamp("2026-07-15T20:30:00.000Z"), "07/15/2026 - 16:30");
});

test("fmtFullTimestamp returns em-dash for empty or invalid input", () => {
  assert.equal(fmtFullTimestamp(""), "—");
  assert.equal(fmtFullTimestamp("not-a-date"), "—");
});

test("ruleLabel maps sweep and repeat", () => {
  assert.equal(ruleLabel("sweep_block"), "SWEEP");
  assert.equal(ruleLabel("repeated_hits"), "REPEAT");
});

test("sortFlows orders premium descending", () => {
  const rows = [
    flow({ ticker: "A", premium: 200_000 }),
    flow({ ticker: "B", premium: 900_000 }),
    flow({ ticker: "C", premium: 400_000 }),
  ];
  const sorted = sortFlows(rows, "premium", "desc");
  assert.deepEqual(sorted.map((r) => r.ticker), ["B", "C", "A"]);
});

test("flowSignals includes whale and 0dte tags", () => {
  const signals = flowSignals(flow({ ticker: "SPX", premium: 2_000_000 }), {
    isWhale: true,
    is0dte: true,
  });
  assert.ok(signals.some((s) => s.id === "whale"));
  assert.ok(signals.some((s) => s.id === "0dte"));
});

test("daysToExpiry floors at zero for same-day expiry", () => {
  const today = new Date("2026-07-11T18:00:00Z");
  assert.equal(daysToExpiry("2026-07-11", today), 0);
});

test("executionRouteKey reads UW alert_rule, not internal route", () => {
  // UNCHANGED, on purpose. The panel asks how the order EXECUTED, and sweeping is a mechanism
  // while "repeated hits" is a pattern across prints — so a rule naming both is filed under the
  // mechanism. The badge answers a different question about the same string and reads REPEAT.
  assert.equal(executionRouteKey({ alert_rule: "RepeatedHitsSweep" }), "SWEEP");
  assert.equal(ruleLabel("RepeatedHitsSweep"), "REPEAT");
  assert.equal(executionRouteKey({ alert_rule: "BigBlockTrade" }), "BLOCK");
});

/**
 * The NINE `alert_rule` values actually present on the production tape, measured 2026-08-22 over
 * 5000 rows / 168h via scripts/audit/helix-tape-inventory.mjs (docs/audit/HELIX-MAP.md §9.8).
 *
 * Before the shared vocabulary landed, the panel bucketed this live population as 98.8% OTHER:
 * the three RepeatedHits* variants alone are 28.7% of the tape and matched none of the panel's six
 * words. This test pins the real vocabulary so a future edit cannot silently re-open that gap.
 */
test("executionRouteKey buckets every alert_rule value the live tape actually carries", () => {
  const LIVE_RULES: Array<[string, string]> = [
    ["RepeatedHits", "REPEAT"],
    ["RepeatedHitsAscendingFill", "REPEAT"],
    ["RepeatedHitsDescendingFill", "REPEAT"],
    ["FloorTradeLargeCap", "FLOOR"],
    ["LowHistoricVolumeFloor", "FLOOR"],
    ["FloorTradeMidCap", "FLOOR"],
    ["FloorTradeSmallCap", "FLOOR"],
    // Names two mechanisms; resolves by vocabulary precedence, not by luck.
    ["SweepsFollowedByFloor", "SWEEP"],
  ];
  for (const [rule, expected] of LIVE_RULES) {
    assert.equal(executionRouteKey({ alert_rule: rule }), expected, rule);
  }
  // ...and not one of them may land in OTHER, which is the defect this test exists to prevent.
  for (const [rule] of LIVE_RULES) {
    assert.notEqual(executionRouteKey({ alert_rule: rule }), "OTHER", rule);
  }
});

test("a print with NO alert_rule is UNREPORTED, never OTHER", () => {
  // 70% of the live tape — the second writer (HELIX-MAP.md §4A) sends no rule field at all.
  // Counting those as OTHER claims we measured a route and found it to be "other", for 3500
  // prints whose route was never reported. Absence must not be published as measurement.
  assert.equal(executionRouteKey({ alert_rule: undefined }), "UNREPORTED");
  assert.equal(executionRouteKey({ alert_rule: null as unknown as undefined }), "UNREPORTED");
  assert.equal(executionRouteKey({ alert_rule: "" }), "UNREPORTED");
  assert.equal(executionRouteKey({ alert_rule: "   " }), "UNREPORTED");
  // A rule that IS present but names no mechanism is a real measurement — still OTHER.
  assert.equal(executionRouteKey({ alert_rule: "SomeRuleWeHaveNoWordFor" }), "OTHER");
});

test("both readers draw from the SAME word set — neither can gain or lose a word silently", () => {
  // The real anti-drift guarantee. The two functions deliberately ORDER these words differently
  // (mechanism-first for the panel, rule-first for the badge), so agreement on every input is NOT
  // the invariant — drawing from one set is. A word added for one reader and not the other is
  // exactly how the 28.7% REPEAT gap opened in the first place.
  const RECOGNISED = new Set<string>(ALERT_RULE_WORD_KEYS);
  for (const word of ALERT_RULE_WORD_KEYS) {
    // "REPEAT" is keyed on the substring "REPEATED", so feed each word a string that contains it.
    const sample = word === "REPEAT" ? "Repeated" : word;
    assert.notEqual(executionRouteKey({ alert_rule: sample }), "OTHER", `panel must recognise ${word}`);
    assert.ok(RECOGNISED.has(ruleLabel(sample)), `badge must recognise ${word}, got ${ruleLabel(sample)}`);
  }
});

test("a rule naming a mechanism AND the repeat pattern is filed under the mechanism", () => {
  // REPEAT ranks LAST in the panel's precedence precisely so this holds: it is the answer only
  // when no execution mechanism was named. Reversing this would silently redefine an execution
  // panel as a rule-family panel.
  assert.equal(executionRouteKey({ alert_rule: "RepeatedHitsSweep" }), "SWEEP");
  assert.equal(executionRouteKey({ alert_rule: "RepeatedHitsBlock" }), "BLOCK");
  assert.equal(executionRouteKey({ alert_rule: "RepeatedHitsFloorTrade" }), "FLOOR");
  // ...and with no mechanism named, the pattern word is what rescues it from OTHER.
  assert.equal(executionRouteKey({ alert_rule: "RepeatedHits" }), "REPEAT");
});

/**
 * IV is a FRACTION in this feed, uniformly — measured over 3500 live rows carrying IV
 * (docs/audit/HELIX-MAP.md §9.4). These pin the unit so a future edit cannot reintroduce a
 * per-row fraction-vs-percent guess.
 */
test("fmtIv renders the feed's real unit — a fraction — at every magnitude", () => {
  assert.equal(fmtIv(0.07), "7%");    // the live minimum
  assert.equal(fmtIv(0.17), "17%");   // the live median
  assert.equal(fmtIv(0.23), "23%");   // live p75
  assert.equal(fmtIv(1), "100%");
  assert.equal(fmtIv(2.99), "299%");  // just under the OLD branch point
  assert.equal(fmtIv(3), "300%");     // ...and just over it: no discontinuity any more
  assert.equal(fmtIv(3.5), "350%");
});

test("a degenerate IV solve reads as obviously wrong, not as a plausible number", () => {
  // The real tail: SPY calls expiring the same day, deep ITM, where the solve breaks down.
  // Old behaviour rendered 106.2 as "106%" — a number a member has no reason to distrust.
  assert.equal(fmtIv(106.2), "10620%");
  assert.equal(fmtIv(69.24), "6924%");
  assert.equal(fmtIv(43.12), "4312%");
});

test("fmtIv withholds rather than inventing a value it does not have", () => {
  assert.equal(fmtIv(null), "—");
  assert.equal(fmtIv(undefined), "—");
  assert.equal(fmtIv(0), "—");
  assert.equal(fmtIv(-1), "—");
  assert.equal(fmtIv(Number.NaN), "—");
  assert.equal(fmtIv(Number.POSITIVE_INFINITY), "—");
});

test("ruleLabel still falls back to the raw rule text, unlike the panel", () => {
  // Deliberately different fallbacks: the BADGE shows what UW called the print (more informative
  // than a bucket), the PANEL buckets it. Same vocabulary, different jobs.
  assert.equal(ruleLabel("ZzzUnknownRule"), "ZZZUNKNO");
  assert.equal(executionRouteKey({ alert_rule: "ZzzUnknownRule" }), "OTHER");
});

test("flowSignals includes near wall tags", () => {
  const signals = flowSignals(
    flow({ ticker: "SPY", gex_proximity: "near_call_wall" }),
    {}
  );
  assert.ok(signals.some((s) => s.id === "ncwall"));
});

// ── The Rule column reports UW's alert_rule, or nothing ────────────────────────────────────────
// The shipped defect substituted `flow.route` — our own premium/tenor bucket — into a column
// headed Rule, on 79.4% of the live tape. These pin the substitution shut in both directions.

test("ruleBadge renders the reported rule, matching the badge vocabulary", () => {
  assert.equal(ruleBadge(flow({ ticker: "NVDA", alert_rule: "sweep_block" })), "SWEEP");
  assert.equal(ruleBadge(flow({ ticker: "NVDA", alert_rule: "repeated_hits" })), "REPEAT");
  // REPEAT outranks SWEEP here on purpose: the BADGE leads with the pattern, the PANEL leads with
  // the mechanism (BADGE_PRECEDENCE vs ROUTE_PRECEDENCE). ruleBadge must inherit the badge order,
  // not quietly re-collapse the two onto one precedence — the mistake §9.8's first draft made.
  assert.equal(ruleBadge(flow({ ticker: "NVDA", alert_rule: "RepeatedHitsSweep" })), "REPEAT");
  assert.equal(executionRouteKey(flow({ ticker: "NVDA", alert_rule: "RepeatedHitsSweep" })), "SWEEP");
  // An unrecognised rule is still SHOWN — the badge's own documented fallback, unchanged.
  assert.equal(ruleBadge(flow({ ticker: "NVDA", alert_rule: "ZzzUnknownRule" })), "ZZZUNKNO");
});

test("ruleBadge reports absence as absence, never the internal route bucket", () => {
  // Every value `unusual-whales.ts` can assign to `route`, on a print with no reported rule.
  for (const route of ["whale", "stock", "0dte", ""]) {
    for (const alert_rule of [null, undefined, "", "   "]) {
      const got = ruleBadge(flow({ ticker: "SPX", route, alert_rule } as Partial<FlowAlert> & Pick<FlowAlert, "ticker">));
      assert.equal(got, "\u2014", `route=${JSON.stringify(route)} rule=${JSON.stringify(alert_rule)} must render as absent, got ${got}`);
    }
  }
});

test("ruleBadge and executionRouteKey agree on whether the field is present at all", () => {
  // The defect was a CONTRADICTION on one screen: the panel said UNREPORTED while the column
  // showed a value for the same print. Presence must be one fact, not two.
  const cases: Array<Partial<FlowAlert>> = [
    { alert_rule: "sweep_block", route: "whale" },
    { alert_rule: "RepeatedHitsDescendingFill", route: "stock" },
    { alert_rule: "ZzzUnknownRule", route: "0dte" },
    { alert_rule: null, route: "whale" },
    { alert_rule: "", route: "stock" },
    { alert_rule: "   ", route: "0dte" },
    { alert_rule: undefined, route: "" },
  ];
  for (const c of cases) {
    const f = flow({ ticker: "SPY", ...c } as Partial<FlowAlert> & Pick<FlowAlert, "ticker">);
    const columnSaysAbsent = ruleBadge(f) === "\u2014";
    const panelSaysAbsent = executionRouteKey(f) === "UNREPORTED";
    assert.equal(
      columnSaysAbsent,
      panelSaysAbsent,
      `Rule column and Route Breakdown disagree on presence for ${JSON.stringify(c)}: ` +
        `column=${ruleBadge(f)} panel=${executionRouteKey(f)}`
    );
  }
});
