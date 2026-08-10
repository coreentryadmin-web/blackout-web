import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * VISUAL MOUNT WIRING.
 *
 * THE GAP THIS PINS, and it is one I shipped myself. `CreateVisualAction` was built, tested and
 * merged with ZERO references outside its own file — the API worked, the templates rendered, the
 * router routed, and there was no button anywhere in the product. Exactly the "real capability
 * with no path to the answering layer" pattern this codebase keeps paying for (helix-signal-
 * outcomes, Vector Pulse, the Helix derivations, the Vector analytics), committed while fixing
 * instances of it.
 *
 * A component is not shipped until something renders it, and nothing else in the suite can tell
 * the difference between "built" and "reachable".
 */

const ANSWER = "src/features/largo/components/LargoAnswerMessage.tsx";

test("the action is MOUNTED on the answer, not merely built", () => {
  const src = readFileSync(ANSWER, "utf8");
  assert.ok(src.includes("CreateVisualAction"), "LargoAnswerMessage must render CreateVisualAction");
  assert.ok(src.includes("from \"@/features/largo/visual/CreateVisualAction\""), "and import it properly");
});

test("it is fed from the ENVELOPE, never from raw tool output", () => {
  const src = readFileSync(ANSWER, "utf8");
  // Raw `capturedResults` must not cross to the browser: it is unbounded untyped tool output.
  // Asserted on the PROP, not the token — the mount's own comment explains why it is omitted,
  // and a bare substring check fails on the explanation rather than on the behaviour.
  assert.ok(!/capturedResults\s*=\s*\{/.test(src), "raw tool results must not be passed as a prop");
  for (const prop of ["headline", "envelopeLevels", "envelopeGexShifts", "question"]) {
    assert.ok(src.includes(prop), `must pass ${prop} from the envelope`);
  }
});

test("the action is gated on a real envelope", () => {
  // Offering it on a raw-markdown fallback yields a button whose only outcome is
  // "no visual for this answer" — the evidence a card needs simply is not there.
  const src = readFileSync(ANSWER, "utf8");
  assert.match(src, /envelope\s*\?\s*\(/, "must render the slot only when an envelope exists");
});

test("bias vocabulary is translated, and `mixed` never picks a side", () => {
  const src = readFileSync(ANSWER, "utf8");
  assert.ok(src.includes('"bullish" ? "bull"'), "BieBias → card bias mapping must be explicit");
  assert.ok(src.includes('"bearish" ? "bear"'), "and cover the bear side");
  // Everything else (neutral AND mixed) falls through to neutral rather than choosing.
  assert.ok(src.includes(': "neutral"'), "mixed must fall through to neutral, not a coin flip");
});
