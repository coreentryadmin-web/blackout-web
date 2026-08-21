import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { roundFloats } from "@/lib/round-floats";
import { VECTOR_FRACTION_DP } from "@/features/vector/lib/vector-response-rounding";

/**
 * PIN-FORECAST PRECISION at the Largo boundary.
 *
 * THE DEFECT. `/api/market/vector/pin-forecast` passes `VECTOR_FRACTION_DP` and says why in its own
 * header: the pin core emits `pinPct` and `magnet.strengthPct` at `toFixed(3)`, and "a blanket 2dp
 * at the boundary silently threw that third digit away and floored a sub-1% `scenarios[].p` to
 * zero." `spxPinForLargo` and `spxPulseForLargo` — the readers that feed the MODEL rather than the
 * chart — called bare `roundFloats(...)`.
 *
 * Same shape as #2423, and the reason that lesson is worth carrying: a centralized fix is not
 * adopted until every call site imports it. This is the second instance of that exact map.
 *
 * A zeroed probability is the sharp end. `p: 0` does not read as "unlikely" to a model, it reads as
 * IMPOSSIBLE — and it is the tail scenarios that get zeroed.
 */

/** Shaped as loadSpxPinForecast returns it; the 0..1 fields are what the map exists for. */
const PIN = {
  pinPct: 0.412,
  magnet: { strike: 7650, kind: "max_pain", direction: "flat", strengthPct: 0.084 },
  scenarios: [
    { close: 7650, p: 0.412, kind: "pin" },
    { close: 7800, p: 0.009, kind: "path" },
    { close: 7500, p: 0.004, kind: "path" },
  ],
  drivers: [{ label: "max pain", detail: "-", weight: 0.455 }, { label: "charm", detail: "-", weight: 0.128 }],
  atmIv: 0.1344,
};

test("REGRESSION: bare 2dp zeroes a sub-1% pin scenario", () => {
  const bare = roundFloats({ available: true, pin: PIN }) as typeof PIN extends never ? never : { pin: typeof PIN };
  assert.equal(bare.pin.scenarios[2]!.p, 0, "pre-fix: the 0.4% tail is served as exactly 0");
  assert.equal(bare.pin.pinPct, 0.41, "pre-fix: the third digit the core deliberately emitted is gone");
});

test("the map preserves every 0..1 field the pin core emits", () => {
  const served = roundFloats({ available: true, pin: PIN }, 2, VECTOR_FRACTION_DP) as { pin: typeof PIN };
  assert.equal(served.pin.pinPct, 0.412);
  assert.equal(served.pin.magnet.strengthPct, 0.084);
  assert.equal(served.pin.atmIv, 0.1344);
  for (const [i, s] of PIN.scenarios.entries()) {
    assert.equal(served.pin.scenarios[i]!.p, s.p, `scenario ${i} probability must survive`);
    assert.notEqual(served.pin.scenarios[i]!.p, 0, "a real probability must never be served as 0");
  }
  for (const [i, d] of PIN.drivers.entries()) {
    assert.equal(served.pin.drivers[i]!.weight, d.weight, `driver ${i} weight is the ordering key`);
  }
});

test("both Largo pin readers pass the map", () => {
  // Source-read: these readers reach Redis and the SPX desk graph, so the assertion is that the
  // call sites carry the override at all — their absence IS the defect.
  const src = readFileSync("src/lib/largo/product-reads.ts", "utf8");
  for (const fn of ["spxPinForLargo", "spxPulseForLargo"]) {
    const body = src.slice(src.indexOf(`export async function ${fn}(`));
    const head = body.slice(0, body.indexOf("\n}"));
    assert.match(head, /roundFloats\([^)]*\}, 2, VECTOR_FRACTION_DP\)/, `${fn} must round with VECTOR_FRACTION_DP`);
  }
});

test("the map is imported where it is used", () => {
  const src = readFileSync("src/lib/largo/product-reads.ts", "utf8");
  assert.match(src, /import \{ VECTOR_FRACTION_DP \} from "@\/features\/vector\/lib\/vector-response-rounding";/);
});
