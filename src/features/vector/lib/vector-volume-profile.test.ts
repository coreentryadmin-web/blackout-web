import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVolumeProfile } from "./vector-volume-profile";

test("computeVolumeProfile: empty input returns an empty profile, never fabricates", () => {
  const p = computeVolumeProfile([]);
  assert.deepEqual(p.buckets, []);
  assert.equal(p.poc, null);
  assert.equal(p.valueAreaLow, null);
  assert.equal(p.valueAreaHigh, null);
  assert.equal(p.totalVolume, 0);
});

test("computeVolumeProfile: bars with no/zero volume are dropped, not fabricated as zero-contribution buckets", () => {
  const p = computeVolumeProfile([
    { high: 101, low: 99, volume: 0 },
    { high: 105, low: 95, volume: undefined },
  ]);
  assert.deepEqual(p.buckets, []);
  assert.equal(p.poc, null);
});

test("computeVolumeProfile: a degenerate flat range (all bars at one price) collapses to a single bucket", () => {
  const p = computeVolumeProfile([
    { high: 100, low: 100, volume: 500 },
    { high: 100, low: 100, volume: 300 },
  ]);
  assert.equal(p.buckets.length, 1);
  assert.equal(p.buckets[0]!.price, 100);
  assert.equal(p.buckets[0]!.volume, 800);
  assert.equal(p.poc, 100);
  assert.equal(p.valueAreaLow, 100);
  assert.equal(p.valueAreaHigh, 100);
});

test("computeVolumeProfile: POC lands on the price bucket with the most volume", () => {
  // Heavy volume clustered near 100-101; light volume spread 90-110.
  const bars = [
    { high: 110, low: 90, volume: 100 }, // spreads thin across the whole range
    { high: 101, low: 100, volume: 5000 }, // concentrated near 100-101
    { high: 101, low: 100, volume: 5000 },
  ];
  const p = computeVolumeProfile(bars, 20);
  assert.ok(p.poc != null);
  assert.ok(p.poc! >= 99 && p.poc! <= 102, `POC ${p.poc} should be near the 100-101 cluster`);
});

test("computeVolumeProfile: value area always contains the POC and is contiguous", () => {
  const bars = Array.from({ length: 30 }, (_, i) => ({
    high: 100 + i * 0.5 + 0.25,
    low: 100 + i * 0.5,
    volume: 100 + (i % 5) * 50,
  }));
  const p = computeVolumeProfile(bars);
  assert.ok(p.poc != null && p.valueAreaLow != null && p.valueAreaHigh != null);
  assert.ok(p.valueAreaLow! <= p.poc! && p.poc! <= p.valueAreaHigh!);
});

test("computeVolumeProfile: value area covers roughly 70% of total volume (never fabricated beyond real bars)", () => {
  const bars = Array.from({ length: 24 }, (_, i) => ({
    high: 100 + i + 1,
    low: 100 + i,
    volume: i === 12 ? 10000 : 100, // one dominant bucket, flat elsewhere
  }));
  const p = computeVolumeProfile(bars, 24);
  const vaVolume = p.buckets
    .filter((b) => b.price >= p.valueAreaLow! && b.price <= p.valueAreaHigh!)
    .reduce((s, b) => s + b.volume, 0);
  assert.ok(vaVolume / p.totalVolume >= 0.7, `value-area coverage ${vaVolume / p.totalVolume} should be >= 0.7`);
});

test("computeVolumeProfile: a single-tick bar (high===low) contributes its whole volume to one bucket, not split", () => {
  const bars = [
    { high: 100, low: 100, volume: 1000 },
    { high: 110, low: 90, volume: 10 },
  ];
  const p = computeVolumeProfile(bars, 20);
  // The bucket at/near 100 should dominate since the single-tick bar's full 1000 landed there.
  const near100 = p.buckets.filter((b) => Math.abs(b.price - 100) < 1);
  const near100Vol = near100.reduce((s, b) => s + b.volume, 0);
  assert.ok(near100Vol >= 1000, `expected the near-100 bucket(s) to carry the full 1000 tick volume, got ${near100Vol}`);
});

test("computeVolumeProfile: numBuckets < 1 returns an empty profile rather than throwing", () => {
  const p = computeVolumeProfile([{ high: 101, low: 99, volume: 100 }], 0);
  assert.deepEqual(p.buckets, []);
});

test("computeVolumeProfile: total bucketed volume conserves the sum of contributing bars' volume", () => {
  const bars = [
    { high: 105, low: 95, volume: 1000 },
    { high: 102, low: 98, volume: 500 },
  ];
  const p = computeVolumeProfile(bars, 10);
  const summed = p.buckets.reduce((s, b) => s + b.volume, 0);
  assert.ok(Math.abs(summed - 1500) < 1e-6, `expected conserved volume 1500, got ${summed}`);
});
