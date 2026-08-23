import { test } from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import {
  impliedContractSize,
  positionIntent,
  openingBadgeLabel,
  positionIntentTitle,
  OPEN_INTEREST_MARGIN,
} from "./helix-position-intent";

/** premium for `size` contracts at `fill` per share. */
const print = (size: number, fill: number, open_interest?: number | null) =>
  ({ premium: size * fill * 100, fill_price: fill, open_interest }) as Pick<
    FlowAlert,
    "premium" | "fill_price" | "open_interest"
  >;

test("impliedContractSize recovers contracts from premium and per-share fill", () => {
  // The live MRNA print: 8500 contracts at $17.50/share = $14,875,000.
  assert.equal(impliedContractSize({ premium: 14_875_000, fill_price: 17.5 }), 8500);
  assert.equal(impliedContractSize({ premium: 512_640, fill_price: 1.8 }), 2848);
});

test("impliedContractSize returns null rather than a fabricated zero", () => {
  // Every one of these would produce 0, Infinity or NaN if computed naively — and a print of
  // "0 contracts" compared against OI would read as indeterminate instead of unknown.
  for (const bad of [
    { premium: 0, fill_price: 5 },
    { premium: 1000, fill_price: 0 },
    { premium: 1000, fill_price: -1 },
    { premium: -1000, fill_price: 5 },
    { premium: 1000, fill_price: undefined },
    { premium: undefined, fill_price: 5 },
    { premium: Number.NaN, fill_price: 5 },
  ] as Array<Pick<FlowAlert, "premium" | "fill_price">>) {
    assert.equal(impliedContractSize(bad), null, `${JSON.stringify(bad)} must be null`);
  }
});

test("more contracts than exist to close is OPENING — the counting argument", () => {
  const v = positionIntent(print(8500, 17.5, 108)); // the live MRNA print
  assert.equal(v.intent, "opening");
  assert.equal(v.intent === "opening" && v.basis, "exceeds_open_interest");
  assert.ok(v.intent === "opening" && v.ratio != null && v.ratio > 78);
});

test("zero open interest is OPENING with no ratio — a ratio against nothing is not a number", () => {
  const v = positionIntent(print(500, 2, 0));
  assert.equal(v.intent, "opening");
  assert.equal(v.intent === "opening" && v.basis, "no_open_interest");
  assert.equal(v.intent === "opening" && v.ratio, null);
});

test("at or below open interest is INDETERMINATE — never reported as closing", () => {
  for (const [size, oi] of [[100, 1000], [999, 1000], [1000, 1000], [1049, 1000]]) {
    const v = positionIntent(print(size, 3, oi));
    assert.equal(v.intent, "indeterminate", `size ${size} vs OI ${oi}`);
    assert.equal(v.intent === "indeterminate" && v.reason, "within_open_interest");
  }
  // The verdict union has no "closing" member at all, so it cannot be produced by accident.
  const v = positionIntent(print(1, 3, 100_000));
  assert.notEqual((v as { intent: string }).intent, "closing");
});

test("the margin is enforced at the boundary, in both directions", () => {
  const oi = 1000;
  // Just under the margin -> still indeterminate. Exactly on it -> opening.
  assert.equal(positionIntent(print(oi * OPEN_INTEREST_MARGIN - 1, 3, oi)).intent, "indeterminate");
  assert.equal(positionIntent(print(oi * OPEN_INTEREST_MARGIN, 3, oi)).intent, "opening");
  // A bare 1.4% excess — the smallest ratio seen live (1.014x) — is NOT enough. That row is
  // inside the derivation's own error budget and must not carry a badge asserting impossibility.
  assert.equal(positionIntent(print(1014, 3, 1000)).intent, "indeterminate");
});

test("absent open interest is UNKNOWN, never treated as zero", () => {
  // This is the whole trap: `oi == null` coerces to 0, and 0 means "all new". 70% of the live tape
  // reports no OI, so getting this wrong would badge 3500 unexamined prints as new positioning.
  for (const oi of [null, undefined] as Array<number | null | undefined>) {
    const v = positionIntent(print(500, 2, oi));
    assert.equal(v.intent, "unknown", `oi=${String(oi)}`);
    assert.equal(v.intent === "unknown" && v.reason, "open_interest_unreported");
  }
  // Negative or non-finite OI is corrupt input, not zero.
  assert.equal(positionIntent({ premium: 1000, fill_price: 2, open_interest: -5 }).intent, "unknown");
  assert.equal(
    positionIntent({ premium: 1000, fill_price: 2, open_interest: Number.NaN }).intent,
    "unknown"
  );
});

test("an underivable size is UNKNOWN for its own reason, distinct from missing OI", () => {
  const v = positionIntent({ premium: 1000, fill_price: 0, open_interest: 5 });
  assert.equal(v.intent, "unknown");
  assert.equal(v.intent === "unknown" && v.reason, "size_underivable");
});

test("the badge scales its claim — 78x and 1.1x are not the same statement", () => {
  assert.equal(openingBadgeLabel(positionIntent(print(1100, 3, 1000))), "NEW");
  assert.equal(openingBadgeLabel(positionIntent(print(500, 2, 0))), "NEW");
  assert.equal(openingBadgeLabel(positionIntent(print(2500, 3, 1000))), "NEW 2.5×");
  assert.equal(openingBadgeLabel(positionIntent(print(8500, 17.5, 108))), "NEW 79×");
  // No badge for anything unproven — that is the point.
  assert.equal(openingBadgeLabel(positionIntent(print(100, 3, 1000))), null);
  assert.equal(openingBadgeLabel(positionIntent(print(100, 3, null))), null);
});

test("the tooltip states the counting argument, with real numbers", () => {
  const t = positionIntentTitle(positionIntent(print(8500, 17.5, 108)));
  assert.ok(t && t.includes("8,500"), "must name the size");
  assert.ok(t && t.includes("108"), "must name the open interest");
  assert.ok(t && t.includes("8,392"), "must state how many are necessarily new");
  assert.ok(t && t.includes("cannot be entirely closing"), "must state WHY, not just the verdict");

  const zero = positionIntentTitle(positionIntent(print(500, 2, 0)));
  assert.ok(zero && zero.includes("no open interest"));

  // Nothing to explain when nothing is claimed.
  assert.equal(positionIntentTitle(positionIntent(print(100, 3, 1000))), null);
  assert.equal(positionIntentTitle(positionIntent(print(100, 3, null))), null);
});
