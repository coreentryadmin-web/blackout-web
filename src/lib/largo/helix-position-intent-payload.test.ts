import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { positionIntent } from "@/features/helix/lib/helix-position-intent";
import { roundFloats } from "@/lib/round-floats";

/**
 * `get_helix_derived` is DB-backed and cannot run here, so these guard the two things that CAN go
 * wrong between the pure verdict and the wire — both of which would silently destroy the field's
 * honesty rather than break anything loudly.
 */

const print = (size: number, fill: number, open_interest?: number | null) => ({
  premium: size * fill * 100,
  fill_price: fill,
  open_interest,
});

test("the verdict survives roundFloats intact — discriminant and refusal reasons included", () => {
  // The payload is shaped by roundFloats on its way out. A previous finding in this same file
  // recorded it ZEROING a small value (0.004 -> 0), so anything carrying meaning in a number must
  // be checked through it rather than assumed to pass.
  const cases = [
    positionIntent(print(8500, 17.5, 108)),   // opening, big ratio
    positionIntent(print(500, 2, 0)),          // opening, no open interest, ratio null
    positionIntent(print(100, 3, 1000)),       // indeterminate
    positionIntent(print(100, 3, null)),       // unknown — never examined
    positionIntent({ premium: 1000, fill_price: 0, open_interest: 5 }), // unknown — size underivable
  ];
  for (const v of cases) {
    const out = roundFloats({ position_intent: v }) as { position_intent: typeof v };
    assert.deepEqual(
      out.position_intent.intent,
      v.intent,
      `roundFloats changed the discriminant for ${JSON.stringify(v)}`
    );
    if (v.intent === "opening") {
      const r = out.position_intent as typeof v;
      assert.equal(r.basis, v.basis, "the basis must survive — it is why the claim holds");
      // A null ratio must stay null, not become 0. Zero would read as "traded nothing against
      // nothing" instead of "there was no open interest to form a ratio against".
      assert.equal(r.ratio == null, v.ratio == null, "null-ness of ratio must survive");
      if (v.ratio != null) assert.ok((r.ratio as number) > 1, "a surviving ratio must stay > 1");
    }
    if (v.intent === "indeterminate" || v.intent === "unknown") {
      assert.equal(
        (out.position_intent as { reason: string }).reason,
        (v as { reason: string }).reason,
        "the REASON is the whole value of a refusal — it must not be dropped"
      );
    }
  }
});

test("a refusal is never zeroed into something a model would read as an answer", () => {
  // `unknown` carries no numbers at all — the risk is a shaper inventing them. 70% of the live
  // tape is `unknown`, so a fabricated 0 here would be the single most-repeated lie in the payload.
  const v = positionIntent(print(100, 3, null));
  const out = roundFloats({ position_intent: v }) as { position_intent: Record<string, unknown> };
  assert.equal(out.position_intent.intent, "unknown");
  assert.equal("size" in out.position_intent, false, "unknown must not acquire a size");
  assert.equal("openInterest" in out.position_intent, false, "unknown must not acquire an open interest");
  assert.equal("ratio" in out.position_intent, false, "unknown must not acquire a ratio");
});

test("product-reads carries the verdict WHOLE, never flattened to a boolean", () => {
  // The tempting shape is `position_intent: intent.intent === "opening"`, which deletes exactly the
  // distinction that makes the field honest: it collapses "we looked and cannot tell" and "nothing
  // was examined" into the same `false` a model would read as "not new positioning".
  const src = readFileSync("src/lib/largo/product-reads.ts", "utf8");
  assert.match(src, /position_intent: positionIntent\(row\)/, "the whole verdict must be attached");
  assert.doesNotMatch(
    src,
    /position_intent:[^,\n]*===\s*"opening"/,
    "the verdict must not be flattened to a boolean"
  );
  assert.doesNotMatch(
    src,
    /position_intent:[^,\n]*\.intent\b/,
    "the discriminant alone is not the verdict — the basis and reason carry the argument"
  );
});
