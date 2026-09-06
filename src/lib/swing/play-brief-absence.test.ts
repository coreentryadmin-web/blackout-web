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

test("collectBriefUnavailableSources: Meridian timeline failure surfaces in envelope", () => {
  const ctx = {
    meridian: {
      as_of: "2026-09-06 06:30 ET",
      items: [],
      total_matched: 0,
      unavailable: true,
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some((s) => s.source === "Meridian catalysts" && s.reason === "timeline read failed"),
  );
});

test("collectBriefUnavailableSources: HELIX stale without recent_flow still surfaces in envelope", () => {
  const ctx = {
    ecosystem: {
      flow_feed_fresh: false,
      recent_flow: null,
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(sources.some((s) => s.source === "HELIX flow" && s.reason === "pipeline stale"));
});

test("collectBriefUnavailableSources: a total ecosystem fetch failure surfaces in envelope, distinct from legitimately-empty (FINDINGS 2026-09-06 #11)", () => {
  const ctx = {
    ecosystem: null,
    ecosystemFetchFailed: true,
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(sources.some((s) => s.source === "ecosystem context" && s.reason === "fetch failed"));
});

test("collectBriefUnavailableSources: ecosystem null WITHOUT a fetch failure does not fabricate an absence entry", () => {
  const ctx = { ecosystem: null } as SwingPlayBriefContext;
  assert.ok(!collectBriefUnavailableSources(ctx).some((s) => s.source === "ecosystem context"));
});

test("collectBriefUnavailableSources: a total Vector fetch failure surfaces in envelope (FINDINGS 2026-09-06 #11)", () => {
  const ctx = {
    vector: null,
    vectorFetchFailed: true,
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(sources.some((s) => s.source === "Vector state" && s.reason === "fetch failed"));
});

test("collectBriefUnavailableSources: vectorFetchFailed does not surface when ecosystem.vector_full_state is present (#4249 follow-up)", () => {
  const ctx = {
    vector: null,
    vectorFetchFailed: true,
    ecosystem: {
      vector_full_state: { spot: 100, gammaFlip: 98 },
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(!sources.some((s) => s.source === "Vector state"));
});

test("collectBriefUnavailableSources: Meridian peer cohort failure surfaces in envelope", () => {
  const ctx = {
    meridianPeer: {
      available: false,
      error: "timeline_lookup_failed",
      note: "The Meridian timeline could not be read.",
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some((s) => s.source === "Meridian peer cohort" && s.reason === "timeline_lookup_failed"),
  );
});

test("collectBriefUnavailableSources: unsynced option mark surfaces in envelope (FINDINGS 2026-09-06 #22)", () => {
  // dataHonestyCoaching() already narrates "mark not synced to live tape" from this exact
  // boolean — this asserts the same fact reaches the structured C3 channel, not just prose.
  const ctx = {
    play: { markIsSync: true },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some((s) => s.source === "option mark" && s.reason === "sync quote without freshness timestamp"),
  );
});

test("collectBriefUnavailableSources: a live-synced mark (markIsSync false/undefined) does not surface", () => {
  const ctx = { play: { markIsSync: false } } as SwingPlayBriefContext;
  assert.ok(!collectBriefUnavailableSources(ctx).some((s) => s.source === "option mark"));

  const ctxUndefined = { play: {} } as SwingPlayBriefContext;
  assert.ok(!collectBriefUnavailableSources(ctxUndefined).some((s) => s.source === "option mark"));
});
