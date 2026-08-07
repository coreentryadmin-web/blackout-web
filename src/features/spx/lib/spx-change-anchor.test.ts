import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { pulseChangePctFromPriorClose } from "./spx-change-anchor";

// ─────────────────────────────────────────────────────────────────────────────
// P0 2026-08-07: the header day-change tile was anchored to the SESSION OPEN.
// ─────────────────────────────────────────────────────────────────────────────

test("pulseChangePctFromPriorClose reproduces the true day change from the LIVE P0 numbers", () => {
  // Mobile capture 14:04 UTC: the desk rendered "SPX 7,734.13 -0.01%" in RED while SPX was up on
  // the day, next to a "TREND Bullish" tile. prior close 7709.96 (Polygon I:SPX previous_close).
  const derived = pulseChangePctFromPriorClose(7734.13, 7709.96, -0.01);
  assert.ok(derived > 0, `must be POSITIVE — the sign error is the member-facing defect (got ${derived})`);
  assert.ok(Math.abs(derived - 0.31) < 0.01, `expected ~+0.31%, got ${derived.toFixed(3)}`);

  // Desktop capture 13:51 UTC: tile read +0.08%, truth +0.41%.
  const d2 = pulseChangePctFromPriorClose(7741.69, 7709.96, 0.08);
  assert.ok(Math.abs(d2 - 0.41) < 0.01, `expected ~+0.41%, got ${d2.toFixed(3)}`);
});

test("the session-OPEN anchor is what the transported value carried — deriving discards it", () => {
  // 8 paired polls showed pulse tracking (price-open)/open on 7 of 8; open was 7735.18.
  const open = 7735.18, priorClose = 7709.96, price = 7741.69;
  const openAnchored = ((price - open) / open) * 100;   // what was transported: ~0.084
  const trueChange = ((price - priorClose) / priorClose) * 100; // ~0.411
  assert.ok(Math.abs(openAnchored - 0.08) < 0.01, "precondition: reproduces the wrong number");
  assert.equal(pulseChangePctFromPriorClose(price, priorClose, openAnchored), trueChange);
});

test("falls back to the transported value ONLY when there is no prior close to derive from", () => {
  // Pre-open on a cold cache: nothing to derive from, so the transported value is the only number
  // there is. Must never be worse than today's behaviour.
  for (const bad of [null, undefined, 0, -1, Number.NaN]) {
    assert.equal(pulseChangePctFromPriorClose(7741.69, bad as number | null, 0.08), 0.08, `priorClose=${bad}`);
    assert.equal(pulseChangePctFromPriorClose(bad as number | null, 7709.96, 0.08), 0.08, `price=${bad}`);
  }
});

test("a genuinely DOWN day still reads negative — the fix is not a sign flip", () => {
  const down = pulseChangePctFromPriorClose(7650.0, 7709.96, 0.5);
  assert.ok(down < 0, `expected negative, got ${down}`);
  assert.ok(Math.abs(down - -0.7776) < 0.01, `got ${down.toFixed(4)}`);
});

test("VIX is gated alongside SPX in the pulse fast path, not left behind it", () => {
  // An unresolved entry is written as `change_pct: pulseChange ?? 0` — a fabricated FLAT ZERO. A
  // gate naming only SPX returns early on polls where SPX resolves and VIX does not, serving
  // `vix_change_pct: 0` (VIX unchanged on the day) when it is not. VIX cannot be derived: the pulse
  // payload carries SPX's prior close and no VIX prior close.
  const src = readFileSync("src/features/spx/lib/spx-desk.ts", "utf8");
  assert.match(src, /changeResolved\(SPX\) && changeResolved\(VIX\)/);
});
