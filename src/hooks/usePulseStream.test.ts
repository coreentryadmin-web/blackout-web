import { test } from "node:test";
import assert from "node:assert/strict";
import { overlayFromStream } from "@/hooks/usePulseStream";
import type { SpxDeskPulse } from "@/features/spx/lib/spx-desk";

// ---------------------------------------------------------------------------
// The SSE overlay spreads over the REST pulse (`{ ...basePulse, ...overlay }`), so whatever it
// puts in `spx_change_pct` WINS over the value spx-desk.ts derived from `prior_close`. The stream's
// own `change_pct` comes from polygon-socket.ts's indexStore, which does NOT transport the anchor
// it was measured against — so this overlay is the second door into the 2026-08-07 P0.
// ---------------------------------------------------------------------------

const PRIOR_CLOSE = 7640;
const LIVE_PRICE = 7674.37;
/** (7674.37 − 7640) / 7640 × 100 — what the member can verify from the two numbers on screen. */
const DERIVED_PCT = ((LIVE_PRICE - PRIOR_CLOSE) / PRIOR_CLOSE) * 100;
/** What a bar-open-anchored stream would report on a day that gapped up 28 points overnight. */
const SESSION_OPEN_ANCHORED_PCT = 0.083;

function basePulse(overrides: Partial<SpxDeskPulse> = {}): SpxDeskPulse {
  return {
    available: true,
    price: 7670,
    spx_change_pct: DERIVED_PCT,
    prior_close: PRIOR_CLOSE,
    vix: 14.2,
    vix_change_pct: -1.1,
    above_vwap: true,
    ...overrides,
  } as SpxDeskPulse;
}

function streamSnap(changePct: number) {
  return {
    spx: { price: LIVE_PRICE, change_pct: changePct },
    t: Date.parse("2026-08-22T18:00:00Z"),
  } as never;
}

test("overlayFromStream derives change% from prior_close, not the transported anchor", () => {
  // The stream says +0.083% (anchored to the session open). The prior close says +0.45%.
  // Both describe the same price; only one matches the tile the member is looking at.
  const overlay = overlayFromStream(streamSnap(SESSION_OPEN_ANCHORED_PCT), basePulse());
  assert.ok(
    Math.abs((overlay.spx_change_pct as number) - DERIVED_PCT) < 1e-9,
    `expected the derived ${DERIVED_PCT.toFixed(4)}%, got ${overlay.spx_change_pct}`
  );
  assert.notEqual(overlay.spx_change_pct, SESSION_OPEN_ANCHORED_PCT);
});

test("overlayFromStream stays self-consistent: price and change% agree with prior_close", () => {
  // The point of deriving: a member can check the arithmetic on screen. price, prior_close and
  // change% must close the triangle no matter what the stream said.
  const overlay = overlayFromStream(streamSnap(-0.04), basePulse());
  const price = overlay.price as number;
  const pct = overlay.spx_change_pct as number;
  const impliedPrior = price / (1 + pct / 100);
  assert.ok(Math.abs(impliedPrior - PRIOR_CLOSE) < 1e-6);
});

test("overlayFromStream falls back to the transported value with no prior close", () => {
  // Pre-open cold cache: nothing to derive from, so the stream's number is the only number there
  // is. Strictly no worse than before the fix — never a fabricated 0.
  const overlay = overlayFromStream(
    streamSnap(SESSION_OPEN_ANCHORED_PCT),
    basePulse({ prior_close: null })
  );
  assert.equal(overlay.spx_change_pct, SESSION_OPEN_ANCHORED_PCT);
});

test("overlayFromStream falls back with no base pulse at all", () => {
  const overlay = overlayFromStream(streamSnap(0.31), undefined);
  assert.equal(overlay.spx_change_pct, 0.31);
});

test("overlayFromStream ignores a zero/absent prior close rather than dividing by it", () => {
  // A 0 prior close would make the derivation Infinity; the guard must reject it, not publish it.
  const overlay = overlayFromStream(streamSnap(0.22), basePulse({ prior_close: 0 }));
  assert.equal(overlay.spx_change_pct, 0.22);
  assert.ok(Number.isFinite(overlay.spx_change_pct as number));
});

test("overlayFromStream returns nothing when the stream has no usable price", () => {
  // No price means no overlay at all — the REST pulse keeps its own derived value untouched,
  // rather than being spread over with a partially-populated object.
  const overlay = overlayFromStream({ spx: { price: 0, change_pct: 1.2 } } as never, basePulse());
  assert.deepEqual(overlay, {});
});

test("overlayFromStream leaves vix_change_pct transported (no VIX prior close to derive from)", () => {
  // Documented limitation, not an oversight — SpxDeskPulse carries no vix prior close.
  const overlay = overlayFromStream(
    { spx: { price: LIVE_PRICE, change_pct: 0.1 }, vix: { price: 14.9, change_pct: 4.9 } } as never,
    basePulse()
  );
  assert.equal(overlay.vix_change_pct, 4.9);
});
