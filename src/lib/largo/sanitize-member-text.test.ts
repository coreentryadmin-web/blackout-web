import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeLargoMemberText } from "./sanitize-member-text.ts";

test("sanitizeLargoMemberText strips vendor names from provenance and inline copy", () => {
  const raw =
    "**Facts**\n- [fact] SPX tide bullish (Unusual Whales · live)\n- Polygon technicals show EMA stack up";
  const out = sanitizeLargoMemberText(raw);
  assert.ok(!/Unusual Whales|Polygon|UW/i.test(out));
  assert.match(out, /flow tape/i);
  assert.match(out, /market data/i);
});

test("sanitizeLargoMemberText leaves neutral desk copy unchanged", () => {
  const neutral = "**Verdict** — SPX range-bound.\n\n**Data** — All reads live and complete.";
  assert.equal(sanitizeLargoMemberText(neutral), neutral);
});
