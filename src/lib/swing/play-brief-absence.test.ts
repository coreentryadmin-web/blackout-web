import test from "node:test";
import assert from "node:assert/strict";
import {
  collectBriefUnavailableSources,
  gexMatrixStale,
  resolveGammaPosture,
  trustedHelixFlow,
  vectorAgeStale,
  vectorLiveForSession,
  vectorSnapshotStale,
  nighthawkLiveForSession,
  zerodteLiveForSession,
} from "./play-brief-absence";
import type { SwingPlayBriefContext } from "./play-brief-types";
import { WS_TIMESTAMP_FUTURE_TOLERANCE_MS } from "@/lib/ws/timestamp-freshness";

test("gexMatrixStale: clock-skewed future asof is stale (must not read as fresh)", () => {
  const readMs = Date.parse("2026-09-06T15:00:00.000Z");
  const futureAsof = new Date(readMs + WS_TIMESTAMP_FUTURE_TOLERANCE_MS + 30_000).toISOString();
  const gex = { spot: 100, asof: futureAsof, gamma_posture: "long" };
  assert.equal(gexMatrixStale(gex, readMs), true);
});

test("gexMatrixStale: within future tolerance is not treated as skew-stale", () => {
  const readMs = Date.parse("2026-09-06T15:00:00.000Z");
  const nearFutureAsof = new Date(readMs + WS_TIMESTAMP_FUTURE_TOLERANCE_MS - 1_000).toISOString();
  const gex = { spot: 100, asof: nearFutureAsof, gamma_posture: "long" };
  assert.equal(gexMatrixStale(gex, readMs), false);
});

test("vectorAgeStale: POSITIVE_INFINITY dataAgeMs from clock skew is stale", () => {
  const vec = {
    spot: 100,
    dataAgeMs: Number.POSITIVE_INFINITY,
    freshness: "unknown",
  } as SwingPlayBriefContext["vector"];
  assert.equal(vectorAgeStale(vec), true);
});

test("vectorAgeStale: freshness unknown is stale for gating", () => {
  const vec = {
    spot: 100,
    dataAgeMs: 30_000,
    freshness: "unknown",
  } as SwingPlayBriefContext["vector"];
  assert.equal(vectorAgeStale(vec), true);
});

test("vectorAgeStale: future asOf beyond tolerance is stale", () => {
  const readMs = Date.parse("2026-09-06T15:00:00.000Z");
  const futureAsOf = new Date(readMs + WS_TIMESTAMP_FUTURE_TOLERANCE_MS + 60_000).toISOString();
  const vec = {
    spot: 100,
    asOf: futureAsOf,
    freshness: "recent",
  } as SwingPlayBriefContext["vector"];
  assert.equal(vectorAgeStale(vec, readMs), true);
});

test("resolveGammaPosture: stale Vector regime falls back to live GEX posture", () => {
  const ctx = {
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gamma_posture: "short",
        matrix_age_sec: 30,
        freshness: "cached",
      },
    },
    vector: {
      regime: { posture: "long", label: "LONG GAMMA" },
      freshness: "stale",
      dataAgeMs: 180_000,
    },
  } as SwingPlayBriefContext;

  assert.equal(resolveGammaPosture(ctx, ctx.vector), "short");
});

test("resolveGammaPosture: stale Vector regime with stale GEX returns null", () => {
  const ctx = {
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gamma_posture: "long",
        matrix_age_sec: 200,
        freshness: "cached",
      },
    },
    vector: {
      regime: { posture: "long", label: "LONG GAMMA" },
      freshness: "stale",
      dataAgeMs: 180_000,
    },
  } as SwingPlayBriefContext;

  assert.equal(resolveGammaPosture(ctx, ctx.vector), null);
});

test("resolveGammaPosture: live Vector regime wins over GEX fallback", () => {
  const ctx = {
    ecosystem: {
      gex_positioning: {
        spot: 100,
        gamma_posture: "short",
        matrix_age_sec: 30,
        freshness: "cached",
      },
    },
    vector: {
      regime: { posture: "long", label: "LONG GAMMA" },
      freshness: "live",
      dataAgeMs: 5_000,
    },
  } as SwingPlayBriefContext;

  assert.equal(resolveGammaPosture(ctx, ctx.vector), "long");
});

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

test("zerodteLiveForSession: null when session_date lags brief sessionDate (Largo C2)", () => {
  const z = {
    session_date: "2026-09-05",
    direction: "short",
    score: 72,
    conviction: "high",
    status: "flagged",
    first_flagged_at: "2026-09-05T14:00:00Z",
  };
  assert.equal(zerodteLiveForSession(z, "2026-09-06"), null);
  assert.equal(zerodteLiveForSession(z, "2026-09-05")?.direction, "short");
  assert.equal(zerodteLiveForSession(z, null)?.direction, "short");
});

test("nighthawkLiveForSession: null when edition_for lags brief sessionDate (Largo C2)", () => {
  const nh = {
    edition_for: "2026-09-05",
    direction: "short",
    conviction: "high",
    outcome: "open",
    score: 72,
  };
  assert.equal(nighthawkLiveForSession(nh, "2026-09-06"), null);
  assert.equal(nighthawkLiveForSession(nh, "2026-09-05")?.direction, "short");
  assert.equal(nighthawkLiveForSession(nh, null)?.direction, "short");
});

test("collectBriefUnavailableSources: prior-session 0DTE surfaces in unavailableSources (Largo C3)", () => {
  const ctx = {
    sessionDate: "2026-09-06",
    ecosystem: {
      zerodte_today: {
        session_date: "2026-09-05",
        direction: "short",
        score: 72,
        conviction: "high",
        status: "flagged",
        first_flagged_at: "2026-09-05T14:00:00Z",
      },
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some(
      (s) =>
        s.source === "0DTE Command" &&
        s.reason === "prior session (2026-09-05) — today's board not yet run",
    ),
  );
});

test("collectBriefUnavailableSources: prior-session Night Hawk surfaces in unavailableSources (Largo C3)", () => {
  const ctx = {
    sessionDate: "2026-09-06",
    ecosystem: {
      nighthawk_recent: {
        edition_for: "2026-09-05",
        direction: "short",
        conviction: "high",
        outcome: "open",
        score: 72,
      },
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some(
      (s) =>
        s.source === "Night Hawk swings" &&
        s.reason === "prior session (2026-09-05) — today's edition not yet run",
    ),
  );
});

test("vectorLiveForSession: null when observed_session_date lags brief sessionDate (Largo C2)", () => {
  const vec = {
    spot: 100,
    observed_session_date: "2026-09-05",
    dataAgeMs: 30_000,
    freshness: "recent",
  } as SwingPlayBriefContext["vector"];

  assert.equal(vectorLiveForSession(vec, "2026-09-06"), null);
  assert.equal(vectorLiveForSession(vec, "2026-09-05")?.spot, 100);
  assert.equal(vectorLiveForSession(vec, null)?.spot, 100);
});

test("vectorSnapshotStale: fresh age but prior session counts as stale", () => {
  const vec = {
    spot: 100,
    observed_session_date: "2026-09-05",
    dataAgeMs: 30_000,
    freshness: "recent",
  } as SwingPlayBriefContext["vector"];

  assert.equal(vectorSnapshotStale(vec, Date.now(), "2026-09-06"), true);
  assert.equal(vectorSnapshotStale(vec, Date.now(), "2026-09-05"), false);
});

test("collectBriefUnavailableSources: prior-session Vector surfaces in unavailableSources (Largo C3)", () => {
  const ctx = {
    sessionDate: "2026-09-06",
    ecosystem: {
      vector_full_state: {
        spot: 100,
        observed_session_date: "2026-09-05",
        dataAgeMs: 30_000,
        freshness: "recent",
      },
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some(
      (s) =>
        s.source === "Vector snapshot" &&
        s.reason === "prior session (2026-09-05) — today's desk read not yet run",
    ),
  );
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

test("collectBriefUnavailableSources: aged markAsOf surfaces in envelope (live probe 2026-09-07)", () => {
  const ctx = {
    play: {
      markIsSync: false,
      markAsOf: "2026-09-04T21:45:18.000Z",
      status: "OPEN",
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(
    sources.some(
      (s) => s.source === "option mark" && s.reason.includes("stale — last synced"),
    ),
    "expected stale option mark chip for aged markAsOf",
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

test("collectBriefUnavailableSources: CLOSED play suppresses live-desk-freshness noise (bug report 2026-09-07)", () => {
  // Reproduces the user-reported live bug: a CLOSED play's Ask Largo panel showed nothing but a
  // wall of "Unavailable" chips (HELIX flow stale, Vector heatmap/dark pool absent, Vector
  // snapshot stale, prior-session discovery scan, prior-session 0DTE board) because every one of
  // these checks compares TODAY's live desk state against a play that closed days ago — which is
  // always and permanently true once any time has passed. None of that is relevant to a closed
  // historical play; it should be suppressed the same way closedSection()/thesisHealthSection()
  // are already bucket-gated elsewhere in play-brief.ts.
  const ctx = {
    sessionDate: "2026-09-07",
    scanSessionDay: "2026-09-06",
    play: { status: "CLOSED", markIsSync: true },
    openBook: null,
    ecosystem: {
      flow_feed_fresh: false,
      gex_positioning: null,
      vector_full_state: null,
      zerodte_today: {
        session_date: "2026-09-06",
        direction: "short",
        score: 72,
        conviction: "high",
        status: "flagged",
        first_flagged_at: "2026-09-06T14:00:00Z",
      },
      nighthawk_recent: {
        edition_for: "2026-09-06",
        direction: "short",
        conviction: "high",
        outcome: "open",
        score: 72,
      },
    },
    vector: {
      spot: 100,
      dataAgeMs: 180_000,
      unavailable_sections: ["heatmap", "dark_pool_levels"],
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(!sources.some((s) => s.source === "HELIX flow"));
  assert.ok(!sources.some((s) => s.source === "GEX positioning"));
  assert.ok(!sources.some((s) => s.source === "Vector desk state"));
  assert.ok(!sources.some((s) => s.source === "Vector heatmap"));
  assert.ok(!sources.some((s) => s.source === "Vector dark pool"));
  assert.ok(!sources.some((s) => s.source === "Vector snapshot"));
  assert.ok(!sources.some((s) => s.source === "open book"));
  assert.ok(!sources.some((s) => s.source === "swing discovery scan"));
  assert.ok(!sources.some((s) => s.source === "0DTE Command"));
  assert.ok(!sources.some((s) => s.source === "Night Hawk swings"));
  assert.ok(!sources.some((s) => s.source === "option mark"));
});

test("collectBriefUnavailableSources: CLOSED play still surfaces genuine fetch failures (not just staleness)", () => {
  const ctx = {
    play: { status: "CLOSED" },
    ecosystem: null,
    ecosystemFetchFailed: true,
    vector: null,
    vectorFetchFailed: true,
    meridian: {
      as_of: "2026-09-07 06:30 ET",
      items: [],
      total_matched: 0,
      unavailable: true,
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(sources.some((s) => s.source === "ecosystem context" && s.reason === "fetch failed"));
  assert.ok(sources.some((s) => s.source === "Vector state" && s.reason === "fetch failed"));
  assert.ok(sources.some((s) => s.source === "Meridian catalysts" && s.reason === "timeline read failed"));
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
