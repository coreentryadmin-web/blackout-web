import test from "node:test";
import assert from "node:assert/strict";
import { detectVelocitySpikes, detectSplitFlow, type MinimalFlow } from "./helix-signal-detection";

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
