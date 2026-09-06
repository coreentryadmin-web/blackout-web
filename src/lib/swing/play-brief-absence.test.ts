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

test("collectBriefUnavailableSources: cold GEX matrix surfaces in envelope", () => {
  const ctx = {
    ecosystem: {
      gex_positioning: null,
      vector_full_state: { spot: 100 },
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some((s) => s.source === "GEX positioning" && s.reason === "cold matrix / no positioning read"),
  );
  assert.ok(!sources.some((s) => s.source === "Vector desk state"));
});

test("collectBriefUnavailableSources: missing Vector desk state surfaces in envelope", () => {
  const ctx = {
    ecosystem: {
      gex_positioning: { spot: 100, flip: 98, gamma_posture: "long" },
      vector_full_state: null,
    },
    vector: null,
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some((s) => s.source === "Vector desk state" && s.reason === "snapshot unavailable"),
  );
  assert.ok(!sources.some((s) => s.source === "GEX positioning"));
});

test("collectBriefUnavailableSources: ctx.vector satisfies Vector desk state when ecosystem slice is null", () => {
  const ctx = {
    ecosystem: {
      gex_positioning: { spot: 100, flip: 98, gamma_posture: "long" },
      vector_full_state: null,
    },
    vector: { spot: 100 },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(!sources.some((s) => s.source === "Vector desk state"));
});

test("collectBriefUnavailableSources: forwards Vector unavailable_sections to envelope", () => {
  const ctx = {
    vector: {
      spot: 100,
      unavailable_sections: ["dark_pool_levels", "expected_move"],
      wall_history_empty_reason: null,
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(sources.some((s) => s.source === "Vector dark pool" && s.reason === "not present on this read"));
  assert.ok(sources.some((s) => s.source === "Vector expected move" && s.reason === "not present on this read"));
});

test("collectBriefUnavailableSources: skips wall_history absence pre-RTH (expected empty rail)", () => {
  const ctx = {
    vector: {
      spot: 100,
      unavailable_sections: ["wall_history", "technicals"],
      wall_history_empty_reason: "outside_rth_no_recording_yet",
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(!sources.some((s) => s.source === "Vector wall history"));
  assert.ok(sources.some((s) => s.source === "Vector technicals"));
});

test("collectBriefUnavailableSources: stale Vector snapshot surfaces in envelope", () => {
  const ctx = {
    vector: {
      spot: 100,
      dataAgeMs: 180_000,
      unavailable_sections: [],
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(sources.some((s) => s.source === "Vector snapshot" && s.reason === "stale — levels may lag spot"));
});

test("collectBriefUnavailableSources: flowMarkers.available false surfaces in envelope", () => {
  const ctx = {
    vector: {
      spot: 100,
      unavailable_sections: [],
      flowMarkers: { available: false, reason: "chain read failed", prints: [] },
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some((s) => s.source === "Vector flow prints" && s.reason === "chain read failed"),
  );
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
    play: { markIsSync: true, status: "OPEN" },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some((s) => s.source === "option mark" && s.reason === "sync quote without freshness timestamp"),
  );
});

test("collectBriefUnavailableSources: closed play with markIsSync does not surface option mark absence", () => {
  const ctx = {
    play: { markIsSync: true, status: "CLOSED" },
  } as SwingPlayBriefContext;
  assert.ok(!collectBriefUnavailableSources(ctx).some((s) => s.source === "option mark"));
});

test("collectBriefUnavailableSources: WATCH play with markIsSync does not surface option mark absence (static chain mid by design)", () => {
  const ctx = {
    play: { markIsSync: true, status: "WATCH" },
  } as SwingPlayBriefContext;
  assert.ok(!collectBriefUnavailableSources(ctx).some((s) => s.source === "option mark"));
});

test("collectBriefUnavailableSources: a live-synced mark (markIsSync false/undefined) does not surface", () => {
  const ctx = { play: { markIsSync: false } } as SwingPlayBriefContext;
  assert.ok(!collectBriefUnavailableSources(ctx).some((s) => s.source === "option mark"));

  const ctxUndefined = { play: {} } as SwingPlayBriefContext;
  assert.ok(!collectBriefUnavailableSources(ctxUndefined).some((s) => s.source === "option mark"));
});

test("collectBriefUnavailableSources: timestamped but stale option mark surfaces (C2/C3)", () => {
  const staleAsOf = new Date(Date.now() - 60_000).toISOString();
  const ctx = {
    play: { markIsSync: false, markAsOf: staleAsOf, status: "OPEN" },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some((s) => s.source === "option mark" && s.reason === "quote stale — P&L may lag live tape"),
  );
});

test("collectBriefUnavailableSources: fresh timestamped mark does not surface option mark absence", () => {
  const freshAsOf = new Date(Date.now() - 1_000).toISOString();
  const ctx = {
    play: { markIsSync: false, markAsOf: freshAsOf, status: "HOLD" },
  } as SwingPlayBriefContext;
  assert.ok(!collectBriefUnavailableSources(ctx).some((s) => s.source === "option mark"));
});

test("collectBriefUnavailableSources: prior-session discovery scan surfaces in envelope", () => {
  const ctx = {
    sessionDate: "2026-09-06",
    scanSessionDay: "2026-09-05",
    scanAsOf: "2026-09-05T20:00:00.000Z",
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some(
      (s) =>
        s.source === "swing discovery scan" &&
        s.reason === "prior session (2026-09-05) — today's scan not yet run",
    ),
  );
});

test("collectBriefUnavailableSources: same-day scan does not surface stale discovery", () => {
  const ctx = {
    sessionDate: "2026-09-06",
    scanSessionDay: "2026-09-06",
    scanAsOf: "2026-09-06T14:30:00.000Z",
  } as SwingPlayBriefContext;

  assert.ok(!collectBriefUnavailableSources(ctx).some((s) => s.source === "swing discovery scan"));
});

test("collectBriefUnavailableSources: uncalibrated thesis health surfaces in envelope (Largo C3/C6)", () => {
  const h = {
    health: 46,
    entryIndex: 60,
    currentIndex: 46,
    delta: -14,
    rung: "DEGRADED",
    rungLabel: "Degraded",
    pillars: [
      {
        id: "structure",
        label: "Persistence",
        weight: 0.28,
        commitScore: 0.4,
        currentScore: 0.35,
        commitLabel: "unknown",
        currentLabel: "unknown",
        status: "intact",
        contributionPts: 10,
        deltaPts: -1,
      },
      {
        id: "momentum",
        label: "Entry geometry",
        weight: 0.22,
        commitScore: 0.5,
        currentScore: 0.45,
        commitLabel: "n/a",
        currentLabel: "n/a",
        status: "intact",
        contributionPts: 10,
        deltaPts: -1,
      },
      {
        id: "flow",
        label: "Signal stack",
        weight: 0.2,
        commitScore: 0.35,
        currentScore: 0.35,
        commitLabel: "no signals",
        currentLabel: "no signals",
        status: "intact",
        contributionPts: 7,
        deltaPts: 0,
      },
    ],
    moves: [],
    committedAtEt: null,
    computedAtEt: "10:00 ET",
    advisory: "Thesis fading — tighten risk or trim into strength.",
    thesisBreakLevel: "warn",
  };
  const ctx = {
    play: { status: "HOLD", thesisHealth: h },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some(
      (s) =>
        s.source === "thesis health" &&
        s.reason === "setup/entry/signal inputs unavailable for committed positions",
    ),
  );
});
