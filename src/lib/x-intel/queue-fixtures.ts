import { buildCta } from "@/lib/x-intel/cta";
import type { XIntelQueueRow } from "@/lib/x-intel/queue-types";

/**
 * Hand-written queue rows — the reviewer surface's fixtures.
 *
 * These are NOT sample data in the decorative sense. They are the four shapes the admin page has
 * to render correctly before any generator exists, and each one is here because getting it wrong
 * would be a specific, named failure:
 *
 *  1. READY with a precedence claim — the only shape allowed to say "BLACKOUT caught it first",
 *     and only because `chronology.detection.at_ms < chronology.market_event.at_ms`. This is the
 *     row whose timestamps the panel must show side by side, so a reviewer can check the claim
 *     rather than trust it.
 *  2. READY with NO precedence claim and NO confidence — a package that reports a move after the
 *     fact and cannot calibrate a score. It must read as complete and publishable, not as a
 *     degraded version of (1). Contract C6: the confidence key is ABSENT, not null, not 0.5.
 *  3. SKIP — a quiet hour. `NO HIGH-VALUE POST THIS HOUR` is a correct result, and the panel must
 *     render it as a decision with a reason, never as an empty or failed row.
 *  4. CROSS-PRODUCT DIVERGENCE — Vector and Helix disagreeing, shipped AS a disagreement. Per the
 *     Largo product contract, that difference is information; a package that quietly picked a
 *     winner would have manufactured a false consensus. The panel must not collapse it.
 *
 * They are exported for the admin page's empty state and for tests, and are never written to the
 * database — `x-intel` writes real rows or it writes SKIP.
 */
export const X_INTEL_QUEUE_FIXTURES: XIntelQueueRow[] = [
  {
    id: -1,
    cycle_key: "2026-08-21T11",
    session_date: "2026-08-21",
    created_at_et: "2026-08-21 11:30 ET",
    created_at: "2026-08-21T15:30:00.000Z",
    status: "READY",
    ticker_or_market: "SPX",
    headline: "SPX lost the gamma flip; Thermal had dealers short gamma below it 8 minutes early",
    post_copy: [
      "🚨 SPX JUST LOST THE GAMMA FLIP",
      "",
      "SPX broke below 6,784 at 11:42 ET.",
      "",
      "Thermal had dealers positioned SHORT GAMMA below the level at 11:34 — hedging pressure",
      "into any break, not after it.",
      "",
      "6,784 → 6,751",
      "-33 pts",
      "",
      "Helix showed put aggression building through the same window.",
      "",
      "BLACKOUT",
    ].join("\n"),
    thread: null,
    franchise: "GAMMA_SHIFT",
    attachments: [
      {
        slot: 1,
        role: "PRICE",
        image_url: "/x-intel/2026-08-21T11/1-price.png",
        caption: "SPX 15m — the 6,784 break at 11:42 ET",
        source_surface: "vector",
        source_url: "https://blackouttrades.com/vector?ticker=SPX",
        captured_at_et: "2026-08-21 11:48 ET",
        view: {
          view_id: "vector.chart",
          surface: "vector",
          page: "/vector",
          panel: "chart wrap",
          visualization: "chart",
          ticker: "SPX",
          timeframe: "15m",
          filters: { horizon: "0dte" },
          composition: "chart only — the 6,784 break and the level in one frame",
        },
      },
      {
        slot: 2,
        role: "BLACKOUT_SIGNAL",
        image_url: "/x-intel/2026-08-21T11/2-thermal.png",
        caption: "Thermal GEX — dealers short gamma below 6,784, captured 11:34 ET",
        source_surface: "thermal",
        source_url: "https://blackouttrades.com/heatmap",
        captured_at_et: "2026-08-21 11:34 ET",
        view: {
          view_id: "thermal.matrix",
          surface: "thermal",
          page: "/heatmap",
          panel: "gex matrix + key levels rail",
          visualization: "matrix",
          ticker: "SPX",
          timeframe: "0dte",
          filters: { lens: "GEX" },
          composition: "matrix cropped to the flip band, spot row visible",
        },
      },
      {
        slot: 3,
        role: "CONFIRMATION",
        image_url: "/x-intel/2026-08-21T11/3-helix.png",
        caption: "Helix tape — put aggression building 11:31–11:44 ET",
        source_surface: "helix",
        source_url: "https://blackouttrades.com/flows",
        captured_at_et: "2026-08-21 11:46 ET",
        view: {
          view_id: "helix.live_flow",
          surface: "helix",
          page: "/flows",
          panel: "flow tape",
          visualization: "tape",
          ticker: "SPX",
          timeframe: "0dte",
          filters: { quick: "0DTE" },
          composition: "tape rows 11:31-11:44, premiums legible",
        },
      },
    ],
    products_referenced: ["thermal", "helix", "vector"],
    underlying_evidence: [
      { what: "gamma flip level", value: "6,784", source: "thermal" },
      { what: "dealer gamma below flip", value: "-$412M / 1% move", source: "thermal" },
      { what: "SPX low after break", value: "6,751 (-33 pts, -0.49%)", source: "market" },
      { what: "put premium 11:31–11:44", value: "$6.2M vs $1.9M call", source: "helix" },
    ],
    chronology: {
      precedence_claimed: true,
      detection: {
        at_et: "2026-08-21 11:34 ET",
        at_ms: Date.UTC(2026, 7, 21, 15, 34),
        what: "Thermal shows dealers short gamma below 6,784",
        surface: "thermal",
      },
      market_event: {
        at_et: "2026-08-21 11:42 ET",
        at_ms: Date.UTC(2026, 7, 21, 15, 42),
        what: "SPX breaks below 6,784",
        surface: "market",
      },
      marks: [
        {
          at_et: "2026-08-21 11:31 ET",
          at_ms: Date.UTC(2026, 7, 21, 15, 31),
          what: "Helix put aggression begins building",
          surface: "helix",
        },
        {
          at_et: "2026-08-21 11:58 ET",
          at_ms: Date.UTC(2026, 7, 21, 15, 58),
          what: "SPX 6,751 — move extends 33 pts",
          surface: "market",
        },
      ],
    },
    market_outcome: null,
    confidence: {
      score: 0.78,
      basis: "34 prior short-gamma flip breaks this year; 26 extended >20 pts within the hour",
      sample_size: 34,
    },
    reason_selected:
      "Highest impact story of the hour: an index-level regime break with a detection timestamp 8 minutes ahead of the move and three distinct surfaces on it. Runners-up were single-name and lacked a second corroborating surface.",
    runners_up: [
      {
        headline: "NVDA $4.8M call sweep at 11:12 ET",
        score: 0.61,
        why_not: "Strong flow print but no second surface confirmed it; Thermal showed no matching positioning shift.",
      },
      {
        headline: "Meridian: WMT earnings tomorrow, implied move 6.1%",
        score: 0.44,
        why_not: "Not time-critical this hour — keeps until the pre-earnings slot.",
      },
    ],
    // Built through the real rotator so the fixture shows what the pipeline will actually produce,
    // not a hand-written approximation of it.
    cta: buildCta("2026-08-21T11", []),
    posted_tweet_id: null,
  },

  {
    id: -2,
    cycle_key: "2026-08-21T10",
    session_date: "2026-08-21",
    created_at_et: "2026-08-21 10:30 ET",
    created_at: "2026-08-21T14:30:00.000Z",
    status: "READY",
    ticker_or_market: "NVDA",
    headline: "NVDA reclaimed VWAP on the largest call block of the session",
    post_copy: [
      "🐋 $4.8M NVDA CALL BLOCK",
      "",
      "Single print, 10:34 ET, Sep 190C — the largest premium on the tape today.",
      "",
      "NVDA reclaimed VWAP 17 minutes later and held it.",
      "",
      "We saw the print, not the future: this is what the flow looked like, and what price did after.",
      "",
      "BLACKOUT",
    ].join("\n"),
    thread: null,
    franchise: "WHALE_WATCH",
    attachments: [
      {
        slot: 1,
        role: "PRICE",
        image_url: "/x-intel/2026-08-21T10/1-price.png",
        caption: "NVDA 5m — VWAP reclaim at 10:51 ET",
        source_surface: "vector",
        source_url: "https://blackouttrades.com/vector?ticker=NVDA",
        captured_at_et: "2026-08-21 11:02 ET",
        view: {
          view_id: "vector.chart",
          surface: "vector",
          page: "/vector",
          panel: "chart wrap",
          visualization: "chart",
          ticker: "NVDA",
          timeframe: "5m",
          filters: { horizon: "0dte" },
          composition: "chart zoomed to the VWAP reclaim",
        },
      },
      {
        slot: 2,
        role: "BLACKOUT_SIGNAL",
        image_url: "/x-intel/2026-08-21T10/2-helix.png",
        caption: "Helix — $4.8M Sep 190C block, 10:34 ET",
        source_surface: "helix",
        source_url: "https://blackouttrades.com/flows",
        captured_at_et: "2026-08-21 11:01 ET",
        view: {
          view_id: "helix.contract_detail",
          surface: "helix",
          page: "/flows",
          panel: "contract detail",
          visualization: "contract_detail",
          ticker: "NVDA",
          timeframe: null,
          filters: { contract: "NVDA Sep 190C" },
          composition: "contract identity + premium + fills in one frame",
        },
      },
    ],
    products_referenced: ["helix", "vector"],
    underlying_evidence: [
      { what: "block premium", value: "$4.8M", source: "helix" },
      { what: "contract", value: "NVDA Sep 190C", source: "helix" },
      { what: "VWAP reclaim", value: "10:51 ET, $186.20", source: "market" },
    ],
    // Reported after the fact and says so. `precedence_claimed: false` is the honest shape when
    // detection did not precede the move — the post copy above states it in words as well.
    chronology: {
      precedence_claimed: false,
      detection: null,
      market_event: null,
      marks: [
        {
          at_et: "2026-08-21 10:34 ET",
          at_ms: Date.UTC(2026, 7, 21, 14, 34),
          what: "Helix logs $4.8M Sep 190C block",
          surface: "helix",
        },
        {
          at_et: "2026-08-21 10:51 ET",
          at_ms: Date.UTC(2026, 7, 21, 14, 51),
          what: "NVDA reclaims VWAP at $186.20",
          surface: "market",
        },
      ],
    },
    market_outcome: {
      measured_at_et: "2026-08-21 16:00 ET",
      what_happened: "Held the reclaim into the close",
      move: "$185.10 → $188.40 (+1.8%)",
    },
    // No `confidence` key at all. One block print is not a calibrated base rate, and inventing a
    // score here is the exact C6 failure — see queue-types.ts.
    reason_selected:
      "Largest single premium print of the session with a clean, checkable price consequence. Two distinct surfaces only, so it ships as two attachments rather than padding a third near-identical frame.",
    runners_up: [
      {
        headline: "SPY put wall test at 678",
        score: 0.38,
        why_not: "Level held without incident; nothing happened worth a reader's attention.",
      },
    ],
    cta: buildCta("2026-08-21T10", ["SOFT"]),
    posted_tweet_id: null,
  },

  {
    id: -3,
    cycle_key: "2026-08-21T13",
    session_date: "2026-08-21",
    created_at_et: "2026-08-21 13:30 ET",
    created_at: "2026-08-21T17:30:00.000Z",
    status: "SKIP",
    ticker_or_market: "SPX",
    headline: "NO HIGH-VALUE POST THIS HOUR",
    post_copy: null,
    thread: null,
    franchise: null,
    attachments: [],
    products_referenced: ["thermal", "helix", "vector", "spx_slayer"],
    underlying_evidence: [
      { what: "SPX range 13:00–13:30", value: "6,769–6,776 (7 pts)", source: "market" },
      { what: "largest Helix print", value: "$780k — below the $2M whale threshold", source: "helix" },
      { what: "Thermal regime", value: "unchanged, long gamma since 10:15 ET", source: "thermal" },
    ],
    chronology: null,
    market_outcome: null,
    reason_selected:
      "Inspected all seven surfaces. Nothing crossed the bar: 7-point index range, no regime change, largest flow print well under threshold, no earnings or macro catalyst in the window. Forcing a story on this hour would spend reader attention on nothing.",
    runners_up: [],
    // No CTA: there is no post to reply to. A SKIP row must not carry an ask.
    cta: null,
    posted_tweet_id: null,
  },

  {
    id: -4,
    cycle_key: "2026-08-21T12",
    session_date: "2026-08-21",
    created_at_et: "2026-08-21 12:30 ET",
    created_at: "2026-08-21T16:30:00.000Z",
    status: "REVIEW",
    ticker_or_market: "TSLA",
    headline: "Vector and Helix disagree on TSLA — shipping the disagreement, not a verdict",
    post_copy: [
      "⚡ TWO OF OUR SYSTEMS DISAGREE ON TSLA",
      "",
      "HELIX    🟢 Call accumulation, $3.1M net premium since 11:00",
      "VECTOR   🔴 Structure broke 336 support at 12:07, no reclaim",
      "",
      "Both read flow. They are not reading the same flow.",
      "",
      "We are not going to pretend one of them is right yet. This is what a real desk",
      "looks like when the tape is genuinely two-sided.",
      "",
      "BLACKOUT",
    ].join("\n"),
    thread: null,
    franchise: "SIGNAL_CONFLICT",
    attachments: [
      {
        slot: 1,
        role: "BLACKOUT_SIGNAL",
        image_url: "/x-intel/2026-08-21T12/1-helix.png",
        caption: "Helix — $3.1M net call premium since 11:00 ET",
        source_surface: "helix",
        source_url: "https://blackouttrades.com/flows",
        captured_at_et: "2026-08-21 12:24 ET",
        view: {
          view_id: "helix.sector_rotation",
          surface: "helix",
          page: "/flows",
          panel: "flow tape",
          visualization: "tape",
          ticker: "TSLA",
          timeframe: null,
          filters: { side: "calls" },
          composition: "net call premium since 11:00, running total visible",
        },
      },
      {
        slot: 2,
        role: "CONFIRMATION",
        image_url: "/x-intel/2026-08-21T12/2-vector.png",
        caption: "Vector — 336 support break at 12:07 ET, no reclaim",
        source_surface: "vector",
        source_url: "https://blackouttrades.com/vector?ticker=TSLA",
        captured_at_et: "2026-08-21 12:26 ET",
        view: {
          view_id: "vector.levels",
          surface: "vector",
          page: "/vector",
          panel: "levels rail",
          visualization: "levels",
          ticker: "TSLA",
          timeframe: "15m",
          filters: { horizon: "0dte" },
          composition: "336 support with its neighbours for context",
        },
      },
    ],
    products_referenced: ["helix", "vector"],
    underlying_evidence: [
      { what: "Helix net call premium since 11:00", value: "+$3.1M", source: "helix" },
      { what: "Vector support break", value: "336.00 at 12:07 ET", source: "vector" },
      { what: "TSLA last", value: "334.80", source: "market" },
    ],
    chronology: {
      precedence_claimed: false,
      detection: null,
      market_event: null,
      marks: [
        {
          at_et: "2026-08-21 11:00 ET",
          at_ms: Date.UTC(2026, 7, 21, 15, 0),
          what: "Helix call accumulation begins",
          surface: "helix",
        },
        {
          at_et: "2026-08-21 12:07 ET",
          at_ms: Date.UTC(2026, 7, 21, 16, 7),
          what: "Vector marks 336 support break",
          surface: "vector",
        },
      ],
    },
    market_outcome: null,
    reason_selected:
      "Cross-product disagreement is the highest-value shape this account can publish and the hardest to get right, so it goes to a human before it goes out. Held at REVIEW for a read on tone, not on facts.",
    runners_up: [],
    cta: buildCta("2026-08-21T12", ["DISCORD", "SOFT"]),
    posted_tweet_id: null,
  },
];
