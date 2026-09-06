import test from "node:test";
import assert from "node:assert/strict";
import { collectBriefUnavailableSources, trustedHelixFlow } from "./play-brief-absence";
import type { SwingPlayBriefContext } from "./play-brief-types";

test("trustedHelixFlow: null when feed stale even if recent_flow exists", () => {
  const eco = {
    recent_flow: {
      window_hours: 24,
      print_count: 10,
      call_premium: 1_000_000,
      put_premium: 500_000,
      unknown_premium: 0,
    },
    flow_feed_fresh: false,
  };
  assert.equal(trustedHelixFlow(eco as SwingPlayBriefContext["ecosystem"]), null);
});

test("trustedHelixFlow: returns flow when feed fresh", () => {
  const eco = {
    recent_flow: {
      window_hours: 24,
      print_count: 10,
      call_premium: 1_000_000,
      put_premium: 500_000,
      unknown_premium: 0,
    },
    flow_feed_fresh: true,
  };
  assert.equal(trustedHelixFlow(eco as SwingPlayBriefContext["ecosystem"])?.print_count, 10);
});

test("collectBriefUnavailableSources: HELIX stale + open book failure + arsenal legs", () => {
  const ctx = {
    ecosystem: {
      arsenal: { unavailable_sources: [{ source: "short-interest", reason: "timeout" }] },
      recent_flow: { print_count: 1, call_premium: 1, put_premium: 1, window_hours: 24, unknown_premium: 0 },
      flow_feed_fresh: false,
    },
    openBook: null,
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(sources.some((s) => s.source === "short-interest"));
  assert.ok(sources.some((s) => s.source === "HELIX flow" && s.reason === "pipeline stale"));
  assert.ok(sources.some((s) => s.source === "open book" && s.reason === "ledger read failed"));
});
