import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHelixDarkpoolDeepLink,
  buildHelixFlowDeepLink,
  darkpoolMatchesDeepLink,
  flowMatchesDeepLink,
  parseHelixDeepLink,
} from "./helix-flow-deep-link.ts";
import type { FlowAlert } from "./api.ts";

test("buildHelixFlowDeepLink prefers alert_id", () => {
  const url = buildHelixFlowDeepLink({
    ticker: "NVDA",
    alert_id: "uw:abc123",
    strike: 140,
    expiry: "2026-08-21",
    option_type: "CALL",
  });
  assert.match(url, /alert=uw%3Aabc123/);
  assert.match(url, /ticker=NVDA/);
});

test("buildHelixFlowDeepLink falls back to contract fingerprint", () => {
  const url = buildHelixFlowDeepLink({
    ticker: "SPY",
    strike: 735,
    expiry: "2026-08-21",
    option_type: "PUT",
    at: "2026-08-04T15:00:00.000Z",
    premium: 900_000,
  });
  assert.match(url, /strike=735/);
  assert.match(url, /type=P/);
  assert.match(url, /premium=900000/);
  assert.doesNotMatch(url, /alert=/);
});

test("buildHelixDarkpoolDeepLink scopes ticker and darkpool flag", () => {
  const url = buildHelixDarkpoolDeepLink({
    ticker: "NVDA",
    executed_at: "2026-08-04T14:18:11.000Z",
    premium: 6_000_000,
  });
  assert.match(url, /darkpool=1/);
  assert.match(url, /ticker=NVDA/);
  assert.match(url, /premium=6000000/);
});

test("parseHelixDeepLink round-trips flow alert links", () => {
  const parsed = parseHelixDeepLink(new URLSearchParams("alert=uw:1&ticker=SPY"));
  assert.equal(parsed?.kind, "flow");
  if (parsed?.kind === "flow") assert.equal(parsed.alert_id, "uw:1");
});

test("flowMatchesDeepLink matches on alert_id", () => {
  const target = parseHelixDeepLink(new URLSearchParams("alert=uw:99&ticker=NVDA"));
  assert.equal(
    flowMatchesDeepLink(
      {
        ticker: "NVDA",
        premium: 1_000_000,
        option_type: "CALL",
        expiry: "2026-08-21",
        strike: 140,
        direction: "bullish",
        score: 5,
        route: "whale",
        alerted_at: "2026-08-04T15:00:00.000Z",
        alert_id: "uw:99",
      },
      target!
    ),
    true
  );
});

test("darkpoolMatchesDeepLink matches ticker time premium", () => {
  const target = parseHelixDeepLink(
    new URLSearchParams("ticker=NVDA&darkpool=1&at=2026-08-04T14:18:11&premium=6000000")
  );
  assert.equal(
    darkpoolMatchesDeepLink(
      { ticker: "NVDA", executed_at: "2026-08-04T14:18:11.000Z", premium: 6_000_000 },
      target!
    ),
    true
  );
});

// ── Strike precision (2026-08-23) ─────────────────────────────────────────────────────────────
//
// `buildHelixFlowDeepLink` rounded the strike, mirroring the `premium` rounding beside it. Rounding
// a premium drops cents nobody needs; rounding a strike NAMES A DIFFERENT CONTRACT. Measured live:
// 99 of 5000 rows (2.0%) carry a fractional strike, so a shared link for any of them stated a
// strike that does not exist — and a link built from 182.5 also matched a DIFFERENT 183 print.

const dlFlow = (over: Partial<FlowAlert> = {}): FlowAlert =>
  ({
    ticker: "NVDA", strike: 180, option_type: "CALL", expiry: "2026-08-28",
    premium: 1_000_000, direction: "bullish", score: 60, route: "sweep",
    alerted_at: "2026-08-21T18:00:00.000Z",
    ...over,
  }) as FlowAlert;

const dlTarget = (qs: string) => parseHelixDeepLink(new URLSearchParams(qs))!;

test("a fractional strike survives into the URL instead of being rounded away", () => {
  const url = buildHelixFlowDeepLink(dlFlow({ strike: 182.5 }));
  assert.match(url, /strike=182\.5/);
  assert.doesNotMatch(url, /strike=183/);
});

test("a new fractional link matches ONLY its own contract", () => {
  const target = dlTarget(buildHelixFlowDeepLink(dlFlow({ strike: 182.5 })).split("?")[1]);
  assert.equal(flowMatchesDeepLink(dlFlow({ strike: 182.5 }), target), true);
  // The collision this fixes: before, the rounded link matched the neighbouring integer strike.
  assert.equal(flowMatchesDeepLink(dlFlow({ strike: 183 }), target), false);
  assert.equal(flowMatchesDeepLink(dlFlow({ strike: 182 }), target), false);
});

test("links ALREADY SHARED with a rounded strike are not stranded", () => {
  // The whole reason the matcher keys off the TARGET's precision rather than comparing exactly.
  // Every link posted to Discord before this change carries a rounded strike.
  const legacy = dlTarget("ticker=NVDA&strike=183&expiry=2026-08-28&type=C&premium=1000000");
  assert.equal(flowMatchesDeepLink(dlFlow({ strike: 182.5 }), legacy), true, "legacy link must still resolve");
  assert.equal(flowMatchesDeepLink(dlFlow({ strike: 183 }), legacy), true);
});

test("an integer strike still round-trips exactly", () => {
  const target = dlTarget(buildHelixFlowDeepLink(dlFlow({ strike: 180 })).split("?")[1]);
  assert.equal(flowMatchesDeepLink(dlFlow({ strike: 180 }), target), true);
  assert.equal(flowMatchesDeepLink(dlFlow({ strike: 181 }), target), false);
});

test("premium keeps its rounding — cents are noise, strike halves are not", () => {
  // Deliberately unchanged: the two look alike and are not the same judgement.
  const url = buildHelixFlowDeepLink(dlFlow({ premium: 1_000_000.49 }));
  assert.match(url, /premium=1000000/);
});

test("the full build -> parse -> match round trip holds across contract shapes", () => {
  // The invariant a member depends on: click a shared link, the print highlights. Previously only
  // build -> parse was covered, never build -> parse -> MATCH.
  for (const over of [
    { alert_id: "abc123" },
    {},
    { alerted_at: "2026-08-21T18:00:00.847Z" },
    { option_type: "PUT" },
    { strike: 182.5 },
    { strike: 437.5, ticker: "DELL" },
    { tape_time_estimated: true },
  ] as Partial<FlowAlert>[]) {
    const flow = dlFlow(over);
    const url = buildHelixFlowDeepLink(flow);
    const target = parseHelixDeepLink(new URLSearchParams(url.split("?")[1] ?? ""));
    assert.ok(target, `no target parsed for ${JSON.stringify(over)}`);
    assert.equal(flowMatchesDeepLink(flow, target), true, `round trip broke for ${JSON.stringify(over)}`);
  }
});
