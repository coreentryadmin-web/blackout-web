import test from "node:test";
import assert from "node:assert/strict";
import {
  ageSecondsLabel,
  relativeAgeLabel,
  collectBriefUnavailableSources,
  gexMarketSessionNote,
  gexMatrixStale,
  meridianCatalystAgeMs,
  meridianCatalystStale,
  newsCatalystAgeMs,
  newsCatalystStale,
  optionMarkIsStale,
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

// GEX-matrix sibling of `describeVectorFreshness`'s `market_session_note` (#4076 comment
// 5750099882, "Mechanism 2" -- Vector's half shipped as #5306, this is the GEX-matrix half).
test("gexMarketSessionNote: fresh compute on a closed market (weekend self-warm) discloses it", () => {
  const readMs = Date.parse("2026-09-20T14:00:00.000Z"); // Sun 10:00 ET -- CLOSED
  const gex = { spot: 100, asof: new Date(readMs).toISOString(), gamma_posture: "long" };
  const note = gexMarketSessionNote(gex, readMs);
  assert.ok(note, "expected a disclosure for a fresh compute against a closed market");
  assert.match(note!, /market is CLOSED/);
});

test("gexMarketSessionNote: fresh compute during real RTH is null (market is open, nothing to disclose)", () => {
  const readMs = Date.parse("2026-09-18T15:00:00.000Z"); // Fri 11:00 ET -- OPEN
  const gex = { spot: 100, asof: new Date(readMs).toISOString(), gamma_posture: "long" };
  assert.equal(gexMarketSessionNote(gex, readMs), null);
});

test("gexMarketSessionNote: an already-stale GEX matrix suppresses the note (its own staleness note already covers it)", () => {
  const readMs = Date.parse("2026-09-20T14:00:00.000Z"); // Sun 10:00 ET -- CLOSED
  const oldAsof = new Date(readMs - 60 * 60 * 1000).toISOString(); // 1h old -- well past GEX_MATRIX_STALE_MS
  const gex = { spot: 100, asof: oldAsof, gamma_posture: "long" };
  assert.equal(gexMatrixStale(gex, readMs), true, "sanity: fixture is actually stale");
  assert.equal(gexMarketSessionNote(gex, readMs), null);
});

test("gexMarketSessionNote: null gex or unreadable age never throws or fabricates a note", () => {
  assert.equal(gexMarketSessionNote(null, Date.now()), null);
  assert.equal(gexMarketSessionNote({ spot: 100, asof: "not-a-date", gamma_posture: "long" }, Date.now()), null);
});

test("meridianCatalystStale: fresh as_of (Largo C2)", () => {
  const readMs = Date.parse("2026-09-15T20:00:00.000Z");
  const slice = { as_of: new Date(readMs - 30_000).toISOString(), items: [], total_matched: 0 };
  assert.equal(meridianCatalystAgeMs(slice, readMs), 30_000);
  assert.equal(meridianCatalystStale(slice, readMs), false);
});

test("meridianCatalystStale: as_of past the 120s bound is stale — a degraded Benzinga upstream under withServerCache's stale-while-revalidate path can serve the same as_of for up to 10 minutes (Largo C2)", () => {
  const readMs = Date.parse("2026-09-15T20:00:00.000Z");
  const slice = { as_of: new Date(readMs - 300_000).toISOString(), items: [], total_matched: 0 };
  assert.equal(meridianCatalystStale(slice, readMs), true);
});

test("meridianCatalystStale: unparseable as_of (e.g. an ET wall-clock test fixture, not the real ISO shape) reads as unknown age, not stale", () => {
  const readMs = Date.parse("2026-09-15T20:00:00.000Z");
  const slice = { as_of: "2026-09-15 09:00 ET", items: [], total_matched: 0 };
  assert.equal(meridianCatalystAgeMs(slice, readMs), null);
  assert.equal(meridianCatalystStale(slice, readMs), false);
});

test("meridianCatalystStale: null slice is not stale (absence is a separate signal)", () => {
  assert.equal(meridianCatalystStale(null), false);
});

test("newsCatalystStale: fresh as_of (Largo C2, 2026-09-18) — mirrors meridianCatalystStale for arsenal.news", () => {
  const readMs = Date.parse("2026-09-18T20:00:00.000Z");
  const asOf = new Date(readMs - 30_000).toISOString();
  assert.equal(newsCatalystAgeMs(asOf, readMs), 30_000);
  assert.equal(newsCatalystStale(asOf, readMs), false);
});

test("newsCatalystStale: as_of past the 120s bound is stale — same stale-while-revalidate exposure `NewsResult.asOf` (polygon-news.ts) carries as meridianCatalystSection's slice.as_of (Largo C2)", () => {
  const readMs = Date.parse("2026-09-18T20:00:00.000Z");
  const asOf = new Date(readMs - 300_000).toISOString();
  assert.equal(newsCatalystStale(asOf, readMs), true);
});

test("newsCatalystStale: unparseable as_of reads as unknown age, not stale", () => {
  const readMs = Date.parse("2026-09-18T20:00:00.000Z");
  assert.equal(newsCatalystAgeMs("not-a-date", readMs), null);
  assert.equal(newsCatalystStale("not-a-date", readMs), false);
});

test("newsCatalystStale: null/undefined as_of is not stale (absence is a separate signal, e.g. an older fixture that predates this field)", () => {
  assert.equal(newsCatalystStale(null), false);
  assert.equal(newsCatalystStale(undefined), false);
});

test("collectBriefUnavailableSources: stale Meridian catalyst read surfaces in unavailableSources (Largo C2/C3)", () => {
  const readMs = Date.parse("2026-09-15T20:00:00.000Z");
  const ctx = {
    sessionDate: "2026-09-15",
    meridian: { as_of: new Date(readMs - 300_000).toISOString(), items: [], total_matched: 0 },
  } as SwingPlayBriefContext;
  const origNow = Date.now;
  Date.now = () => readMs;
  try {
    const sources = collectBriefUnavailableSources(ctx);
    assert.ok(
      sources.some((s) => s.source === "Meridian catalysts" && s.reason.startsWith("stale")),
    );
  } finally {
    Date.now = origNow;
  }
});

test("collectBriefUnavailableSources: CLOSED play does not flag a stale Meridian read (historical record, not a live decision)", () => {
  const readMs = Date.parse("2026-09-15T20:00:00.000Z");
  const ctx = {
    sessionDate: "2026-09-15",
    play: { status: "CLOSED" },
    meridian: { as_of: new Date(readMs - 300_000).toISOString(), items: [], total_matched: 0 },
  } as unknown as SwingPlayBriefContext;
  const origNow = Date.now;
  Date.now = () => readMs;
  try {
    const sources = collectBriefUnavailableSources(ctx);
    assert.ok(!sources.some((s) => s.source === "Meridian catalysts" && s.reason.startsWith("stale")));
  } finally {
    Date.now = origNow;
  }
});

// GAP FOUND (Ask Largo standing mandate, 2026-09-19): a WATCH play whose entry is already dead
// (deadPlayReason — invalidated / entry-deadline expired / contract expired / extended-chase) is
// functionally identical to CLOSED for this file's own "today's live desk state doesn't matter"
// reasoning, but nothing suppressed the wall-of-stale-chips for it until this fix. Mirrors the
// CLOSED-play test immediately above, one bucket over.
test("collectBriefUnavailableSources: dead WATCH play (entry-validity expired) does not flag a stale Meridian read (functionally identical to CLOSED)", () => {
  const readMs = Date.parse("2026-09-15T20:00:00.000Z");
  const ctx = {
    sessionDate: "2026-09-15",
    play: { status: "WATCH", watchEntryExpired: true },
    meridian: { as_of: new Date(readMs - 300_000).toISOString(), items: [], total_matched: 0 },
  } as unknown as SwingPlayBriefContext;
  const origNow = Date.now;
  Date.now = () => readMs;
  try {
    const sources = collectBriefUnavailableSources(ctx);
    assert.ok(!sources.some((s) => s.source === "Meridian catalysts" && s.reason.startsWith("stale")));
  } finally {
    Date.now = origNow;
  }
});

test("collectBriefUnavailableSources: dead WATCH play (thesis invalidated) also suppresses prior-session swing-discovery-scan noise", () => {
  const ctx = {
    sessionDate: "2026-09-15",
    scanSessionDay: "2026-09-10",
    play: { status: "WATCH", setupState: "INVALIDATED" },
  } as unknown as SwingPlayBriefContext;
  const sources = collectBriefUnavailableSources(ctx);
  assert.ok(!sources.some((s) => s.source === "swing discovery scan"));
});

test("collectBriefUnavailableSources: a still-live WATCH play (not dead) keeps surfacing staleness — the dead-WATCH suppression must not over-suppress ordinary candidates", () => {
  const readMs = Date.parse("2026-09-15T20:00:00.000Z");
  const ctx = {
    sessionDate: "2026-09-15",
    play: { status: "WATCH", setupState: "FORMING", entryStatus: "PRE_TRIGGER", watchEntryExpired: false },
    meridian: { as_of: new Date(readMs - 300_000).toISOString(), items: [], total_matched: 0 },
  } as unknown as SwingPlayBriefContext;
  const origNow = Date.now;
  Date.now = () => readMs;
  try {
    const sources = collectBriefUnavailableSources(ctx);
    assert.ok(sources.some((s) => s.source === "Meridian catalysts" && s.reason.startsWith("stale")));
  } finally {
    Date.now = origNow;
  }
});

test("collectBriefUnavailableSources: an OPEN position sharing an EXPIRED-looking leftover entryStatus is NOT treated as dead (dead-reason check is WATCH-bucket-only)", () => {
  const readMs = Date.parse("2026-09-15T20:00:00.000Z");
  const ctx = {
    sessionDate: "2026-09-15",
    play: { status: "OPEN", entryStatus: "EXPIRED" },
    meridian: { as_of: new Date(readMs - 300_000).toISOString(), items: [], total_matched: 0 },
  } as unknown as SwingPlayBriefContext;
  const origNow = Date.now;
  Date.now = () => readMs;
  try {
    const sources = collectBriefUnavailableSources(ctx);
    assert.ok(sources.some((s) => s.source === "Meridian catalysts" && s.reason.startsWith("stale")));
  } finally {
    Date.now = origNow;
  }
});

// Largo C2/C3 (2026-09-18): #5166 disclosed ticker-news staleness INLINE in the narrative
// (play-brief-intel.ts's `staleLead`) but never reached unavailableSources — the one signal the
// UI's `UnavailableChip` reads from. Every sibling freshness check (Meridian catalysts above,
// option marks, GEX, Vector) reaches BOTH surfaces; this proves news catalysts now do too.
test("collectBriefUnavailableSources: stale ticker-news read surfaces in unavailableSources (Largo C2/C3, mirrors Meridian catalysts)", () => {
  const readMs = Date.parse("2026-09-18T20:00:00.000Z");
  const ctx = {
    sessionDate: "2026-09-18",
    ecosystem: {
      arsenal: {
        news: {
          count: 2,
          newest: null,
          headlines: ["Headline A", "Headline B"],
          as_of: new Date(readMs - 300_000).toISOString(),
        },
      },
    },
  } as unknown as SwingPlayBriefContext;
  const origNow = Date.now;
  Date.now = () => readMs;
  try {
    const sources = collectBriefUnavailableSources(ctx);
    assert.ok(
      sources.some((s) => s.source === "Ticker news" && s.reason.startsWith("stale")),
      `expected a stale "Ticker news" absence entry, got: ${JSON.stringify(sources)}`,
    );
  } finally {
    Date.now = origNow;
  }
});

test("collectBriefUnavailableSources: fresh ticker-news read does not flag staleness", () => {
  const readMs = Date.parse("2026-09-18T20:00:00.000Z");
  const ctx = {
    sessionDate: "2026-09-18",
    ecosystem: {
      arsenal: {
        news: {
          count: 2,
          newest: null,
          headlines: ["Headline A", "Headline B"],
          as_of: new Date(readMs - 5_000).toISOString(),
        },
      },
    },
  } as unknown as SwingPlayBriefContext;
  const origNow = Date.now;
  Date.now = () => readMs;
  try {
    const sources = collectBriefUnavailableSources(ctx);
    assert.ok(!sources.some((s) => s.source === "Ticker news"));
  } finally {
    Date.now = origNow;
  }
});

test("collectBriefUnavailableSources: CLOSED play does not flag stale ticker-news (historical record)", () => {
  const readMs = Date.parse("2026-09-18T20:00:00.000Z");
  const ctx = {
    sessionDate: "2026-09-18",
    play: { status: "CLOSED" },
    ecosystem: {
      arsenal: {
        news: {
          count: 2,
          newest: null,
          headlines: ["Headline A", "Headline B"],
          as_of: new Date(readMs - 300_000).toISOString(),
        },
      },
    },
  } as unknown as SwingPlayBriefContext;
  const origNow = Date.now;
  Date.now = () => readMs;
  try {
    const sources = collectBriefUnavailableSources(ctx);
    assert.ok(!sources.some((s) => s.source === "Ticker news"));
  } finally {
    Date.now = origNow;
  }
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

test("resolveGammaPosture: live Vector regime of 'unknown' defers to the live GEX posture, not itself", () => {
  // Live repro 2026-09-12: CG's own COMMIT brief. Vector's regime read (vector-regime.ts) is a
  // FOUR-value enum -- "long"/"short"/"transition"/"unknown" -- not the GEX matrix's own two-value
  // "long"|"short"|null. Vector genuinely couldn't resolve a posture ("unknown"), but the GEX
  // matrix's OWN gamma_posture field was live and said "short". The old check treated "unknown" as
  // an equally-resolved answer and returned it outright, so dealerPostureLine rendered "dealer
  // gamma posture not resolved on this read" in the SAME brief whose "GEX posture" section (reading
  // gex.gamma_posture directly, bypassing this function) confidently said "dealers short gamma...
  // Net GEX: -4.3M" -- a direct, member-visible contradiction.
  const ctx = {
    ecosystem: {
      gex_positioning: {
        spot: 42.34,
        gamma_posture: "short",
        matrix_age_sec: 30,
        freshness: "cached",
      },
    },
    vector: {
      regime: { posture: "unknown", label: "UNKNOWN" },
      freshness: "live",
      dataAgeMs: 5_000,
    },
  } as SwingPlayBriefContext;

  assert.equal(resolveGammaPosture(ctx, ctx.vector), "short", "unknown Vector regime must defer to the resolved GEX posture, not silence it");
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

test("collectBriefUnavailableSources: prior-session Night Hawk Legacy surfaces in unavailableSources (Largo C3/C4)", () => {
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
        s.source === "Night Hawk Legacy" &&
        s.reason === "prior session (2026-09-05) — today's edition not yet run",
    ),
  );
});

test("collectBriefUnavailableSources: STALE-TICKER Night Hawk Legacy (5+ weeks) must NOT claim 'today's edition not yet run' (found live 2026-09-10, GOOG)", () => {
  // Live evidence: GOOG's nighthawk_recent.edition_for read 2026-08-03 while the real Legacy
  // edition was freshly published (GET /api/market/nighthawk/edition, published_at
  // 2026-09-09T21:34:32Z) — a per-ticker "not featured recently" fact was misreported as a
  // system-wide "the pipeline hasn't run today" claim. The query behind nighthawk_recent has no
  // date filter (ORDER BY edition_for DESC LIMIT 1 for this ticker only), so any ticker Legacy
  // hasn't picked recently will always show an old date here — that must read as ticker absence,
  // never as edition staleness.
  const ctx = {
    sessionDate: "2026-09-10",
    ecosystem: {
      nighthawk_recent: {
        edition_for: "2026-08-03",
        direction: "short",
        conviction: "high",
        outcome: "open",
        score: 72,
      },
    },
  } as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);
  const nh = sources.find((s) => s.source === "Night Hawk Legacy");
  assert.ok(nh, "Night Hawk Legacy chip should still surface (the fact is real)");
  assert.ok(
    !nh!.reason.includes("today's edition not yet run"),
    `must not assert an unverified system-wide claim from a stale per-ticker date, got: ${nh!.reason}`,
  );
  assert.equal(nh!.reason, "no recent Legacy edition for this ticker (last featured 2026-08-03)");
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

test("collectBriefUnavailableSources: every swing-populated source carries Largo C3's retryable + what_is_missing (not just reason prose)", () => {
  // Regression for a genuine C3 gap: the shared BieUnavailableSource shape optionally supports
  // `what_is_missing`/`retryable` (see answer-envelope.ts), but every one of this file's own
  // push sites previously set ONLY `{source, reason}` — a model reading unavailableSources had to
  // guess whether asking again later was worth it, exactly what C3 says must never be guessed.
  // This asserts a representative retryable-true (transient) and retryable-false (structural) case
  // both now carry the full shape, so this class of gap cannot silently return.
  const ctx = {
    ecosystem: { flow_feed_fresh: false },
    openBook: null,
    play: {
      status: "OPEN",
      thesisHealth: { uncalibrated: true },
    },
  } as unknown as SwingPlayBriefContext;

  const sources = collectBriefUnavailableSources(ctx);

  const helix = sources.find((s) => s.source === "HELIX flow");
  assert.ok(helix, "HELIX flow absence should be present");
  assert.equal(typeof helix!.what_is_missing, "string");
  assert.ok(helix!.what_is_missing!.length > 0);
  assert.equal(helix!.retryable, true); // a stale pipeline tick resolves on its own next tick

  const openBook = sources.find((s) => s.source === "open book");
  assert.ok(openBook, "open book absence should be present");
  assert.equal(typeof openBook!.what_is_missing, "string");
  assert.equal(openBook!.retryable, true); // a failed ledger read is a transient fetch failure
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

// Live repro 2026-09-15 (Ask Largo standing mandate): CRWD and AAPL both carry `swing-active-
// refresh`'s exact 15-minute on-schedule `markAsOf` (":00"/":15" wall-clock stamps), yet the
// generic cross-product 10-minute freshness bucket flagged them "stale" at the ~13-minute mark —
// a false positive during normal, healthy operation, roughly a third of every refresh cycle,
// because a swing option mark's ONLY writer runs every 15 minutes (no faster live-marks writer
// exists for this DB column — see optionMarkIsStale's own doc comment).
test("optionMarkIsStale: a mark on-schedule for the 15-minute swing-active-refresh cadence is NOT stale", () => {
  const readMs = Date.parse("2026-09-15T19:13:00.000Z"); // 15:13 ET
  const play = {
    markIsSync: false,
    markAsOf: "2026-09-15T19:00:00.000Z", // synced at the prior :00 tick, 13 minutes old
    status: "OPEN",
  } as unknown as import("@/features/nighthawk/command-deck/types").TerminalPlay;

  assert.equal(
    optionMarkIsStale(play, readMs),
    false,
    "a 13-minute-old mark is still within one healthy swing-active-refresh cycle and must not read as stale",
  );
});

test("optionMarkIsStale: a mark that has missed its next scheduled refresh IS stale", () => {
  const readMs = Date.parse("2026-09-15T19:19:00.000Z"); // 15:19 ET — past the 15:15 tick that should have landed
  const play = {
    markIsSync: false,
    markAsOf: "2026-09-15T19:00:00.000Z",
    status: "OPEN",
  } as unknown as import("@/features/nighthawk/command-deck/types").TerminalPlay;

  assert.equal(
    optionMarkIsStale(play, readMs),
    true,
    "a mark past 18 minutes old has missed a scheduled refresh and should read stale",
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
  assert.ok(!sources.some((s) => s.source === "Night Hawk Legacy"));
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

test("ageSecondsLabel: null/undefined returns null (optional-suffix callers omit the parenthetical entirely)", () => {
  assert.equal(ageSecondsLabel(null), null);
  assert.equal(ageSecondsLabel(undefined), null);
});

test("ageSecondsLabel: a finite non-negative age renders 'Ns'", () => {
  assert.equal(ageSecondsLabel(42_000), "42s");
  assert.equal(ageSecondsLabel(0), "0s");
});

test("ageSecondsLabel: Number.POSITIVE_INFINITY (Vector's future-skew sentinel) renders 'clock-skewed', never 'Infinitys'", () => {
  assert.equal(ageSecondsLabel(Number.POSITIVE_INFINITY), "clock-skewed");
});

test("ageSecondsLabel: a negative (future-skewed) age renders 'clock-skewed', never a negative number", () => {
  assert.equal(ageSecondsLabel(-500_000), "clock-skewed");
});

test("relativeAgeLabel: null/undefined/unparseable timestamp returns null", () => {
  const now = Date.parse("2026-09-16T15:00:00Z");
  assert.equal(relativeAgeLabel(null, now), null);
  assert.equal(relativeAgeLabel(undefined, now), null);
  assert.equal(relativeAgeLabel("not-a-date", now), null);
});

test("relativeAgeLabel: sub-hour age renders 'Nm ago'", () => {
  const now = Date.parse("2026-09-16T15:00:00Z");
  const fourteenMinAgo = new Date(now - 14 * 60_000).toISOString();
  assert.equal(relativeAgeLabel(fourteenMinAgo, now), "14m ago");
});

test("relativeAgeLabel: hour-plus age renders 'Nh ago'", () => {
  const now = Date.parse("2026-09-16T15:00:00Z");
  const threeHoursAgo = new Date(now - 3 * 60 * 60_000).toISOString();
  assert.equal(relativeAgeLabel(threeHoursAgo, now), "3h ago");
});

test("relativeAgeLabel: a future (clock-skewed) timestamp renders 'clock-skewed', never a negative age", () => {
  const now = Date.parse("2026-09-16T15:00:00Z");
  const future = new Date(now + 500_000).toISOString();
  assert.equal(relativeAgeLabel(future, now), "clock-skewed");
});
