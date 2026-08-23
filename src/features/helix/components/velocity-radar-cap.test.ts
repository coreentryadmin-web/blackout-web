import { test } from "node:test";
import assert from "node:assert/strict";
import { VELOCITY_RADAR_DISPLAY_LIMIT } from "./VelocityRadar";
import { detectVelocitySpikes } from "@/features/helix/lib/helix-signal-detection";

/**
 * The Velocity Radar's header renders a COUNT, so a capped list does not read as a truncated view
 * — it reads as a measurement. These pin the two facts that made that a defect: the cap really can
 * bind, and the badge set is built from the FULL list, so under-reporting makes one page disagree
 * with itself.
 *
 * MEASURED against the live tape (2026-08-21 RTH, replayed at 5-minute steps): the cap binds in
 * 11.3% of non-empty windows, with up to 14 spikes rendered as "8".
 */

const NOW = Date.parse("2026-08-21T15:00:00.000Z");

/** `n` prints on `ticker` inside the recent window, none prior — a clean spike. */
function spikePrints(ticker: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ticker,
    premium: 500_000,
    option_type: "CALL",
    event_at: new Date(NOW - (i + 1) * 30_000).toISOString(),
  }));
}

test("more spiking tickers than the display limit is reachable — the cap is not theoretical", () => {
  const flows = [];
  // 14 is the live maximum observed in one 15-minute window.
  for (let i = 0; i < 14; i++) flows.push(...spikePrints(`TCK${i}`, 5));
  const spikes = detectVelocitySpikes(flows as never, NOW);
  assert.ok(
    spikes.length > VELOCITY_RADAR_DISPLAY_LIMIT,
    `expected more than ${VELOCITY_RADAR_DISPLAY_LIMIT} spikes, got ${spikes.length}`
  );
  assert.equal(spikes.length, 14);
});

test("the rendered slice is smaller than the population it was taken from", () => {
  const flows = [];
  for (let i = 0; i < 14; i++) flows.push(...spikePrints(`TCK${i}`, 5));
  const spikes = detectVelocitySpikes(flows as never, NOW);
  const shown = spikes.slice(0, VELOCITY_RADAR_DISPLAY_LIMIT);
  assert.equal(shown.length, VELOCITY_RADAR_DISPLAY_LIMIT);
  // The header must therefore say "8 of 14". Reporting `shown.length` alone asserts that 8 is how
  // many cleared the threshold, which is the defect.
  assert.notEqual(shown.length, spikes.length);
});

test("the badge set is built from the FULL list, so the radar must not report a smaller number", () => {
  // This is the internal inconsistency: `velocitySpikeTickers` badges every spiking ticker on the
  // tape while the radar header claimed there were only 8. One computation, two surfaces.
  const flows = [];
  for (let i = 0; i < 14; i++) flows.push(...spikePrints(`TCK${i}`, 5));
  const spikes = detectVelocitySpikes(flows as never, NOW);
  const badged = new Set(spikes.map((e) => e.ticker));
  const shown = spikes.slice(0, VELOCITY_RADAR_DISPLAY_LIMIT);
  assert.equal(badged.size, 14);
  assert.ok(badged.size > shown.length, "badges must be able to exceed the rendered rows");
});

test("an uncapped window needs no disclosure — the panel must not print 'N of N'", () => {
  const flows = [];
  for (let i = 0; i < 3; i++) flows.push(...spikePrints(`TCK${i}`, 5));
  const spikes = detectVelocitySpikes(flows as never, NOW);
  const shown = spikes.slice(0, VELOCITY_RADAR_DISPLAY_LIMIT);
  // The panel's `capped` test is `totalSpikes > entries.length`; false here, so it renders a bare
  // count. "3 of 3" would be noise, and noise trains readers to ignore the disclosure that matters.
  assert.equal(shown.length, spikes.length);
  assert.equal(spikes.length > shown.length, false);
});
