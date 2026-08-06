import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHelixDarkpoolDeepLink,
  buildHelixFlowDeepLink,
  darkpoolMatchesDeepLink,
  flowMatchesDeepLink,
  parseHelixDeepLink,
} from "./helix-flow-deep-link.ts";

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
