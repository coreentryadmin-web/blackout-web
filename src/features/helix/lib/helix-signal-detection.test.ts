import test from "node:test";
import assert from "node:assert/strict";
import {
  detectVelocitySpikes,
  detectSplitFlow,
  signalEligible,
  signalEligibility,
  type MinimalFlow,
} from "./helix-signal-detection";

// Extracted verbatim from FlowFeed.tsx's own inline useMemo blocks (2026-08-02 Helix audit,
// Tier 2 item #9) so the client badge and the new server-side outcome-persisting cron share
// ONE definition. These tests pin the exact thresholds so a future edit to either consumer
// can't silently drift the two apart again.

function flow(over: Partial<MinimalFlow> & { ticker: string }): MinimalFlow {
  return { premium: 300_000, option_type: "CALL", ...over };
}

test("detectVelocitySpikes: fires only when recent count AND ratio both clear the threshold", () => {
  const now = Date.now();
  const recentIso = new Date(now - 5 * 60_000).toISOString();
  const priorIso = new Date(now - 20 * 60_000).toISOString();

  // 3 recent prints, 1 prior print -> ratio 3, recent 3: qualifies (recent>=2, ratio>=3)
  const flows: MinimalFlow[] = [
    flow({ ticker: "NVDA", event_at: recentIso }),
    flow({ ticker: "NVDA", event_at: recentIso }),
    flow({ ticker: "NVDA", event_at: recentIso }),
    flow({ ticker: "NVDA", event_at: priorIso }),
    // AAPL: 1 recent print only -> below VELOCITY_MIN_RECENT, must not fire
    flow({ ticker: "AAPL", event_at: recentIso }),
  ];

  const spikes = detectVelocitySpikes(flows, now);
  assert.equal(spikes.length, 1);
  assert.equal(spikes[0].ticker, "NVDA");
  assert.equal(spikes[0].recent, 3);
  assert.equal(spikes[0].prior, 1);
  assert.equal(spikes[0].ratio, 3);
});

test("detectVelocitySpikes: skips rows with no event_at (never assumes recency)", () => {
  const now = Date.now();
  const flows: MinimalFlow[] = [
    flow({ ticker: "TSLA", event_at: null }),
    flow({ ticker: "TSLA", event_at: null }),
    flow({ ticker: "TSLA", event_at: null }),
  ];
  assert.deepEqual(detectVelocitySpikes(flows, now), []);
});

test("detectSplitFlow: fires only when BOTH legs clear the $500K minimum", () => {
  const now = Date.now();
  const recentIso = new Date(now - 10 * 60_000).toISOString();

  const flows: MinimalFlow[] = [
    flow({ ticker: "SPX", option_type: "CALL", premium: 600_000, alerted_at: recentIso }),
    flow({ ticker: "SPX", option_type: "PUT", premium: 550_000, alerted_at: recentIso }),
    // QQQ: put leg below the $500K minimum -> must not fire
    flow({ ticker: "QQQ", option_type: "CALL", premium: 900_000, alerted_at: recentIso }),
    flow({ ticker: "QQQ", option_type: "PUT", premium: 100_000, alerted_at: recentIso }),
  ];

  const splits = detectSplitFlow(flows, now);
  assert.equal(splits.length, 1);
  assert.equal(splits[0].ticker, "SPX");
  assert.equal(splits[0].callPremium, 600_000);
  assert.equal(splits[0].putPremium, 550_000);
  assert.equal(splits[0].direction, "mixed"); // callPct = round(600000/1150000*100) = 52
});

test("detectSplitFlow: excludes rows outside the 30-min window and undated rows", () => {
  const now = Date.now();
  const staleIso = new Date(now - 45 * 60_000).toISOString();

  const flows: MinimalFlow[] = [
    flow({ ticker: "META", option_type: "CALL", premium: 700_000, alerted_at: staleIso }),
    flow({ ticker: "META", option_type: "PUT", premium: 700_000, alerted_at: staleIso }),
    flow({ ticker: "AMZN", option_type: "CALL", premium: 700_000, alerted_at: undefined, tape_time_estimated: true }),
    flow({ ticker: "AMZN", option_type: "PUT", premium: 700_000, alerted_at: undefined, tape_time_estimated: true }),
  ];

  assert.deepEqual(detectSplitFlow(flows, now), []);
});

test("detectSplitFlow: direction reflects the dominant leg", () => {
  const now = Date.now();
  const recentIso = new Date(now - 5 * 60_000).toISOString();
  const bullish: MinimalFlow[] = [
    flow({ ticker: "IWM", option_type: "CALL", premium: 900_000, alerted_at: recentIso }),
    flow({ ticker: "IWM", option_type: "PUT", premium: 550_000, alerted_at: recentIso }),
  ];
  const [entry] = detectSplitFlow(bullish, now);
  assert.equal(entry.direction, "bullish"); // 900k/1450k = 62% >= 60
});

// ── §9.0 — signal eligibility is stated once, and both detectors read it ───────────────────────

test("signalEligible accepts a real print time and refuses an undatable print", () => {
  // The Group A shape: UW reported a time.
  assert.equal(signalEligible({ ticker: "NVDA", premium: 1, event_at: "2026-08-23T14:00:00Z" }), true);
  // A real, non-estimated alerted_at IS a real time — flowEventTimeMs's documented contract.
  assert.equal(
    signalEligible({ ticker: "NVDA", premium: 1, alerted_at: "2026-08-23T14:00:00Z", tape_time_estimated: false }),
    true
  );
  // The Group B shape (§4A): the index feed sends no time, so the tape stamps an ESTIMATE. An
  // estimated time is an ingest time, not a print time, and must never place a print in a window.
  assert.equal(
    signalEligible({ ticker: "SPX", premium: 1, alerted_at: "2026-08-23T14:00:00Z", tape_time_estimated: true }),
    false
  );
  assert.equal(signalEligible({ ticker: "SPX", premium: 1 }), false);
  assert.equal(signalEligible({ ticker: "SPX", premium: 1, event_at: "not-a-date" }), false);
});

test("the two detectors and the reported denominator select the SAME prints", () => {
  // The defect this closes is a THIRD rule drifting from the two detectors (§9.9). Rather than
  // trusting the shared call, drive real prints through both detectors and assert that every
  // ticker either is eligible or cannot appear in either result.
  const now = Date.parse("2026-08-23T18:00:00Z");
  const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
  const flows = [
    // Datable, and shaped to fire BOTH signals on DTBL.
    ...Array.from({ length: 4 }, () => ({ ticker: "DTBL", premium: 600_000, option_type: "CALL", event_at: iso(2) })),
    { ticker: "DTBL", premium: 900_000, option_type: "PUT", event_at: iso(3) },
    // Undatable: the index-feed shape. Enough volume and premium to fire both, if it could.
    ...Array.from({ length: 40 }, () => ({
      ticker: "SPX", premium: 5_000_000, option_type: "CALL", alerted_at: iso(2), tape_time_estimated: true,
    })),
    ...Array.from({ length: 40 }, () => ({
      ticker: "SPX", premium: 5_000_000, option_type: "PUT", alerted_at: iso(2), tape_time_estimated: true,
    })),
  ];

  const cov = signalEligibility(flows);
  assert.equal(cov.total, 85);
  assert.equal(cov.eligible, 5);
  assert.equal(cov.ineligible, 80);
  assert.deepEqual(cov.ineligibleTickers, ["SPX"]);

  const spikeTickers = new Set(detectVelocitySpikes(flows, now).map((s) => s.ticker));
  const splitTickers = new Set(detectSplitFlow(flows, now).map((s) => s.ticker));
  // SPX has 80 prints, $400M, both legs, inside both windows — and fires NEITHER. That is the
  // finding: not a threshold it missed, a scan it was never in.
  assert.equal(spikeTickers.has("SPX"), false);
  assert.equal(splitTickers.has("SPX"), false);
  assert.equal(splitTickers.has("DTBL"), true);
  // Whatever DID fire must have come from the eligible pool, in both detectors.
  for (const t of [...spikeTickers, ...splitTickers]) {
    assert.ok(!cov.ineligibleTickers.includes(t), `${t} fired a signal but was counted ineligible`);
  }
});

test("signalEligibility reports a clean tape as fully scanned, so the panels stay quiet", () => {
  const flows = [
    { ticker: "NVDA", premium: 1, event_at: "2026-08-23T14:00:00Z" },
    { ticker: "TSLA", premium: 1, event_at: "2026-08-23T14:01:00Z" },
  ];
  const cov = signalEligibility(flows);
  assert.equal(cov.eligible, 2);
  assert.equal(cov.ineligible, 0);
  assert.deepEqual(cov.ineligibleTickers, []);
  // Empty input must not read as "everything was skipped".
  const none = signalEligibility([]);
  assert.deepEqual(none, { total: 0, eligible: 0, ineligible: 0, ineligibleTickers: [] });
});

test("ineligible tickers are ranked by how much of the tape each one costs", () => {
  const flows = [
    ...Array.from({ length: 3 }, () => ({ ticker: "SPY", premium: 1 })),
    ...Array.from({ length: 9 }, () => ({ ticker: "SPX", premium: 1 })),
    { ticker: "QQQ", premium: 1 },
  ];
  // SPX first because it costs the most coverage — the live ordering (SPX 3079 · SPY 421).
  assert.deepEqual(signalEligibility(flows).ineligibleTickers, ["SPX", "SPY", "QQQ"]);
});
