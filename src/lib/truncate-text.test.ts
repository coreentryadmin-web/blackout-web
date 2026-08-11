import test from "node:test";
import assert from "node:assert/strict";
import { truncateText } from "./truncate-text";

/**
 * The live failure these lock: a card headline reading `…long gamma support and a $225 call wall
 * holding resistance….` — FOUR dots, because the truncator appended an ellipsis on top of the
 * sentence's own full stop. On a graphic built to be shared, that reads as broken software.
 */

test("short text is returned untouched", () => {
  assert.equal(truncateText("NVDA is bullish", 90), "NVDA is bullish");
  assert.equal(truncateText("  padded  ", 90), "padded");
});

test("never emits a doubled terminator", () => {
  // The exact shape that shipped: the cut lands right after a full stop.
  const text = "NVDA is bullish intraday with long gamma support and a 225 call wall holding it. And more";
  const out = truncateText(text, 80);
  assert.ok(out.endsWith("…"), out);
  assert.ok(!/[.,;:\s–—-]…$/.test(out), `punctuation survived before the ellipsis: ${JSON.stringify(out)}`);
});

test("cuts at a word boundary, not mid-word", () => {
  const out = truncateText("dealers are positioned long gamma into the September expiry cycle", 40);
  assert.ok(out.endsWith("…"));
  // Everything before the ellipsis must be whole words from the source.
  const body = out.slice(0, -1);
  assert.ok("dealers are positioned long gamma into the September expiry cycle".startsWith(body), out);
  assert.ok(!body.endsWith(" "));
});

test("a single unbroken token is still cut rather than collapsing to nothing", () => {
  // An OCC symbol or a URL has no space to back up to. Losing the whole string would be worse.
  const out = truncateText("O:NVDA260815C00225000AND-MORE-UNBROKEN-CHARACTERS", 20);
  assert.equal(out.length, 20);
  assert.ok(out.endsWith("…"));
});

test("the RESULT honours the limit, ellipsis included", () => {
  for (const max of [12, 40, 90]) {
    const out = truncateText("a ".repeat(200), max);
    assert.ok(out.length <= max, `${out.length} > ${max}`);
  }
});
