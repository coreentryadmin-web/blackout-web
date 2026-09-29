import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { EcosystemContext, EcosystemArsenal } from "@/lib/bie/ecosystem-context";

// findSimilarPrecedents pulls @/lib/db + ./knowledge (embeddings) — irrelevant to most of this
// file's concern (does the verdict CITE ctx.arsenal). Mutable so the PRECEDENT-tally tests below
// can vary the corpus per test while every other test keeps the [] default (precedentLine simply
// absent) — same mutable-mock pattern cortex-read.test.ts uses. Registered before the dynamic
// import below, same ordering pattern the other BIE terminal tests use.
let mockPrecedents: { source: string; kind: string; chunk: string; similarity: number }[] = [];
mock.module("./precedent-search", {
  namedExports: {
    findSimilarPrecedents: async () => mockPrecedents,
  },
});

/** Builds a fake precedent chunk with the exact `describeAuditRow()`-shaped trailer the real
 *  parser (`parsePrecedentOutcome`, spx-signals-shadow-precedents.ts) reads. */
function precedent(outcome: "target" | "stop" | "ambiguous" | "unfilled"): {
  source: string;
  kind: string;
  chunk: string;
  similarity: number;
} {
  return { source: "alert_audit:1", kind: "precedent", chunk: `Night Hawk alert on NVDA, long. Outcome: ${outcome}.`, similarity: 0.9 };
}

let synthesizeTickerVerdict: typeof import("./ticker-verdict").synthesizeTickerVerdict;
let formatTickerVerdictMarkdown: typeof import("./ticker-verdict").formatTickerVerdictMarkdown;

before(async () => {
  ({ synthesizeTickerVerdict, formatTickerVerdictMarkdown } = await import("./ticker-verdict"));
});

function arsenal(over: Partial<EcosystemArsenal> = {}): EcosystemArsenal {
  return {
    scope: "single_name",
    earnings: null,
    fundamentals: null,
    related: null,
    news: null,
    macro: null,
    breadth: null,
    unavailable_sources: [],
    ...over,
  };
}

function ctx(over: Partial<EcosystemContext> = {}, ars?: Partial<EcosystemArsenal>): EcosystemContext {
  return {
    ticker: "NVDA",
    zerodte_today: null,
    nighthawk_recent: null,
    recent_audit_entries: [],
    recent_flow: null,
    flow_full_state: null,
    recent_anomalies: [],
    spx_play: null,
    spx_full_state: null,
    spx_desk_convergence: null,
    flow_feed_fresh: true,
    gex_positioning: null,
    vector_full_state: null,
    arsenal: arsenal(ars),
    ...over,
  } as EcosystemContext;
}

async function md(c: EcosystemContext, q: string): Promise<string> {
  return formatTickerVerdictMarkdown(await synthesizeTickerVerdict(c, q));
}

test("single-name verdict cites the arsenal: earnings countdown, squeeze-fuel SI, news, peers", async () => {
  const out = await md(
    ctx({ ticker: "NVDA" }, {
      scope: "single_name",
      earnings: { earnings_date: "2026-07-16", days_until: 3, report_time: "afterhours", is_confirmed: true },
      fundamentals: { days_to_cover: 6.4, short_volume_ratio: 0.41, price_target: null, as_of: "2026-07-10" },
      news: { count: 2, newest: "2026-07-12", headlines: ["NVDA guidance raised", "new GPU"] },
      related: ["AMD", "AVGO"],
    }),
    "should I hold NVDA into earnings"
  );
  // Earnings countdown surfaces as CONTEXT + drives the event-risk verdict line.
  assert.match(out, /earnings 3d out afterhours \(confirmed\)/);
  assert.match(out, /HIGH event-window risk/);
  // Elevated days-to-cover is an ALIGNMENT (squeeze) tell.
  assert.match(out, /days-to-cover 6\.4 \(squeeze fuel\)/);
  // News + peers cited.
  assert.match(out, /2 recent news \("NVDA guidance raised"\)/);
  assert.match(out, /peers AMD, AVGO/);
  // A hold-into-earnings question gets the binary-event friction.
  assert.match(out, /holding through the print is a binary event/);
});

test("index verdict cites macro + breadth (relevance-gated color)", async () => {
  const out = await md(
    ctx({ ticker: "SPX" }, {
      scope: "index",
      macro: { yield_10_year: 4.23, curve_10y_1y_spread: -0.31, cpi: 3.1, as_of: "2026-07-11" },
      breadth: { tone: "risk_on", summary: "Market breadth: 62% advancing — risk on.", as_of: "2026-07-13" },
    }),
    "what's the SPX verdict"
  );
  assert.match(out, /macro 10y 4\.23%, 10y-1y -0\.31 inverted, CPI 3\.1/);
  assert.match(out, /breadth risk on/);
});

// A committed 0DTE IRON CONDOR's `direction` column is NOMINAL provenance only (the fade side
// of the pin it came from) — the structure is delta-neutral, so treating it as a directional
// call fabricates a signal the 0DTE desk never actually took. ecosystem-context.ts's own doc
// comment on `EcosystemZeroDteTake.is_condor` names this exact trap and requires consumers to
// gate on it before comparing `direction` against another desk's call — play-brief-intel.ts's
// `crossDeskCoaching`/`flowIntelSection` and play-brief-narrative-coaching.ts's `zLong`/`zShort`
// already gate on `is_condor !== true`. ticker-verdict.ts's `structuralBias`/ALIGNMENT line did
// not, so a same-day condor (say, direction "short" from its fade side) silently pushed the
// deterministic Largo verdict toward "bearish" and printed "0DTE SHORT score N" as if it were a
// real desk call, with nothing else in context to justify that bias.
test("0DTE condor's nominal direction never biases the verdict or reads as a directional call", async () => {
  const out = await md(
    ctx({
      ticker: "SPX",
      zerodte_today: {
        session_date: "2026-09-12",
        direction: "short",
        score: 91,
        conviction: "A",
        status: "OPEN",
        first_flagged_at: "2026-09-12T14:00:00Z",
        is_condor: true,
      },
    }),
    "what's the SPX verdict"
  );
  // Never fabricate a directional bias from a condor's nominal fade-side direction.
  assert.match(out, /Structure reads \*\*neutral\*\*/);
  assert.doesNotMatch(out, /0DTE SHORT/);
  // The desk's real (non-directional) posture is still surfaced, honestly labeled.
  assert.match(out, /0DTE condor \(structure-neutral\)/);
});

test("honesty: requested-but-thin arsenal legs are surfaced in an UNAVAILABLE line, never fabricated", async () => {
  const out = await md(
    ctx({ ticker: "NVDA" }, {
      scope: "single_name",
      unavailable_sources: [
        { source: "earnings", reason: "no upcoming date" },
        { source: "fundamentals/short-interest", reason: "no data for ticker" },
      ],
    }),
    "is NVDA a good hold"
  );
  assert.match(out, /UNAVAILABLE  earnings \(no upcoming date\), fundamentals\/short-interest \(no data for ticker\)\./);
  // Nothing fabricated: no earnings/SI figures appear.
  assert.doesNotMatch(out, /days-to-cover/);
  assert.doesNotMatch(out, /\bearnings \d+d out/);
});

test("no arsenal data at all → no CONTEXT/UNAVAILABLE noise (never invents a section)", async () => {
  const out = await md(
    ctx({ ticker: "NVDA", nighthawk_recent: { edition_for: "2026-07-12", direction: "long", conviction: "A", outcome: "pending", score: 80 } }),
    "what's the NVDA read"
  );
  assert.doesNotMatch(out, /CONTEXT/);
  assert.doesNotMatch(out, /UNAVAILABLE/);
  // The base verdict still renders.
  assert.match(out, /desk verdict/);
  assert.match(out, /NIGHT HAWK LONG \(A\)/);
});

test("low (non-elevated) days-to-cover is stated as CONTEXT, not flagged as squeeze fuel", async () => {
  const out = await md(
    ctx({ ticker: "AAPL" }, {
      scope: "single_name",
      fundamentals: { days_to_cover: 1.3, short_volume_ratio: 0.2, price_target: null, as_of: "2026-07-10" },
    }),
    "AAPL verdict"
  );
  assert.match(out, /CONTEXT  days-to-cover 1\.3\./);
  assert.doesNotMatch(out, /squeeze fuel/);
});

// PRECEDENT tally: "ambiguous"/"unfilled" outcomes are real corpus hits but are NOT
// directionally informative (the alert never hit a profit target OR a stop) — they must be
// excluded from both the numerator and denominator, exactly like the ONLY other consumer of
// this same alert_audit_log precedent corpus (spx-signals-shadow-precedents.ts's
// computePrecedentShadowFactor) already does. The prior implementation counted every returned
// precedent in the denominator while only a literal "target" outcome could ever match its win
// regex, silently deflating (or, as below, completely inverting the sign of) the printed
// percentage whenever a thin/unresolved precedent was mixed in.
test("PRECEDENT excludes ambiguous/unfilled outcomes from the win-rate tally, not just from wins", async () => {
  mockPrecedents = [precedent("target"), precedent("target"), precedent("unfilled"), precedent("unfilled")];
  try {
    const out = await md(ctx({ ticker: "NVDA" }), "NVDA verdict");
    // Old (buggy) behavior: wins=2, denominator=4 → "~50% positive outcomes" — reads as a coin-flip
    // precedent set even though BOTH cleanly-resolved precedents were clean wins. Correct behavior:
    // 2 targets of 2 cleanly-resolved (the 2 unfilled excluded from both sides) → 100%.
    assert.match(out, /PRECEDENT {2}2 similar NVDA setups cleanly resolved in corpus — ~100% hit target/);
  } finally {
    mockPrecedents = [];
  }
});

test("PRECEDENT is omitted (not a fabricated 0%) when fewer than 2 precedents cleanly resolved target/stop", async () => {
  mockPrecedents = [precedent("target"), precedent("ambiguous"), precedent("unfilled")];
  try {
    const out = await md(ctx({ ticker: "NVDA" }), "NVDA verdict");
    // Only 1 of the 3 returned precedents is directionally informative — below the usable-evidence
    // floor, so the line must not render at all (never a fabricated/thin percentage).
    assert.doesNotMatch(out, /PRECEDENT/);
  } finally {
    mockPrecedents = [];
  }
});

test("PRECEDENT tallies stop outcomes against target, ignoring ambiguous noise mixed in", async () => {
  mockPrecedents = [precedent("target"), precedent("stop"), precedent("stop"), precedent("ambiguous")];
  try {
    const out = await md(ctx({ ticker: "NVDA" }), "NVDA verdict");
    // 1 target + 2 stop = 3 cleanly resolved (ambiguous excluded) → 1/3 ≈ 33% hit target.
    assert.match(out, /PRECEDENT {2}3 similar NVDA setups cleanly resolved in corpus — ~33% hit target/);
  } finally {
    mockPrecedents = [];
  }
});
